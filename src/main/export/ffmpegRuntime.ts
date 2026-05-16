import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import ffprobePath from 'ffprobe-static'

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobePath.path)

export { ffmpeg, ffmpegPath }

let videoEncoderCache: Promise<string[]> | null = null
let usableVideoEncoderCache: Promise<string[]> | null = null

const VIDEO_ENCODER_PROBE_ORDER = ['libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf']

function execFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg binary is not available'))
      return
    }

    execFile(ffmpegPath, args, { windowsHide: true, timeout: 15000 }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function probeVideoEncoderArgs(encoder: string, outPath: string): string[] {
  const pixelFormat = encoder === 'h264_qsv' ? 'nv12' : 'yuv420p'
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=10:duration=0.4',
    '-frames:v', '4',
    '-an',
    '-c:v', encoder,
    '-pix_fmt', pixelFormat,
  ]

  if (encoder === 'libx264') {
    args.push('-preset', 'veryfast', '-crf', '28', '-threads', '0')
  } else if (encoder === 'h264_nvenc') {
    args.push('-preset', 'fast', '-rc:v', 'vbr', '-cq:v', '28', '-b:v', '0')
  } else if (encoder === 'h264_qsv') {
    args.push('-preset', 'veryfast', '-global_quality:v', '28')
  } else if (encoder === 'h264_amf') {
    args.push('-quality', 'speed', '-rc', 'cqp', '-qp_i', '28', '-qp_p', '28', '-qp_b', '28')
  }

  args.push('-y', outPath)
  return args
}

async function canUseVideoEncoder(encoder: string, tempDir: string): Promise<boolean> {
  const outPath = join(tempDir, `${encoder}.mp4`)

  try {
    await fs.rm(outPath, { force: true })
    await execFfmpeg(probeVideoEncoderArgs(encoder, outPath))
    const stat = await fs.stat(outPath)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  } finally {
    await fs.rm(outPath, { force: true }).catch(() => {})
  }
}

export function listVideoEncoders(): Promise<string[]> {
  if (!ffmpegPath) return Promise.resolve([])
  if (videoEncoderCache) return videoEncoderCache

  videoEncoderCache = new Promise((resolve) => {
    execFile(ffmpegPath, ['-hide_banner', '-encoders'], { windowsHide: true }, (_err, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`
      const encoders = new Set<string>()

      for (const line of output.split(/\r?\n/)) {
        const match = /^\s*V\S*\s+(\S+)/.exec(line)
        if (match) encoders.add(match[1])
      }

      resolve([...encoders].sort())
    })
  })

  return videoEncoderCache
}

export function listUsableVideoEncoders(): Promise<string[]> {
  if (!ffmpegPath) return Promise.resolve([])
  if (usableVideoEncoderCache) return usableVideoEncoderCache

  usableVideoEncoderCache = (async () => {
    const listed = new Set(await listVideoEncoders())
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'can-cut-encoders-'))
    const usable: string[] = []

    try {
      for (const encoder of VIDEO_ENCODER_PROBE_ORDER) {
        if (!listed.has(encoder)) continue
        if (await canUseVideoEncoder(encoder, tempDir)) usable.push(encoder)
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }

    return usable.includes('libx264') ? usable : ['libx264', ...usable]
  })()

  return usableVideoEncoderCache
}

export function ffprobe(filePath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err.message)
      else resolve(data)
    })
  })
}

export function hasAudioStream(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        resolve(false)
        return
      }
      resolve((data.streams ?? []).some((stream) => stream.codec_type === 'audio'))
    })
  })
}

export function createThumbnail(filePath: string, timeMs: number, tmpDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outFile = join(tmpDir, `thumb_${Date.now()}.png`)
    const timeSec = timeMs / 1000

    ffmpeg(filePath)
      .seekInput(timeSec)
      .frames(1)
      .output(outFile)
      .on('end', () => resolve(outFile))
      .on('error', (err) => reject(err.message))
      .run()
  })
}
