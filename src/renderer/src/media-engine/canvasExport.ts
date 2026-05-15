import {
  createRenderPlanFingerprint,
  getRenderPlanAssets,
  getRenderPlanTimelineItems,
  type RenderPlan,
} from '../editor-core/renderPlan'
import { DEFAULT_EXPORT_PROFILE, type ExportEncoderSettings } from '../editor-core/exportSettings'
import { createRenderCacheDescriptor, createRenderCacheKey } from './renderCache'
import type { ExportRenderer, ExportTraceMetrics } from './renderEngine'
import { renderCanvasFrame } from './canvasFrameRenderer'
import {
  createFrameExportOptions,
  startFrameExportSession,
  type FrameExportSession,
} from './frameExportSession'
import { disposeCanvasMedia, loadCanvasMedia } from './mediaElementLoader'

export interface CanvasExportResult {
  success?: boolean
  path?: string
  error?: string
  canceled?: boolean
  trace?: ExportTraceMetrics
}

export interface CanvasExportControls {
  isCanceled?: () => boolean
  outputPath?: string
  cacheKey?: string
}

function createCanvas(width: number, height: number, willReadFrequently: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently })
  if (!ctx) throw new Error('Could not create export canvas')

  return { canvas, ctx }
}

async function encodeJpegCanvasFrame(canvas: HTMLCanvasElement, quality: number): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('toBlob failed')),
      'image/jpeg',
      quality
    )
  )

  return blob.arrayBuffer()
}

function encodeRawCanvasFrame(ctx: CanvasRenderingContext2D, width: number, height: number): ArrayBuffer {
  const frame = ctx.getImageData(0, 0, width, height).data
  return frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength)
}

function encodeCanvasFrame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  encoder: ExportEncoderSettings
): ArrayBuffer | Promise<ArrayBuffer> {
  if (encoder.framePipeFormat === 'raw-rgba') return encodeRawCanvasFrame(ctx, width, height)
  return encodeJpegCanvasFrame(canvas, encoder.frameJpegQuality)
}

export async function renderPlanToCanvasExport(
  jobId: string,
  plan: RenderPlan,
  onProgress: (pct: number) => void,
  controls: CanvasExportControls = {},
  encoder: ExportEncoderSettings = DEFAULT_EXPORT_PROFILE.encoder
): Promise<CanvasExportResult> {
  const totalStart = performance.now()
  const width = plan.resolution.width
  const height = plan.resolution.height
  const fps = plan.fps
  const totalMs = plan.durationMs
  const timelineItems = getRenderPlanTimelineItems(plan)
  const clips = getRenderPlanAssets(plan)
  const textOverlays = plan.textLayers
  const frameMs = 1000 / fps
  const frameCount = Math.ceil(totalMs / 1000 * fps)
  const trace: ExportTraceMetrics = {
    planHash: createRenderPlanFingerprint(plan),
    cacheKey: controls.cacheKey,
    frameCount,
    frameBytes: 0,
  }
  const mediaLoadStart = performance.now()
  const media = await loadCanvasMedia(timelineItems, clips)
  trace.mediaLoadMs = performance.now() - mediaLoadStart
  const { canvas, ctx } = createCanvas(width, height, encoder.framePipeFormat === 'raw-rgba')
  let session: FrameExportSession | null = null
  let lastProgress = -1

  function reportProgress(pct: number) {
    const nextProgress = Math.max(0, Math.min(100, Math.round(pct)))
    if (nextProgress === lastProgress) return
    lastProgress = nextProgress
    onProgress(nextProgress)
  }

  try {
    const encoderStart = performance.now()
    const startResult = await startFrameExportSession(
      jobId,
      createFrameExportOptions(width, height, fps, totalMs, clips, timelineItems, encoder, controls.outputPath)
    )
    trace.encoderStartMs = performance.now() - encoderStart
    if ('canceled' in startResult) {
      trace.totalMs = performance.now() - totalStart
      return { canceled: true, trace }
    }
    if ('error' in startResult) {
      trace.totalMs = performance.now() - totalStart
      return { error: startResult.error, trace }
    }

    session = startResult.session

    for (let frame = 0; frame < frameCount; frame++) {
      if (controls.isCanceled?.()) {
        await session.abort()
        session = null
        trace.totalMs = performance.now() - totalStart
        return { canceled: true, trace }
      }

      const renderStart = performance.now()
      await renderCanvasFrame(
        ctx,
        width,
        height,
        frame * frameMs,
        timelineItems,
        clips,
        textOverlays,
        media,
        { seekTimeoutMs: 5000, strictSeek: true }
      )
      trace.frameRenderMs = (trace.frameRenderMs ?? 0) + (performance.now() - renderStart)

      const readbackStart = performance.now()
      const encodedFrame = await encodeCanvasFrame(canvas, ctx, width, height, encoder)
      trace.frameReadbackMs = (trace.frameReadbackMs ?? 0) + (performance.now() - readbackStart)
      trace.frameBytes = (trace.frameBytes ?? 0) + encodedFrame.byteLength

      const transferStart = performance.now()
      await session.sendFrame(encodedFrame)
      trace.frameTransferMs = (trace.frameTransferMs ?? 0) + (performance.now() - transferStart)
      reportProgress((frame + 1) / frameCount * 85)
    }

    if (controls.isCanceled?.()) {
      await session.abort()
      session = null
      trace.totalMs = performance.now() - totalStart
      return { canceled: true, trace }
    }

    reportProgress(90)
    const finalizeStart = performance.now()
    const result = await session.finish()
    trace.encoderFinalizeMs = performance.now() - finalizeStart
    trace.totalMs = performance.now() - totalStart
    session = null
    reportProgress(100)
    return { ...result, trace }
  } catch (err: unknown) {
    await session?.abort()
    trace.totalMs = performance.now() - totalStart
    if (controls.isCanceled?.()) return { canceled: true, trace }
    return { error: String(err), trace }
  } finally {
    disposeCanvasMedia(media)
  }
}

export const canvasExportRenderer: ExportRenderer = {
  id: 'renderer-canvas',
  label: 'Canvas frame renderer',
  export(jobId, plan, profile, onProgress, controls) {
    const cacheDescriptor = createRenderCacheDescriptor(plan, profile, 'renderer-canvas')
    const cacheKey = createRenderCacheKey(cacheDescriptor)
    return renderPlanToCanvasExport(jobId, plan, onProgress, { ...controls, cacheKey }, profile.encoder)
  },
}
