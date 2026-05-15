import { execFile } from 'child_process'
import { join } from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import ffprobePath from 'ffprobe-static'

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobePath.path)

export { ffmpeg, ffmpegPath }

let videoEncoderCache: Promise<string[]> | null = null

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
