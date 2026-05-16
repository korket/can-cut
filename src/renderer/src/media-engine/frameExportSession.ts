import type { MediaClip, TimelineItem } from '../types'
import { DEFAULT_EXPORT_PROFILE, type ExportEncoderSettings } from '../editor-core/exportSettings'

export interface FrameExportClip {
  id: string
  path: string
  type: MediaClip['type']
  width: number
  height: number
}

export interface FrameExportItem {
  id: string
  clipId: string
  trackIndex: number
  startTime: number
  trimStart: number
  trimEnd: number
  volume: number
}

export interface FrameExportOptions {
  W: number
  H: number
  fps: number
  totalMs: number
  encoder: ExportEncoderSettings
  outputPath?: string
  includeAudio?: boolean
  clips: FrameExportClip[]
  timelineItems: FrameExportItem[]
}

export interface FrameExportResult {
  success?: boolean
  path?: string
  error?: string
  canceled?: boolean
}

export interface FrameExportSession {
  sendFrame(frame: ArrayBuffer): Promise<void>
  finish(): Promise<FrameExportResult>
  abort(): Promise<void>
}

type FrameExportStartResult =
  | { ok: true }
  | { canceled: true }
  | { error: string }

type FrameExportSendResult =
  | { ok: true }
  | { error: string }

export type StartFrameExportSessionResult =
  | { session: FrameExportSession }
  | { canceled: true }
  | { error: string }

function requireExportWorkerMethod<T extends (...args: any[]) => any>(method: T | undefined, name: string): T {
  if (!method) throw new Error(`${name} is only available in the export worker`)
  return method
}

export function createFrameExportOptions(
  width: number,
  height: number,
  fps: number,
  totalMs: number,
  clips: MediaClip[],
  timelineItems: TimelineItem[],
  encoder: ExportEncoderSettings = DEFAULT_EXPORT_PROFILE.encoder,
  outputPath?: string,
  includeAudio = true
): FrameExportOptions {
  return {
    W: width,
    H: height,
    fps,
    totalMs,
    encoder,
    outputPath,
    includeAudio,
    clips: clips.map((clip) => ({
      id: clip.id,
      path: clip.path ?? '',
      type: clip.type,
      width: clip.width,
      height: clip.height,
    })),
    timelineItems: timelineItems.map((item) => ({
      id: item.id,
      clipId: item.clipId,
      trackIndex: item.trackIndex,
      startTime: item.startTime,
      trimStart: item.trimStart,
      trimEnd: item.trimEnd,
      volume: item.volume ?? 100,
    })),
  }
}

export async function startFrameExportSession(
  jobId: string,
  options: FrameExportOptions
): Promise<StartFrameExportSessionResult> {
  const startFrameExport = requireExportWorkerMethod(window.api.startFrameExport, 'startFrameExport')
  const sendExportFrame = requireExportWorkerMethod(window.api.sendExportFrame, 'sendExportFrame')
  const finishFrameExport = requireExportWorkerMethod(window.api.finishFrameExport, 'finishFrameExport')
  const cancelExport = requireExportWorkerMethod(window.api.cancelExport, 'cancelExport')
  const startResult = await startFrameExport(jobId, options) as FrameExportStartResult
  if ('canceled' in startResult) return { canceled: true }
  if ('error' in startResult) return { error: startResult.error }

  const rawFrameBytes = options.W * options.H * 4
  const maxBatchBytes = options.encoder.framePipeFormat === 'raw-rgba'
    ? Math.min(Math.max(rawFrameBytes * 2, 16 * 1024 * 1024), 64 * 1024 * 1024)
    : 8 * 1024 * 1024
  const maxBatchFrames = options.encoder.framePipeFormat === 'raw-rgba' ? 4 : 24
  let pendingFrames: Uint8Array[] = []
  let pendingBytes = 0
  let closed = false

  async function flushFrames() {
    if (pendingBytes === 0) return

    const frames = pendingFrames
    const byteLength = pendingBytes
    pendingFrames = []
    pendingBytes = 0

    const payload = frames.length === 1
      ? frames[0].buffer.slice(frames[0].byteOffset, frames[0].byteOffset + frames[0].byteLength)
      : (() => {
        const batch = new Uint8Array(byteLength)
        let offset = 0
        for (const frame of frames) {
          batch.set(frame, offset)
          offset += frame.byteLength
        }
        return batch.buffer
      })()

    const sendResult = await sendExportFrame(jobId, payload) as FrameExportSendResult
    if ('error' in sendResult) throw new Error(sendResult.error)
  }

  const finish = async () => {
    if (closed) return { error: 'frame export session already closed' }
    await flushFrames()
    closed = true
    return finishFrameExport(jobId)
  }

  return {
    session: {
      async sendFrame(frame: ArrayBuffer) {
        if (closed) throw new Error('frame export session already closed')
        const view = new Uint8Array(frame)
        pendingFrames.push(view)
        pendingBytes += view.byteLength

        if (pendingBytes >= maxBatchBytes || pendingFrames.length >= maxBatchFrames) {
          await flushFrames()
        }
      },
      finish,
      async abort() {
        if (closed) return
        closed = true
        pendingFrames = []
        pendingBytes = 0
        await cancelExport(jobId).catch(() => {})
      },
    },
  }
}
