import { createThumbnail, ffprobe } from './export/ffmpegRuntime'
import { createFrameExportController } from './export/frameExport'
import { createNativeExportController } from './export/nativeExport'
import type { ExportEngineHost, ExportOptions, FrameExportOptions } from './export/types'

export type { ExportOptions, FrameExportOptions } from './export/types'

export function createExportEngine(host: ExportEngineHost) {
  const frameExport = createFrameExportController(host)
  const nativeExport = createNativeExportController(host)

  return {
    ffprobe,

    createThumbnail(filePath: string, timeMs: number) {
      return createThumbnail(filePath, timeMs, host.getTempPath())
    },

    exportVideo(jobId: string, options: ExportOptions) {
      return nativeExport.exportVideo(jobId, options)
    },

    startFrameExport(jobId: string, options: FrameExportOptions) {
      return frameExport.start(jobId, options)
    },

    sendExportFrame(jobId: string, buf: ArrayBuffer) {
      return frameExport.sendFrame(jobId, buf)
    },

    finishFrameExport(jobId: string) {
      return frameExport.finish(jobId)
    },

    cancelExport(jobId: string) {
      nativeExport.cancel(jobId)
      frameExport.cancel(jobId)
      return { ok: true }
    },
  }
}
