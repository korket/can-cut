import { join } from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import ffprobePath from 'ffprobe-static'

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobePath.path)

export { ffmpeg, ffmpegPath }

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
