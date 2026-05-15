import { createHash, randomUUID } from 'crypto'
import { constants, promises as fs } from 'fs'
import { dirname, join } from 'path'
import type { createExportEngine } from '../exportEngine'
import {
  isExportJobSnapshot,
  type ExportJob,
  type ExportJobLogEntry,
  type ExportJobMode,
  type ExportJobResult,
  type ExportJobSnapshot,
  type ExportJobStartRequest,
  type ExportJobStatus,
  type ExportTraceMetrics,
  type ExportValidationIssue,
  type ExportValidationReport,
  type RenderBackend,
  type RendererExportJobRequest,
} from './contracts'

type ExportEngine = ReturnType<typeof createExportEngine>

interface ManagedExportJob {
  job: ExportJob
  request?: ExportJobStartRequest
  logs: ExportJobLogEntry[]
  result?: ExportJobResult
  cancelRequested: boolean
}

interface RendererExportWaiter {
  resolve: (result: ExportJobResult) => void
}

export interface ExportJobServiceHost {
  engine: ExportEngine
  storagePath: string
  chooseOutputPath: () => Promise<string | null>
  sendToRenderers: (channel: string, payload: unknown) => number
  ensureExportRenderer: () => Promise<boolean>
  sendToExportRenderer: (channel: string, payload: unknown) => boolean
}

const MAX_PERSISTED_JOBS = 30
const MAX_PERSISTED_LOGS = 120
const INTERRUPTED_EXPORT_MESSAGE = 'Export was interrupted before it finished.'

function exportBackendMode(backend: RenderBackend): ExportJobMode {
  return backend === 'ffmpeg-native' ? 'native' : 'renderer'
}

function isTerminalExportStatus(status: ExportJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled' || status === 'interrupted'
}

function nowMs(): number {
  return Date.now()
}

function formatDurationMs(value: number | undefined): string {
  if (value == null) return '-'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function formatBytes(value: number | undefined): string {
  if (value == null) return '-'
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTraceSummary(trace: ExportTraceMetrics): string {
  return [
    `frames ${trace.frameCount ?? '-'}`,
    `render ${formatDurationMs(trace.frameRenderMs)}`,
    `readback ${formatDurationMs(trace.frameReadbackMs)}`,
    `transfer ${formatDurationMs(trace.frameTransferMs)}`,
    `finalize ${formatDurationMs(trace.encoderFinalizeMs)}`,
    `media ${formatDurationMs(trace.mediaLoadMs)}`,
    `bytes ${formatBytes(trace.frameBytes)}`,
    trace.cacheKey ? `cache ${trace.cacheKey}` : null,
    trace.planHash ? `plan ${trace.planHash}` : null,
  ].filter(Boolean).join(', ')
}

function hashCacheKey(cacheKey: string): string {
  return createHash('sha256').update(cacheKey).digest('hex')
}

async function copyFileAtomic(sourcePath: string, targetPath: string): Promise<void> {
  await fs.mkdir(dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  await fs.copyFile(sourcePath, tempPath)
  try {
    await fs.rm(targetPath, { force: true }).catch(() => {})
    await fs.rename(tempPath, targetPath)
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {})
    throw error
  }
}

function toSnapshot(entry: ManagedExportJob): ExportJobSnapshot {
  return {
    ...entry.job,
    logs: [...entry.logs],
    result: entry.result,
  }
}

function createJob(request: ExportJobStartRequest): ExportJob {
  const now = nowMs()

  return {
    id: randomUUID(),
    plan: request.plan,
    backend: request.preflight.backend,
    mode: exportBackendMode(request.preflight.backend),
    profile: request.profile,
    preflight: request.preflight,
    outputPath: request.outputPath,
    timing: {
      queuedAt: now,
      frameCount: request.preflight.frameCount,
    },
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function restoreEntry(snapshot: ExportJobSnapshot): ManagedExportJob {
  const { logs: _logs, result: _result, ...job } = snapshot
  const logs = Array.isArray(snapshot.logs) ? [...snapshot.logs] : []
  let result = snapshot.result

  if (!isTerminalExportStatus(job.status)) {
    const now = nowMs()
    job.status = 'interrupted'
    job.error = INTERRUPTED_EXPORT_MESSAGE
    job.updatedAt = now
    job.timing.finishedAt = job.timing.finishedAt ?? now
    if (job.timing.startedAt && job.timing.totalMs == null) {
      job.timing.totalMs = job.timing.finishedAt - job.timing.startedAt
    }
    result = { error: INTERRUPTED_EXPORT_MESSAGE }
    logs.push({ at: now, message: 'Export interrupted by app restart.' })
  }

  return {
    job,
    logs: logs.slice(-MAX_PERSISTED_LOGS),
    result,
    cancelRequested: false,
  }
}

function snapshotForPersistence(snapshot: ExportJobSnapshot): ExportJobSnapshot {
  return {
    ...snapshot,
    logs: snapshot.logs.slice(-MAX_PERSISTED_LOGS),
  }
}

export class ExportJobService {
  private jobs = new Map<string, ManagedExportJob>()
  private queue: string[] = []
  private activeJobId: string | null = null
  private rendererWaiters = new Map<string, RendererExportWaiter>()
  private persistPromise: Promise<void> = Promise.resolve()

  constructor(private readonly host: ExportJobServiceHost) {}

  private getRenderCachePath(cacheKey: string): string {
    return join(dirname(this.host.storagePath), 'render-cache', `${hashCacheKey(cacheKey)}.mp4`)
  }

  async restore(): Promise<void> {
    try {
      const rawJobs = await fs.readFile(this.host.storagePath, 'utf8')
      const parsed = JSON.parse(rawJobs)
      if (!Array.isArray(parsed)) return

      for (const value of parsed) {
        if (!isExportJobSnapshot(value)) continue
        const entry = restoreEntry(value)
        this.jobs.set(entry.job.id, entry)
      }

      this.notify()
    } catch {
      // Missing or corrupt job state should not block app startup.
    }
  }

  async start(request: ExportJobStartRequest): Promise<ExportJobSnapshot | { canceled: true }> {
    const outputPath = await this.host.chooseOutputPath()
    if (!outputPath) return { canceled: true }

    const jobRequest: ExportJobStartRequest = {
      ...request,
      outputPath,
      nativeOptions: {
        ...request.nativeOptions,
        outputPath,
      },
    }
    const job = createJob(jobRequest)
    const entry: ManagedExportJob = {
      job,
      request: jobRequest,
      logs: [],
      cancelRequested: false,
    }

    this.jobs.set(job.id, entry)
    this.queue.push(job.id)
    this.addLog(entry, 'Queued export')
    this.notify()
    this.pumpQueue()

    return toSnapshot(entry)
  }

  getJobs(): ExportJobSnapshot[] {
    return Array.from(this.jobs.values())
      .map(toSnapshot)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  getJob(jobId: string): ExportJobSnapshot | null {
    const entry = this.jobs.get(jobId)
    return entry ? toSnapshot(entry) : null
  }

  cancel(jobId: string): ExportJobSnapshot | null {
    const entry = this.jobs.get(jobId)
    if (!entry || isTerminalExportStatus(entry.job.status)) return entry ? toSnapshot(entry) : null

    entry.cancelRequested = true
    this.queue = this.queue.filter((queuedJobId) => queuedJobId !== jobId)

    if (entry.job.status === 'queued') {
      entry.job.status = 'canceled'
      entry.job.updatedAt = nowMs()
      entry.result = { canceled: true }
      this.addLog(entry, 'Queued export canceled')
      this.finishTiming(entry)
      this.notify()
      this.pumpQueue()
      return toSnapshot(entry)
    }

    entry.job.status = 'canceling'
    entry.job.updatedAt = nowMs()
    this.addLog(entry, 'Cancel requested')
    this.host.engine.cancelExport(jobId)
    this.host.sendToExportRenderer('export:rendererCancel', { jobId })
    this.notify()
    return toSnapshot(entry)
  }

  remove(jobId: string): void {
    const entry = this.jobs.get(jobId)
    if (!entry || !isTerminalExportStatus(entry.job.status)) return

    this.jobs.delete(jobId)
    this.notify()
  }

  handleEngineProgress(jobId: string, pct: number): void {
    this.updateProgress(jobId, pct)
  }

  handleEngineLog(jobId: string, message: string): void {
    const entry = this.jobs.get(jobId)
    if (!entry) return
    this.addLog(entry, message)
    this.notify()
  }

  handleRendererProgress(jobId: string, pct: number): void {
    this.updateProgress(jobId, pct)
  }

  handleRendererComplete(jobId: string, result: ExportJobResult): void {
    const waiter = this.rendererWaiters.get(jobId)
    if (!waiter) return

    this.rendererWaiters.delete(jobId)
    waiter.resolve(result)
  }

  handleExportRendererGone(reason: string): void {
    const waiters = [...this.rendererWaiters.entries()]

    for (const [jobId, waiter] of waiters) {
      const entry = this.jobs.get(jobId)
      this.rendererWaiters.delete(jobId)
      this.host.engine.cancelExport(jobId)

      if (entry) {
        this.addLog(entry, `Export renderer stopped: ${reason}`)
      }

      waiter.resolve({ error: `Export renderer stopped unexpectedly: ${reason}` })
    }
  }

  private async runJob(jobId: string): Promise<void> {
    const entry = this.jobs.get(jobId)
    if (!entry || !entry.request) return

    const { job, request } = entry

    if (entry.cancelRequested) {
      this.settle(entry, { canceled: true })
      return
    }

    job.status = 'running'
    job.updatedAt = nowMs()
    job.timing.startedAt = nowMs()
    job.timing.queueWaitMs = job.timing.startedAt - job.timing.queuedAt
    this.addLog(entry, `Started ${job.mode} export`)
    this.updateProgress(job.id, 0)

    try {
      const validationStart = nowMs()
      this.addLog(entry, 'Validating export inputs')
      job.validation = await this.validate(request)
      job.timing.validationMs = nowMs() - validationStart

      if (!job.validation.ok) {
        const message = job.validation.issues.find((issue) => issue.severity === 'error')?.message ?? 'Export validation failed.'
        job.error = message
        this.addLog(entry, `Validation failed: ${message}`)
        this.settle(entry, { error: message })
        return
      }

      this.addLog(entry, `Validation passed in ${Math.round(job.timing.validationMs)}ms`)

      if (entry.cancelRequested) {
        this.settle(entry, { canceled: true })
        return
      }

      const exportStart = nowMs()
      const cachedResult = await this.tryReuseRenderCache(entry)
      const result = cachedResult ?? (job.backend === 'ffmpeg-native'
        ? await this.host.engine.exportVideo(job.id, request.nativeOptions)
        : await this.runRendererExport(entry))
      if (!cachedResult && result.success) await this.storeRenderCache(entry, result)

      job.timing.exportMs = nowMs() - exportStart
      this.settle(entry, result)
    } catch (err: unknown) {
      if (entry.cancelRequested) {
        this.settle(entry, { canceled: true })
        return
      }

      this.settle(entry, { error: String(err) })
    }
  }

  private async validate(request: ExportJobStartRequest): Promise<ExportValidationReport> {
    const issues: ExportValidationIssue[] = []

    if (request.preflight.durationMs <= 0 || request.preflight.frameCount <= 0) {
      issues.push({ severity: 'error', code: 'empty-timeline', message: 'Timeline has no exportable duration.' })
    }

    if (request.preflight.fps <= 0 || !Number.isFinite(request.preflight.fps)) {
      issues.push({ severity: 'error', code: 'invalid-fps', message: 'Export frame rate is invalid.' })
    }

    if (request.preflight.resolution.width <= 0 || request.preflight.resolution.height <= 0) {
      issues.push({ severity: 'error', code: 'invalid-resolution', message: 'Export resolution is invalid.' })
    }

    if (!request.outputPath) {
      issues.push({ severity: 'error', code: 'missing-output-path', message: 'Export output path is missing.' })
    } else {
      try {
        const outputDir = dirname(request.outputPath)
        const stat = await fs.stat(outputDir)
        if (!stat.isDirectory()) {
          issues.push({ severity: 'error', code: 'invalid-output-directory', message: `${outputDir} is not a folder.`, path: outputDir })
        } else {
          await fs.access(outputDir, constants.W_OK)
        }
      } catch {
        issues.push({ severity: 'error', code: 'unwritable-output-directory', message: `Cannot write to ${dirname(request.outputPath)}.`, path: dirname(request.outputPath) })
      }

      try {
        const stat = await fs.stat(request.outputPath)
        if (stat.isDirectory()) {
          issues.push({ severity: 'error', code: 'output-path-is-directory', message: `${request.outputPath} is a folder.`, path: request.outputPath })
        }
      } catch {
        // It is fine for the output file not to exist yet.
      }
    }

    const paths = [...new Set((request.mediaPaths ?? []).filter(Boolean))]
    for (const path of paths) {
      try {
        const stat = await fs.stat(path)
        if (!stat.isFile()) {
          issues.push({ severity: 'error', code: 'not-a-file', message: `${path} does not point to a file.`, path })
        }
      } catch {
        issues.push({ severity: 'error', code: 'missing-file', message: `${path} is missing from disk.`, path })
      }
    }

    return {
      ok: !issues.some((issue) => issue.severity === 'error'),
      checkedAt: nowMs(),
      issues,
    }
  }

  private async runRendererExport(entry: ManagedExportJob): Promise<ExportJobResult> {
    const request = entry.request
    if (!request) return Promise.resolve({ error: 'Export request is missing.' })
    if (!entry.job.outputPath) return { error: 'Export output path is missing.' }
    if (!await this.host.ensureExportRenderer()) {
      return { error: 'Export renderer is not available to run canvas export.' }
    }

    return new Promise((resolve) => {
      this.rendererWaiters.set(entry.job.id, { resolve })
      const sent = this.host.sendToExportRenderer('export:rendererRun', {
        jobId: entry.job.id,
        outputPath: entry.job.outputPath!,
        plan: request.plan,
        profile: request.profile,
        cacheKey: request.cacheKey,
      } satisfies RendererExportJobRequest)

      if (!sent) {
        this.rendererWaiters.delete(entry.job.id)
        resolve({ error: 'Export renderer is not available to run canvas export.' })
      }
    })
  }

  private async tryReuseRenderCache(entry: ManagedExportJob): Promise<ExportJobResult | null> {
    const request = entry.request
    const cacheKey = request?.cacheKey
    const outputPath = entry.job.outputPath
    if (!request || entry.job.backend !== 'renderer-canvas' || !cacheKey || !outputPath) return null

    const cachePath = this.getRenderCachePath(cacheKey)
    const start = nowMs()

    try {
      const stat = await fs.stat(cachePath)
      if (!stat.isFile()) return null
      await copyFileAtomic(cachePath, outputPath)
      this.addLog(entry, `Render cache hit: ${cacheKey}`)
      return {
        success: true,
        path: outputPath,
        trace: {
          cacheKey,
          totalMs: nowMs() - start,
          frameCount: request.preflight.frameCount,
        },
      }
    } catch {
      this.addLog(entry, `Render cache miss: ${cacheKey}`)
      return null
    }
  }

  private async storeRenderCache(entry: ManagedExportJob, result: ExportJobResult): Promise<void> {
    const request = entry.request
    const cacheKey = request?.cacheKey ?? result.trace?.cacheKey
    if (entry.job.backend !== 'renderer-canvas' || !cacheKey || !result.path) return

    try {
      await copyFileAtomic(result.path, this.getRenderCachePath(cacheKey))
      this.addLog(entry, `Stored render cache: ${cacheKey}`)
    } catch (error: unknown) {
      this.addLog(entry, `Render cache store failed: ${String(error)}`)
    }
  }

  private settle(entry: ManagedExportJob, result: ExportJobResult): void {
    const { job } = entry

    entry.result = result

    if (result.trace) {
      this.addLog(entry, `Export trace: ${formatTraceSummary(result.trace)}`)
    }

    if (result.canceled || entry.cancelRequested) {
      job.status = 'canceled'
      this.addLog(entry, 'Export canceled')
    } else if (result.success) {
      job.status = 'completed'
      job.outputPath = result.path
      this.addLog(entry, `Export completed: ${result.path}`)
      job.progress = 100
    } else {
      job.status = 'failed'
      job.error = result.error ?? 'Export failed.'
      this.addLog(entry, `Export failed: ${job.error}`)
    }

    job.updatedAt = nowMs()
    this.finishTiming(entry)
    if (this.activeJobId === job.id) this.activeJobId = null
    this.rendererWaiters.delete(job.id)
    this.notify()
    this.pumpQueue()
  }

  private finishTiming(entry: ManagedExportJob): void {
    const { timing } = entry.job
    timing.finishedAt = nowMs()
    if (timing.startedAt) timing.totalMs = timing.finishedAt - timing.startedAt
    if (timing.exportMs && timing.exportMs > 0) {
      timing.effectiveFps = timing.frameCount / (timing.exportMs / 1000)
    }
  }

  private updateProgress(jobId: string, pct: number): void {
    const entry = this.jobs.get(jobId)
    if (!entry || isTerminalExportStatus(entry.job.status)) return

    entry.job.progress = Math.max(0, Math.min(100, Math.round(pct)))
    entry.job.updatedAt = nowMs()
    this.notify()
  }

  private addLog(entry: ManagedExportJob, message: string): void {
    entry.logs.push({ at: nowMs(), message })
    if (entry.logs.length > 300) entry.logs.shift()
  }

  private notify(): void {
    const snapshots = this.getJobs()
    this.host.sendToRenderers('export:jobsChanged', snapshots)
    void this.persist(snapshots)
  }

  private persist(snapshots = this.getJobs()): Promise<void> {
    this.persistPromise = this.persistPromise
      .then(async () => {
        await fs.mkdir(dirname(this.host.storagePath), { recursive: true })
        const persisted = snapshots
          .slice(0, MAX_PERSISTED_JOBS)
          .map(snapshotForPersistence)
        await fs.writeFile(this.host.storagePath, JSON.stringify(persisted), 'utf8')
      })
      .catch(() => {})

    return this.persistPromise
  }

  private pumpQueue(): void {
    if (this.activeJobId) return

    while (this.queue.length > 0) {
      const jobId = this.queue.shift()!
      const entry = this.jobs.get(jobId)
      if (!entry || isTerminalExportStatus(entry.job.status)) continue

      this.activeJobId = jobId
      this.notify()
      void this.runJob(jobId)
      return
    }
  }
}

export function createExportJobService(host: ExportJobServiceHost): ExportJobService {
  return new ExportJobService(host)
}
