import { spawn, type ChildProcess } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { constants, promises as fs } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import type { createExportEngine } from '../exportEngine'
import { appendVideoEncoderArgs } from './encoderOptions'
import { ffmpegPath, hasAudioStream } from './ffmpegRuntime'
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
  type HybridExportSegmentRequest,
  type RenderBackend,
  type RendererExportJobRequest,
  type SegmentRenderBackend,
} from './contracts'

type ExportEngine = ReturnType<typeof createExportEngine>
type ExportEncoderSettings = ExportJobStartRequest['profile']['encoder']

interface ProgressScale {
  base: number
  span: number
}

interface HybridAudioSource {
  path: string
  startTime: number
  trimStart: number
  trimEnd: number
  volume: number
}

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
const MAX_RENDER_CACHE_FILES = 120
const MAX_RENDER_CACHE_BYTES = 4 * 1024 * 1024 * 1024
const INTERRUPTED_EXPORT_MESSAGE = 'Export was interrupted before it finished.'

function exportBackendMode(backend: RenderBackend): ExportJobMode {
  if (backend === 'hybrid') return 'hybrid'
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

function isHardwareVideoEncoder(encoder: ExportEncoderSettings): boolean {
  return encoder.videoCodec !== 'libx264'
}

function withSoftwareVideoEncoder(encoder: ExportEncoderSettings): ExportEncoderSettings {
  return {
    ...encoder,
    videoCodec: 'libx264',
  }
}

function createSoftwareEncoderFallbackRequest(request: ExportJobStartRequest): ExportJobStartRequest {
  const encoder = withSoftwareVideoEncoder(request.profile.encoder)

  return {
    ...request,
    profile: {
      ...request.profile,
      encoder,
    },
    nativeOptions: {
      ...request.nativeOptions,
      encoder,
      outputPath: request.outputPath ?? request.nativeOptions.outputPath,
    },
    cacheKey: undefined,
    hybridPlan: request.hybridPlan
      ? {
        segments: request.hybridPlan.segments.map((segment) => ({
          ...segment,
          cacheKey: undefined,
          nativeOptions: {
            ...segment.nativeOptions,
            encoder,
          },
        })),
      }
      : undefined,
  }
}

function trimLogChunk(chunk: string): string[] {
  return chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function isNoisyFfmpegProgressLine(line: string): boolean {
  return /^frame=\s*\d+/i.test(line) || /^size=\s*\S+\s+time=/i.test(line)
}

function runFfmpeg(args: string[], onLog: (message: string) => void, registerProcess?: (proc: ChildProcess) => void): Promise<void> {
  if (!ffmpegPath) return Promise.reject(new Error('ffmpeg binary is not available'))

  return new Promise((resolve, reject) => {
    const stderrBuf: string[] = []
    const proc = spawn(ffmpegPath, args, { windowsHide: true })
    registerProcess?.(proc)

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      stderrBuf.push(text)
      for (const line of trimLogChunk(text)) {
        if (!isNoisyFfmpegProgressLine(line)) onLog(line)
      }
    })

    proc.on('error', (error) => reject(error))
    proc.on('close', (code) => {
      if (code === 0 || code === null) {
        resolve()
        return
      }

      reject(new Error(`ffmpeg exited with code ${code}: ${stderrBuf.join('').slice(-2000)}`))
    })
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function getProbeStreams(probe: unknown): Record<string, unknown>[] {
  const record = asRecord(probe)
  const streams = record?.streams
  return Array.isArray(streams) ? streams.flatMap((stream) => asRecord(stream) ?? []) : []
}

function getProbeDurationMs(probe: unknown): number | null {
  const record = asRecord(probe)
  const format = asRecord(record?.format)
  const durationSec = asNumber(format?.duration)
  return durationSec == null ? null : durationSec * 1000
}

function describeProbeVideo(stream: Record<string, unknown> | undefined): string {
  if (!stream) return 'no video'
  const codec = typeof stream.codec_name === 'string' ? stream.codec_name : 'video'
  const width = asNumber(stream.width)
  const height = asNumber(stream.height)
  return width && height ? `${codec} ${width}x${height}` : codec
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
  private progressScales = new Map<string, ProgressScale>()
  private hybridConcatProcesses = new Map<string, ChildProcess>()
  private persistPromise: Promise<void> = Promise.resolve()

  constructor(private readonly host: ExportJobServiceHost) {}

  private getRenderCacheDir(): string {
    return join(dirname(this.host.storagePath), 'render-cache')
  }

  private getRenderCachePath(cacheKey: string): string {
    return join(this.getRenderCacheDir(), `${hashCacheKey(cacheKey)}.mp4`)
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
    this.hybridConcatProcesses.get(jobId)?.kill('SIGTERM')
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
    this.updateProgress(jobId, this.scaleProgress(jobId, pct))
  }

  handleEngineLog(jobId: string, message: string): void {
    const entry = this.jobs.get(jobId)
    if (!entry) return
    this.addLog(entry, message)
    this.notify()
  }

  handleRendererProgress(jobId: string, pct: number): void {
    this.updateProgress(jobId, this.scaleProgress(jobId, pct))
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
      let exportRequest = await this.withEncoderAvailabilityFallback(entry, request)
      let cachedResult: ExportJobResult | null = null
      let result: ExportJobResult

      if (job.backend === 'hybrid') {
        result = await this.runHybridExport(entry, exportRequest)
      } else {
        cachedResult = exportRequest === request ? await this.tryReuseRenderCache(entry) : null
        result = cachedResult ?? await this.runExportAttempt(entry, exportRequest, job.backend)

        if (!cachedResult && this.shouldRetryWithSoftwareEncoder(exportRequest, result)) {
          this.addLog(entry, `Hardware encoder failed: ${result.error ?? 'unknown error'}`)
          exportRequest = createSoftwareEncoderFallbackRequest(exportRequest)
          this.addLog(entry, 'Retrying export with Software x264')
          this.updateProgress(job.id, 0)
          result = await this.runExportAttempt(entry, exportRequest, job.backend)
        }

        if (!cachedResult && result.success) await this.storeRenderCache(entry, result)
      }

      if (result.success && result.path) await this.logOutputProbe(entry, result.path, request)

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

  private async logOutputProbe(entry: ManagedExportJob, outputPath: string, request: ExportJobStartRequest): Promise<void> {
    try {
      const [stat, probe] = await Promise.all([
        fs.stat(outputPath),
        this.host.engine.ffprobe(outputPath),
      ])
      const streams = getProbeStreams(probe)
      const videoStreams = streams.filter((stream) => stream.codec_type === 'video')
      const audioStreams = streams.filter((stream) => stream.codec_type === 'audio')
      const durationMs = getProbeDurationMs(probe)
      const durationText = durationMs == null ? 'unknown duration' : formatDurationMs(durationMs)
      const videoText = describeProbeVideo(videoStreams[0])

      this.addLog(entry, `Output probe: ${videoText}, ${audioStreams.length} audio stream${audioStreams.length === 1 ? '' : 's'}, ${durationText}, ${formatBytes(stat.size)}`)

      if (videoStreams.length === 0) {
        this.addLog(entry, 'Output probe warning: exported file has no video stream.')
      }

      if (durationMs != null) {
        const frameMs = 1000 / request.preflight.fps
        const driftMs = Math.abs(durationMs - request.preflight.durationMs)
        if (driftMs > frameMs * 2) {
          this.addLog(entry, `Output probe warning: duration differs by ${formatDurationMs(driftMs)} from timeline.`)
        }
      }
    } catch (error: unknown) {
      this.addLog(entry, `Output probe failed: ${String(error)}`)
    }
  }

  private createSegmentRequest(
    request: ExportJobStartRequest,
    segment: HybridExportSegmentRequest,
    outputPath: string,
  ): ExportJobStartRequest {
    return {
      ...request,
      plan: segment.plan,
      nativeOptions: {
        ...segment.nativeOptions,
        encoder: request.profile.encoder,
        outputPath,
        includeAudio: false,
      },
      outputPath,
      cacheKey: segment.cacheKey,
      hybridPlan: undefined,
    }
  }

  private async runHybridExport(entry: ManagedExportJob, request: ExportJobStartRequest): Promise<ExportJobResult> {
    const outputPath = entry.job.outputPath
    const segments = request.hybridPlan?.segments ?? []
    if (!outputPath) return { error: 'Export output path is missing.' }
    if (segments.length === 0) return { error: 'Hybrid export plan is missing segments.' }

    const tempDir = await fs.mkdtemp(join(tmpdir(), `can-cut-${entry.job.id}-`))
    const segmentPaths: string[] = []

    try {
      this.addLog(entry, `Hybrid export: ${segments.length} segments`)

      for (const segment of segments) {
        if (entry.cancelRequested) return { canceled: true }

        const segmentNumber = segment.index + 1
        const segmentPath = join(tempDir, `segment-${String(segment.index).padStart(4, '0')}.mp4`)
        const segmentSpan = 90 / segments.length
        let segmentCacheKey = segment.cacheKey
        await fs.mkdir(dirname(segmentPath), { recursive: true })
        this.progressScales.set(entry.job.id, { base: segment.index * segmentSpan, span: segmentSpan })
        this.addLog(entry, `Hybrid segment ${segmentNumber}/${segments.length}: ${segment.backend}, ${(segment.startMs / 1000).toFixed(2)}s-${(segment.endMs / 1000).toFixed(2)}s${segment.reason ? ` (${segment.reason})` : ''}`)

        let result: ExportJobResult | null = segment.backend === 'renderer-canvas' && segmentCacheKey
          ? await this.tryReuseRenderCacheFile(entry, segmentCacheKey, segmentPath)
          : null

        if (!result) {
          let segmentRequest = this.createSegmentRequest(request, segment, segmentPath)
          result = await this.runExportAttempt(entry, segmentRequest, segment.backend)

          if (this.shouldRetryWithSoftwareEncoder(segmentRequest, result)) {
            this.addLog(entry, `Hardware encoder failed for segment ${segmentNumber}: ${result.error ?? 'unknown error'}`)
            segmentRequest = createSoftwareEncoderFallbackRequest(segmentRequest)
            segmentCacheKey = undefined
            this.addLog(entry, `Retrying segment ${segmentNumber} with Software x264`)
            this.updateProgress(entry.job.id, segment.index * segmentSpan)
            result = await this.runExportAttempt(entry, segmentRequest, segment.backend)
          }

          if (result.success && segment.backend === 'renderer-canvas' && segmentCacheKey) {
            await this.storeRenderCacheFile(entry, segmentCacheKey, segmentPath)
          }
        }

        if (result.canceled || entry.cancelRequested) return { canceled: true }
        if (!result.success) return result
        segmentPaths.push(result.path ?? segmentPath)
        this.updateProgress(entry.job.id, (segment.index + 1) * segmentSpan)
      }

      if (entry.cancelRequested) return { canceled: true }
      this.progressScales.delete(entry.job.id)
      this.addLog(entry, 'Concatenating hybrid segments')
      this.updateProgress(entry.job.id, 92)
      await this.concatHybridSegments(entry, request, segmentPaths, outputPath)
      if (entry.cancelRequested) return { canceled: true }
      this.updateProgress(entry.job.id, 100)
      return { success: true, path: outputPath }
    } catch (error: unknown) {
      if (entry.cancelRequested) return { canceled: true }
      return { error: String(error) }
    } finally {
      this.progressScales.delete(entry.job.id)
      this.hybridConcatProcesses.delete(entry.job.id)
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async getHybridAudioSources(request: ExportJobStartRequest): Promise<HybridAudioSource[]> {
    const audioSources: HybridAudioSource[] = []

    for (const clip of request.nativeOptions.clips) {
      if (!clip.path) continue
      if (clip.type === 'audio') {
        audioSources.push({ path: clip.path, startTime: clip.startTime, trimStart: clip.trimStart, trimEnd: clip.trimEnd, volume: clip.volume })
      } else if (clip.type === 'video' && await hasAudioStream(clip.path)) {
        audioSources.push({ path: clip.path, startTime: clip.startTime, trimStart: clip.trimStart, trimEnd: clip.trimEnd, volume: clip.volume })
      }
    }

    return audioSources
  }

  private buildHybridConcatArgs(segmentPaths: string[], request: ExportJobStartRequest, audioSources: HybridAudioSource[], outputPath: string, encoder = request.profile.encoder): string[] {
    const args = ['-y']
    const totalSec = (request.preflight.durationMs / 1000).toFixed(3)

    for (const segmentPath of segmentPaths) args.push('-i', segmentPath)
    for (const source of audioSources) args.push('-i', source.path)

    const parts: string[] = []
    const videoLabels = segmentPaths.map((_, index) => `[${index}:v:0]`).join('')
    parts.push(`${videoLabels}concat=n=${segmentPaths.length}:v=1:a=0[vcat]`)

    const audioLabels: string[] = []
    for (let ai = 0; ai < audioSources.length; ai++) {
      const source = audioSources[ai]
      const inputIndex = segmentPaths.length + ai
      const ts = (source.trimStart / 1000).toFixed(6)
      const dur = ((source.trimEnd - source.trimStart) / 1000).toFixed(6)
      const startMs = Math.round(source.startTime)
      const vol = (source.volume / 100).toFixed(3)
      const label = `hao${ai}`
      parts.push(`[${inputIndex}:a]atrim=start=${ts}:duration=${dur},asetpts=PTS-STARTPTS,volume=${vol},adelay=delays=${startMs}ms:all=1,apad=whole_dur=${totalSec}[${label}]`)
      audioLabels.push(`[${label}]`)
    }

    if (audioLabels.length > 0) {
      parts.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest[haout]`)
    }

    args.push('-filter_complex', parts.join(';'), '-map', '[vcat]')
    appendVideoEncoderArgs(args, encoder)
    args.push('-r', String(request.preflight.fps))

    if (audioLabels.length > 0) {
      args.push('-map', '[haout]', '-c:a', encoder.audioCodec, '-b:a', encoder.audioBitrate, '-shortest')
    }

    args.push(outputPath)
    return args
  }

  private async concatHybridSegments(entry: ManagedExportJob, request: ExportJobStartRequest, segmentPaths: string[], outputPath: string): Promise<void> {
    if (segmentPaths.length === 0) throw new Error('Hybrid export produced no segments.')

    const audioSources = await this.getHybridAudioSources(request)
    const runConcat = (encoder = request.profile.encoder) => runFfmpeg(
      this.buildHybridConcatArgs(segmentPaths, request, audioSources, outputPath, encoder),
      (message) => this.addLog(entry, message),
      (proc) => this.hybridConcatProcesses.set(entry.job.id, proc),
    )

    try {
      await runConcat()
    } catch (error: unknown) {
      if (!isHardwareVideoEncoder(request.profile.encoder)) throw error
      this.addLog(entry, `Hardware encoder failed during hybrid concat: ${String(error)}`)
      this.addLog(entry, 'Retrying hybrid concat with Software x264')
      await runConcat(withSoftwareVideoEncoder(request.profile.encoder))
    }
  }

  private async runExportAttempt(entry: ManagedExportJob, request: ExportJobStartRequest, backend: SegmentRenderBackend): Promise<ExportJobResult> {
    try {
      return backend === 'ffmpeg-native'
        ? await this.host.engine.exportVideo(entry.job.id, request.nativeOptions)
        : await this.runRendererExport(entry, request)
    } catch (error: unknown) {
      return { error: String(error) }
    }
  }

  private async withEncoderAvailabilityFallback(entry: ManagedExportJob, request: ExportJobStartRequest): Promise<ExportJobStartRequest> {
    const encoder = request.profile.encoder
    if (!isHardwareVideoEncoder(encoder)) return request

    try {
      const encoders = await this.host.engine.listUsableVideoEncoders()
      if (encoders.includes(encoder.videoCodec)) return request
      this.addLog(entry, `${encoder.videoCodec} is not usable on this system; using Software x264`)
      return createSoftwareEncoderFallbackRequest(request)
    } catch {
      return request
    }
  }

  private shouldRetryWithSoftwareEncoder(request: ExportJobStartRequest, result: ExportJobResult): boolean {
    return Boolean(result.error && !result.canceled && isHardwareVideoEncoder(request.profile.encoder))
  }

  private async runRendererExport(entry: ManagedExportJob, request: ExportJobStartRequest): Promise<ExportJobResult> {
    const outputPath = request.outputPath ?? entry.job.outputPath
    if (!outputPath) return { error: 'Export output path is missing.' }
    if (!await this.host.ensureExportRenderer()) {
      return { error: 'Export renderer is not available to run canvas export.' }
    }

    return new Promise((resolve) => {
      this.rendererWaiters.set(entry.job.id, { resolve })
      const sent = this.host.sendToExportRenderer('export:rendererRun', {
        jobId: entry.job.id,
        outputPath,
        plan: request.plan,
        profile: request.profile,
        cacheKey: request.cacheKey,
        includeAudio: request.nativeOptions.includeAudio !== false,
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

    const result = await this.tryReuseRenderCacheFile(entry, cacheKey, outputPath)
    if (!result?.success) return result

    return {
      ...result,
      trace: {
        ...result.trace,
        frameCount: request.preflight.frameCount,
      },
    }
  }

  private async tryReuseRenderCacheFile(entry: ManagedExportJob, cacheKey: string, outputPath: string): Promise<ExportJobResult | null> {
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
        },
      }
    } catch {
      this.addLog(entry, `Render cache miss: ${cacheKey}`)
      return null
    }
  }

  private async storeRenderCache(entry: ManagedExportJob, result: ExportJobResult): Promise<void> {
    const request = entry.request
    const cacheKey = result.trace?.cacheKey ?? request?.cacheKey
    if (entry.job.backend !== 'renderer-canvas' || !cacheKey || !result.path) return

    await this.storeRenderCacheFile(entry, cacheKey, result.path)
  }

  private async storeRenderCacheFile(entry: ManagedExportJob, cacheKey: string, sourcePath: string): Promise<void> {
    try {
      await copyFileAtomic(sourcePath, this.getRenderCachePath(cacheKey))
      this.addLog(entry, `Stored render cache: ${cacheKey}`)
      await this.pruneRenderCache(entry)
    } catch (error: unknown) {
      this.addLog(entry, `Render cache store failed: ${String(error)}`)
    }
  }

  private async pruneRenderCache(entry: ManagedExportJob): Promise<void> {
    try {
      const cacheDir = this.getRenderCacheDir()
      const entries = await fs.readdir(cacheDir, { withFileTypes: true })
      const files = await Promise.all(entries
        .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.mp4'))
        .map(async (dirent) => {
          const path = join(cacheDir, dirent.name)
          const stat = await fs.stat(path)
          return { path, size: stat.size, mtimeMs: stat.mtimeMs }
        }))

      files.sort((a, b) => b.mtimeMs - a.mtimeMs)
      let totalBytes = files.reduce((sum, file) => sum + file.size, 0)
      let removedCount = 0
      let removedBytes = 0

      for (let index = files.length - 1; index >= 0; index--) {
        if (files.length - removedCount <= MAX_RENDER_CACHE_FILES && totalBytes <= MAX_RENDER_CACHE_BYTES) break
        const file = files[index]
        await fs.rm(file.path, { force: true })
        totalBytes -= file.size
        removedBytes += file.size
        removedCount++
      }

      if (removedCount > 0) {
        this.addLog(entry, `Pruned render cache: ${removedCount} files, ${formatBytes(removedBytes)}`)
      }
    } catch {
      // Cache cleanup should never affect export success.
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
    this.progressScales.delete(job.id)
    this.hybridConcatProcesses.delete(job.id)
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

  private scaleProgress(jobId: string, pct: number): number {
    const scale = this.progressScales.get(jobId)
    if (!scale) return pct
    return scale.base + (Math.max(0, Math.min(100, pct)) / 100) * scale.span
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
