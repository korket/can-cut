import {
  getRenderPlanAssets,
  getRenderPlanTimelineItems,
  type RenderPlan,
} from '../editor-core/renderPlan'
import { DEFAULT_EXPORT_PROFILE, type ExportEncoderSettings } from '../editor-core/exportSettings'
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
}

export interface CanvasExportControls {
  isCanceled?: () => boolean
  outputPath?: string
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
  const width = plan.resolution.width
  const height = plan.resolution.height
  const fps = plan.fps
  const totalMs = plan.durationMs
  const timelineItems = getRenderPlanTimelineItems(plan)
  const clips = getRenderPlanAssets(plan)
  const textOverlays = plan.textLayers
  const frameMs = 1000 / fps
  const frameCount = Math.ceil(totalMs / 1000 * fps)
  const media = await loadCanvasMedia(timelineItems, clips)
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
    const startResult = await startFrameExportSession(
      jobId,
      createFrameExportOptions(width, height, fps, totalMs, clips, timelineItems, encoder, controls.outputPath)
    )
    if ('canceled' in startResult) return { canceled: true }
    if ('error' in startResult) return { error: startResult.error }

    session = startResult.session

    for (let frame = 0; frame < frameCount; frame++) {
      if (controls.isCanceled?.()) {
        await session.abort()
        session = null
        return { canceled: true }
      }

      await renderCanvasFrame(
        ctx,
        width,
        height,
        frame * frameMs,
        timelineItems,
        clips,
        textOverlays,
        media
      )

      await session.sendFrame(await encodeCanvasFrame(canvas, ctx, width, height, encoder))
      reportProgress((frame + 1) / frameCount * 85)
    }

    if (controls.isCanceled?.()) {
      await session.abort()
      session = null
      return { canceled: true }
    }

    reportProgress(90)
    const result = await session.finish()
    session = null
    reportProgress(100)
    return result
  } catch (err: unknown) {
    await session?.abort()
    if (controls.isCanceled?.()) return { canceled: true }
    return { error: String(err) }
  } finally {
    disposeCanvasMedia(media)
  }
}
