import { promises as fs } from 'fs'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { createExportEngine } from '../exportEngine'
import type { ExportJobService } from './jobService'
import {
  isExportJobResult,
  isFrameExportOptions,
  validateExportJobStartRequest,
} from './contracts'

type ExportEngine = ReturnType<typeof createExportEngine>

export interface ExportIpcHost {
  engine: ExportEngine
  getExportJobs: () => ExportJobService | null
  getExportWorkerWebContents: () => WebContents | null
}

function error(message: string): { error: string } {
  return { error: message }
}

function isExportWorkerInvoke(event: IpcMainInvokeEvent, host: ExportIpcHost): boolean {
  const worker = host.getExportWorkerWebContents()
  return Boolean(worker && !worker.isDestroyed() && event.sender === worker)
}

function exportWorkerOnly(event: IpcMainInvokeEvent, host: ExportIpcHost): { error: string } | null {
  return isExportWorkerInvoke(event, host)
    ? null
    : error('This export IPC channel is only available to the export worker.')
}

function isJobId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFrameBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer
}

export function registerExportIpc(ipcMain: IpcMain, host: ExportIpcHost): void {
  ipcMain.handle('ffprobe:getInfo', (_event, filePath: string) => host.engine.ffprobe(filePath))
  ipcMain.handle('ffmpeg:thumbnail', (_event, filePath: string, timeMs: number) => host.engine.createThumbnail(filePath, timeMs))
  ipcMain.handle('media:validatePaths', async (_event, paths: string[]) => {
    const uniquePaths = [...new Set((Array.isArray(paths) ? paths : []).filter(Boolean))]

    return Promise.all(uniquePaths.map(async (path) => {
      try {
        const stat = await fs.stat(path)
        return { path, exists: true, isFile: stat.isFile() }
      } catch (err: unknown) {
        return { path, exists: false, isFile: false, error: String(err) }
      }
    }))
  })

  ipcMain.handle('export:frameStart', (event, jobId: string, options: unknown) => {
    const guard = exportWorkerOnly(event, host)
    if (guard) return guard
    if (!isJobId(jobId)) return error('Frame export job id is invalid.')
    if (!isFrameExportOptions(options)) return error('Frame export options are invalid.')
    return host.engine.startFrameExport(jobId, options)
  })

  ipcMain.handle('export:frameSend', (event, jobId: string, buffer: unknown) => {
    const guard = exportWorkerOnly(event, host)
    if (guard) return guard
    if (!isJobId(jobId)) return error('Frame export job id is invalid.')
    if (!isFrameBuffer(buffer)) return error('Frame export buffer is invalid.')
    return host.engine.sendExportFrame(jobId, buffer)
  })

  ipcMain.handle('export:frameFinish', (event, jobId: string) => {
    const guard = exportWorkerOnly(event, host)
    if (guard) return guard
    if (!isJobId(jobId)) return error('Frame export job id is invalid.')
    return host.engine.finishFrameExport(jobId)
  })

  ipcMain.handle('export:cancel', (event, jobId: string) => {
    const guard = exportWorkerOnly(event, host)
    if (guard) return guard
    if (!isJobId(jobId)) return error('Frame export job id is invalid.')
    return host.engine.cancelExport(jobId)
  })

  ipcMain.handle('export:jobStart', (_event, request: unknown) => {
    const parsed = validateExportJobStartRequest(request)
    if (!parsed.ok) return error(parsed.error)

    const exportJobs = host.getExportJobs()
    if (!exportJobs) return error('Export job service is not ready.')
    return exportJobs.start(parsed.value)
  })

  ipcMain.handle('export:jobList', () => host.getExportJobs()?.getJobs() ?? [])
  ipcMain.handle('export:jobCancel', (_event, jobId: string) => {
    if (!isJobId(jobId)) return error('Export job id is invalid.')
    return host.getExportJobs()?.cancel(jobId) ?? error('Export job service is not ready.')
  })
  ipcMain.handle('export:jobRemove', (_event, jobId: string) => {
    if (!isJobId(jobId)) return error('Export job id is invalid.')
    return host.getExportJobs()?.remove(jobId) ?? error('Export job service is not ready.')
  })

  ipcMain.handle('export:rendererProgress', (event, jobId: string, pct: number) => {
    const guard = exportWorkerOnly(event, host)
    if (guard) return guard
    if (!isJobId(jobId)) return error('Export job id is invalid.')
    if (!Number.isFinite(pct)) return error('Export progress is invalid.')
    return host.getExportJobs()?.handleRendererProgress(jobId, pct) ?? error('Export job service is not ready.')
  })

  ipcMain.handle('export:rendererComplete', (event, jobId: string, result: unknown) => {
    const guard = exportWorkerOnly(event, host)
    if (guard) return guard
    if (!isJobId(jobId)) return error('Export job id is invalid.')
    if (!isExportJobResult(result)) return error('Export result is invalid.')
    return host.getExportJobs()?.handleRendererComplete(jobId, result) ?? error('Export job service is not ready.')
  })
}
