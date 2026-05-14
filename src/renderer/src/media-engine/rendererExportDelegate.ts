import type { ExportProfile } from '../editor-core/exportSettings'
import type { RenderPlan } from '../editor-core/renderPlan'
import { renderPlanToCanvasExport } from './canvasExport'

interface RendererExportPayload {
  jobId: string
  outputPath: string
  plan: RenderPlan
  profile: ExportProfile
}

let started = false
const runningJobs = new Set<string>()
const canceledJobs = new Set<string>()

function requireExportWorkerMethod<T extends (...args: any[]) => any>(method: T | undefined, name: string): T {
  if (!method) throw new Error(`${name} is only available in the export worker`)
  return method
}

function isRendererExportPayload(value: unknown): value is RendererExportPayload {
  if (!value || typeof value !== 'object') return false

  const payload = value as Partial<RendererExportPayload>
  return typeof payload.jobId === 'string' && typeof payload.outputPath === 'string' && Boolean(payload.plan) && Boolean(payload.profile)
}

export function startRendererExportDelegate(): void {
  if (started) return
  started = true
  const onRendererExportCancel = requireExportWorkerMethod(window.api.onRendererExportCancel, 'onRendererExportCancel')
  const onRendererExportJob = requireExportWorkerMethod(window.api.onRendererExportJob, 'onRendererExportJob')
  const cancelExport = requireExportWorkerMethod(window.api.cancelExport, 'cancelExport')
  const reportRendererExportProgress = requireExportWorkerMethod(window.api.reportRendererExportProgress, 'reportRendererExportProgress')
  const completeRendererExport = requireExportWorkerMethod(window.api.completeRendererExport, 'completeRendererExport')

  onRendererExportCancel(({ jobId }) => {
    canceledJobs.add(jobId)
    void cancelExport(jobId).catch(() => {})
  })

  onRendererExportJob(async (payload) => {
    if (!isRendererExportPayload(payload)) return
    if (runningJobs.has(payload.jobId)) return

    runningJobs.add(payload.jobId)
    canceledJobs.delete(payload.jobId)

    try {
      const result = await renderPlanToCanvasExport(
        payload.jobId,
        payload.plan,
        (pct) => {
          void reportRendererExportProgress(payload.jobId, pct)
        },
        {
          isCanceled: () => canceledJobs.has(payload.jobId),
          outputPath: payload.outputPath,
        },
        payload.profile.encoder
      )

      await completeRendererExport(payload.jobId, result)
    } catch (err: unknown) {
      await completeRendererExport(payload.jobId, { error: String(err) })
    } finally {
      runningJobs.delete(payload.jobId)
      canceledJobs.delete(payload.jobId)
    }
  })
}
