import type { IpcMain } from 'electron'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { dirname, join, resolve } from 'path'
import { ffmpegPath, hasAudioStream } from './export/ffmpegRuntime'

const WAVEFORM_VERSION = 1
const SAMPLE_RATE = 8000
const CHANNEL_COUNT = 2
const POINTS_PER_SECOND = [4, 16, 64]
const MAX_ANALYSIS_JOBS = 2

export interface WaveformChannelData {
  positive: number[]
  negative: number[]
  rms: number[]
}

export interface WaveformLevel {
  samplesPerPoint: number
  pointsPerSecond: number
  length: number
  channels: WaveformChannelData[]
}

export interface WaveformData {
  version: 1
  path: string
  fileSize: number
  mtimeMs: number
  durationMs: number
  sampleRate: number
  channelCount: number
  levels: WaveformLevel[]
}

export type WaveformResult = WaveformData | { error: string }

export interface MediaAnalysisService {
  getWaveform(path: string): Promise<WaveformResult>
}

interface FileSignature {
  absolutePath: string
  cacheKey: string
  fileSize: number
  mtimeMs: number
}

interface ChannelAccumulator {
  positive: number
  negative: number
  sumSq: number
  positiveOut: number[]
  negativeOut: number[]
  rmsOut: number[]
}

interface LevelAccumulator {
  samplesPerPoint: number
  pointsPerSecond: number
  framesInPoint: number
  channels: ChannelAccumulator[]
}

export function createMediaAnalysisService(getCacheDir: () => string): MediaAnalysisService {
  const pending = new Map<string, Promise<WaveformResult>>()
  let runningJobs = 0
  const queuedJobs: Array<() => void> = []

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolveTask, rejectTask) => {
      const run = () => {
        runningJobs++
        task()
          .then(resolveTask, rejectTask)
          .finally(() => {
            runningJobs--
            queuedJobs.shift()?.()
          })
      }

      if (runningJobs < MAX_ANALYSIS_JOBS) run()
      else queuedJobs.push(run)
    })
  }

  async function getWaveform(filePath: string): Promise<WaveformResult> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return { error: 'Invalid media path.' }
    }

    let signature: FileSignature
    try {
      signature = await getFileSignature(filePath)
    } catch (err: unknown) {
      return { error: `Media file is unavailable: ${errorMessage(err)}` }
    }

    const cached = pending.get(signature.cacheKey)
    if (cached) return cached

    const promise = getCachedOrAnalyze(signature, getCacheDir, enqueue)
      .catch((err: unknown) => ({ error: errorMessage(err) }))
      .finally(() => {
        pending.delete(signature.cacheKey)
      })

    pending.set(signature.cacheKey, promise)
    return promise
  }

  return { getWaveform }
}

export function registerMediaAnalysisIpc(ipcMain: IpcMain, service: MediaAnalysisService): void {
  ipcMain.handle('media:waveform', async (_event, path: string) => {
    const result = await service.getWaveform(path)
    if ('error' in result) console.warn(`Waveform analysis failed for ${path}: ${result.error}`)
    return result
  })
}

async function getCachedOrAnalyze(
  signature: FileSignature,
  getCacheDir: () => string,
  enqueue: <T>(task: () => Promise<T>) => Promise<T>,
): Promise<WaveformResult> {
  const cacheFile = join(getCacheDir(), `${signature.cacheKey}.json`)
  const cached = await readCachedWaveform(cacheFile, signature)
  if (cached) return cached

  return enqueue(async () => {
    const waveform = await analyzeWaveform(signature)
    await writeCachedWaveform(cacheFile, waveform)
    return waveform
  })
}

async function getFileSignature(filePath: string): Promise<FileSignature> {
  const absolutePath = resolve(filePath)
  const stat = await fs.stat(absolutePath)
  if (!stat.isFile()) throw new Error('path is not a file')

  const normalizedPath = process.platform === 'win32'
    ? absolutePath.toLowerCase()
    : absolutePath
  const mtimeMs = Math.round(stat.mtimeMs)
  const fileSize = stat.size
  const hash = createHash('sha1')
    .update(`waveform:${WAVEFORM_VERSION}`)
    .update('\0')
    .update(normalizedPath)
    .update('\0')
    .update(String(fileSize))
    .update('\0')
    .update(String(mtimeMs))
    .digest('hex')

  return { absolutePath, cacheKey: hash, fileSize, mtimeMs }
}

async function readCachedWaveform(cacheFile: string, signature: FileSignature): Promise<WaveformData | null> {
  try {
    const raw = await fs.readFile(cacheFile, 'utf8')
    const parsed = JSON.parse(raw) as Partial<WaveformData>
    if (
      parsed.version !== WAVEFORM_VERSION ||
      parsed.fileSize !== signature.fileSize ||
      parsed.mtimeMs !== signature.mtimeMs ||
      !Array.isArray(parsed.levels)
    ) {
      return null
    }
    return parsed as WaveformData
  } catch {
    return null
  }
}

async function writeCachedWaveform(cacheFile: string, waveform: WaveformData): Promise<void> {
  await fs.mkdir(dirname(cacheFile), { recursive: true })
  await fs.writeFile(cacheFile, JSON.stringify(waveform), 'utf8')
}

async function analyzeWaveform(signature: FileSignature): Promise<WaveformData> {
  const binaryPath = ffmpegPath
  if (!binaryPath) throw new Error('FFmpeg binary is unavailable.')

  const hasAudio = await hasAudioStream(signature.absolutePath)
  if (!hasAudio) throw new Error('No audio stream is available for this media file.')

  const levels = POINTS_PER_SECOND.map(createLevelAccumulator)
  let frameCount = 0
  let maxPeak = 0

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', signature.absolutePath,
      '-map', '0:a:0',
      '-vn',
      '-sn',
      '-ac', String(CHANNEL_COUNT),
      '-ar', String(SAMPLE_RATE),
      '-f', 'f32le',
      'pipe:1',
    ]
    const proc = spawn(binaryPath, args, { windowsHide: true })
    let carry: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let stderr = ''
    let failed = false

    proc.stdout.on('data', (chunk: Buffer) => {
      if (failed) return
      try {
        const data: Buffer<ArrayBufferLike> = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk
        const bytesPerFrame = CHANNEL_COUNT * 4
        const completeBytes = data.length - (data.length % bytesPerFrame)

        for (let offset = 0; offset < completeBytes; offset += bytesPerFrame) {
          const samples: number[] = []
          for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
            let sample = data.readFloatLE(offset + channel * 4)
            if (!Number.isFinite(sample)) sample = 0
            maxPeak = Math.max(maxPeak, Math.abs(sample))
            samples.push(sample)
          }

          frameCount++
          for (const level of levels) pushFrame(level, samples)
        }

        carry = completeBytes < data.length ? data.subarray(completeBytes) : Buffer.alloc(0)
      } catch (err: unknown) {
        failed = true
        proc.kill()
        rejectPromise(err)
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8')
    })

    proc.on('error', (err: Error) => {
      failed = true
      rejectPromise(err)
    })

    proc.on('close', (code: number | null) => {
      if (failed) return
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || `FFmpeg exited with code ${code ?? 'unknown'}.`))
        return
      }
      if (frameCount === 0) {
        rejectPromise(new Error('No audio samples were decoded.'))
        return
      }
      for (const level of levels) flushLevel(level)
      resolvePromise()
    })
  })

  return {
    version: WAVEFORM_VERSION,
    path: signature.absolutePath,
    fileSize: signature.fileSize,
    mtimeMs: signature.mtimeMs,
    durationMs: Math.round((frameCount / SAMPLE_RATE) * 1000),
    sampleRate: SAMPLE_RATE,
    channelCount: CHANNEL_COUNT,
    levels: levels.map(level => finalizeLevel(level, maxPeak)),
  }
}

function createLevelAccumulator(pointsPerSecond: number): LevelAccumulator {
  return {
    pointsPerSecond,
    samplesPerPoint: Math.max(1, Math.round(SAMPLE_RATE / pointsPerSecond)),
    framesInPoint: 0,
    channels: Array.from({ length: CHANNEL_COUNT }, () => ({
      positive: 0,
      negative: 0,
      sumSq: 0,
      positiveOut: [],
      negativeOut: [],
      rmsOut: [],
    })),
  }
}

function pushFrame(level: LevelAccumulator, samples: number[]): void {
  for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
    const sample = samples[channel] ?? 0
    const accumulator = level.channels[channel]
    if (sample > accumulator.positive) accumulator.positive = sample
    if (sample < accumulator.negative) accumulator.negative = sample
    accumulator.sumSq += sample * sample
  }

  level.framesInPoint++
  if (level.framesInPoint >= level.samplesPerPoint) flushLevel(level)
}

function flushLevel(level: LevelAccumulator): void {
  if (level.framesInPoint === 0) return

  for (const channel of level.channels) {
    channel.positiveOut.push(channel.positive)
    channel.negativeOut.push(channel.negative)
    channel.rmsOut.push(Math.sqrt(channel.sumSq / level.framesInPoint))
    channel.positive = 0
    channel.negative = 0
    channel.sumSq = 0
  }

  level.framesInPoint = 0
}

function finalizeLevel(level: LevelAccumulator, maxPeak: number): WaveformLevel {
  const normalizeBy = maxPeak > 0 ? maxPeak : 1
  const channels = level.channels.map(channel => ({
    positive: channel.positiveOut.map(value => quantize(value / normalizeBy)),
    negative: channel.negativeOut.map(value => quantize(value / normalizeBy)),
    rms: channel.rmsOut.map(value => quantize(value / normalizeBy)),
  }))

  return {
    samplesPerPoint: level.samplesPerPoint,
    pointsPerSecond: level.pointsPerSecond,
    length: channels[0]?.positive.length ?? 0,
    channels,
  }
}

function quantize(value: number): number {
  return Math.round(value * 10000) / 10000
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
