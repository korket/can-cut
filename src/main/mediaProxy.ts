import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { constants, promises as fs } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import type { IpcMain } from 'electron'
import { ffmpegPath } from './export/ffmpegRuntime'

export type ProxyProfile = '720p'

export interface MediaProxyRequest {
  path: string
  profile?: ProxyProfile
}

export type MediaProxyResult =
  | {
      status: 'ready'
      profile: ProxyProfile
      path: string
      width: number
      height: number
      fps: number
      sourcePath: string
      cacheKey: string
      generatedAt: string
    }
  | {
      status: 'failed'
      profile: ProxyProfile
      sourcePath: string
      error: string
      generatedAt: string
    }

export interface MediaProxyService {
  ensureProxy(request: MediaProxyRequest): Promise<MediaProxyResult>
}

interface FileSignature {
  absolutePath: string
  cacheKey: string
  fileSize: number
  mtimeMs: number
}

const PROXY_VERSION = 1
const PROXY_PROFILE: ProxyProfile = '720p'
const PROXY_FPS = 30
const PROXY_HEIGHT = 720

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function metadataPath(outputPath: string): string {
  return `${outputPath}.json`
}

async function getFileSignature(filePath: string, profile: ProxyProfile): Promise<FileSignature> {
  const absolutePath = resolve(filePath)
  const stat = await fs.stat(absolutePath)
  if (!stat.isFile()) throw new Error('path is not a file')

  const normalizedPath = process.platform === 'win32'
    ? absolutePath.toLowerCase()
    : absolutePath
  const mtimeMs = Math.round(stat.mtimeMs)
  const fileSize = stat.size
  const cacheKey = createHash('sha1')
    .update(`proxy:${PROXY_VERSION}:${profile}`)
    .update('\0')
    .update(normalizedPath)
    .update('\0')
    .update(String(fileSize))
    .update('\0')
    .update(String(mtimeMs))
    .digest('hex')

  return { absolutePath, cacheKey, fileSize, mtimeMs }
}

function outputPathFor(cacheDir: string, signature: FileSignature): string {
  const sourceName = basename(signature.absolutePath).replace(/[^a-z0-9._-]+/gi, '_') || 'media'
  return join(cacheDir, `${signature.cacheKey}-${sourceName}.proxy.mp4`)
}

async function readCachedProxy(outputPath: string, signature: FileSignature, profile: ProxyProfile): Promise<MediaProxyResult | null> {
  try {
    await fs.access(outputPath, constants.R_OK)
    const raw = await fs.readFile(metadataPath(outputPath), 'utf8')
    const parsed = JSON.parse(raw) as Partial<MediaProxyResult> & { fileSize?: number; mtimeMs?: number }
    if (
      parsed.status !== 'ready' ||
      parsed.profile !== profile ||
      parsed.cacheKey !== signature.cacheKey ||
      parsed.fileSize !== signature.fileSize ||
      parsed.mtimeMs !== signature.mtimeMs ||
      parsed.path !== outputPath
    ) {
      return null
    }

    return parsed as MediaProxyResult
  } catch {
    return null
  }
}

async function writeProxyMetadata(outputPath: string, result: MediaProxyResult, signature: FileSignature): Promise<void> {
  await fs.writeFile(metadataPath(outputPath), JSON.stringify({
    ...result,
    version: PROXY_VERSION,
    fileSize: signature.fileSize,
    mtimeMs: signature.mtimeMs,
  }), 'utf8')
}

function runProxyEncode(sourcePath: string, outputPath: string): Promise<void> {
  if (!ffmpegPath) return Promise.reject(new Error('FFmpeg binary is unavailable.'))

  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', sourcePath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-vf', `scale=-2:${PROXY_HEIGHT}`,
    '-r', String(PROXY_FPS),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-shortest',
    '-f', 'mp4',
    outputPath,
  ]

  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''

    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8')
    })
    proc.on('error', rejectPromise)
    proc.on('close', (code) => {
      if (code === 0 || code === null) {
        resolvePromise()
        return
      }

      rejectPromise(new Error(stderr.trim() || `FFmpeg exited with code ${code}`))
    })
  })
}

export function createMediaProxyService(getCacheDir: () => string): MediaProxyService {
  const pending = new Map<string, Promise<MediaProxyResult>>()

  async function ensureProxy(request: MediaProxyRequest): Promise<MediaProxyResult> {
    const profile = request.profile ?? PROXY_PROFILE
    const sourcePath = request.path
    const generatedAt = new Date().toISOString()

    try {
      if (profile !== PROXY_PROFILE) throw new Error(`Unsupported proxy profile: ${profile}`)

      const signature = await getFileSignature(sourcePath, profile)
      const cached = pending.get(signature.cacheKey)
      if (cached) return cached

      const promise = (async (): Promise<MediaProxyResult> => {
        const cacheDir = getCacheDir()
        await fs.mkdir(cacheDir, { recursive: true })
        const outputPath = outputPathFor(cacheDir, signature)
        const cachedResult = await readCachedProxy(outputPath, signature, profile)
        if (cachedResult) return cachedResult

        const tempPath = `${outputPath}.${process.pid}.tmp.mp4`
        await fs.rm(tempPath, { force: true }).catch(() => {})
        try {
          await runProxyEncode(signature.absolutePath, tempPath)
        } catch (error) {
          await fs.rm(tempPath, { force: true }).catch(() => {})
          throw error
        }
        await fs.rm(outputPath, { force: true }).catch(() => {})
        await fs.rename(tempPath, outputPath)

        const result: MediaProxyResult = {
          status: 'ready',
          profile,
          path: outputPath,
          width: 1280,
          height: PROXY_HEIGHT,
          fps: PROXY_FPS,
          sourcePath: signature.absolutePath,
          cacheKey: signature.cacheKey,
          generatedAt,
        }
        await writeProxyMetadata(outputPath, result, signature)
        return result
      })().catch(async (error: unknown): Promise<MediaProxyResult> => {
        return {
          status: 'failed',
          profile,
          sourcePath: resolve(sourcePath),
          error: errorMessage(error),
          generatedAt: new Date().toISOString(),
        }
      }).finally(() => {
        pending.delete(signature.cacheKey)
      })

      pending.set(signature.cacheKey, promise)
      return promise
    } catch (error: unknown) {
      return {
        status: 'failed',
        profile,
        sourcePath: sourcePath ? resolve(sourcePath) : '',
        error: errorMessage(error),
        generatedAt,
      }
    }
  }

  return { ensureProxy }
}

export function registerMediaProxyIpc(ipcMain: IpcMain, service: MediaProxyService): void {
  ipcMain.handle('media:proxy:ensure', (_event, request: MediaProxyRequest) => service.ensureProxy(request))
}
