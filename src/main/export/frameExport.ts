import { spawn, type ChildProcess } from 'child_process'
import { ffmpegPath, hasAudioStream } from './ffmpegRuntime'
import type { ExportEngineHost, FrameAudioSource, FrameClip, FrameExportOptions, FrameItem } from './types'

interface FrameExportSession {
  proc: ChildProcess
  outPath: string
  stderrBuf: string[]
  canceled: boolean
  closed: boolean
  exitCode: number | null
  closeWaiters: Array<(code: number | null) => void>
  error?: string
}

async function getFrameAudioSources(clips: FrameClip[], timelineItems: FrameItem[]) {
  const audioSources: FrameAudioSource[] = []

  for (const item of timelineItems) {
    const clip = clips.find((candidate) => candidate.id === item.clipId)
    if (!clip || !clip.path) continue

    if (clip.type === 'audio') {
      audioSources.push({ path: clip.path, startTime: item.startTime, trimStart: item.trimStart, trimEnd: item.trimEnd, volume: item.volume })
    } else if (clip.type === 'video' && await hasAudioStream(clip.path)) {
      audioSources.push({ path: clip.path, startTime: item.startTime, trimStart: item.trimStart, trimEnd: item.trimEnd, volume: item.volume })
    }
  }

  return audioSources
}

function buildFrameExportArgs(options: FrameExportOptions, audioSources: FrameAudioSource[], outPath: string): string[] {
  const { fps, totalMs, encoder } = options
  const totalSec = (totalMs / 1000).toFixed(3)
  const args: string[] = encoder.framePipeFormat === 'raw-rgba'
    ? ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${options.W}x${options.H}`, '-framerate', String(fps), '-i', 'pipe:0']
    : ['-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0']

  for (const source of audioSources) args.push('-i', source.path)

  if (audioSources.length > 0) {
    const parts: string[] = []
    const audioLabels: string[] = []

    for (let ai = 0; ai < audioSources.length; ai++) {
      const source = audioSources[ai]
      const ts = (source.trimStart / 1000).toFixed(6)
      const dur = ((source.trimEnd - source.trimStart) / 1000).toFixed(6)
      const startMs = Math.round(source.startTime)
      const vol = (source.volume / 100).toFixed(3)
      const lbl = `ao${ai}`
      parts.push(`[${ai + 1}:a]atrim=start=${ts}:duration=${dur},asetpts=PTS-STARTPTS,volume=${vol},adelay=delays=${startMs}ms:all=1,apad=whole_dur=${totalSec}[${lbl}]`)
      audioLabels.push(`[${lbl}]`)
    }

    parts.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest[aout]`)
    args.push('-filter_complex', parts.join(';'))
    args.push('-map', '0:v', '-c:v', encoder.videoCodec, '-pix_fmt', encoder.pixelFormat, '-preset', encoder.x264Preset, '-crf', String(encoder.crf))
    args.push('-map', '[aout]', '-c:a', encoder.audioCodec, '-b:a', encoder.audioBitrate)
  } else {
    args.push('-c:v', encoder.videoCodec, '-pix_fmt', encoder.pixelFormat, '-preset', encoder.x264Preset, '-crf', String(encoder.crf))
  }

  args.push(outPath)
  return args
}

function trimLogChunk(chunk: string): string[] {
  return chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function markSessionClosed(session: FrameExportSession, code: number | null): void {
  if (session.closed) return

  session.closed = true
  session.exitCode = code
  for (const resolve of session.closeWaiters) resolve(code)
  session.closeWaiters = []
}

function waitForSessionClose(session: FrameExportSession): Promise<number | null> {
  if (session.closed) return Promise.resolve(session.exitCode)
  return new Promise((resolve) => session.closeWaiters.push(resolve))
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createFrameExportController(host: ExportEngineHost) {
  const exportSessions = new Map<string, FrameExportSession>()

  return {
    async start(jobId: string, options: FrameExportOptions) {
      if (exportSessions.has(jobId)) return { error: `export job ${jobId} is already running` }

      const outPath = options.outputPath ?? await host.chooseOutputPath()
      if (!outPath) return { canceled: true }
      if (!ffmpegPath) return { error: 'ffmpeg binary is not available' }

      const audioSources = await getFrameAudioSources(options.clips, options.timelineItems)
      const args = buildFrameExportArgs(options, audioSources, outPath)
      const stderrBuf: string[] = []
      const proc = spawn(ffmpegPath, args)
      const exportSession: FrameExportSession = {
        proc,
        outPath,
        stderrBuf,
        canceled: false,
        closed: false,
        exitCode: null,
        closeWaiters: [],
      }

      host.emitLog(jobId, `Starting frame export: ${options.W}x${options.H} @ ${options.fps} fps, ${options.encoder.x264Preset}, CRF ${options.encoder.crf}, ${options.encoder.framePipeFormat} pipe`)
      host.emitLog(jobId, `FFmpeg frame command: ${args.join(' ')}`)

      proc.on('error', (err) => {
        exportSession.error = err.message
        stderrBuf.push(err.message)
        host.emitLog(jobId, `Frame export process error: ${err.message}`)
      })

      proc.on('close', (code) => {
        markSessionClosed(exportSession, code)
      })

      proc.stdin?.on('error', (err) => {
        if (!exportSession.canceled) {
          exportSession.error = err.message
          host.emitLog(jobId, `Frame export input error: ${err.message}`)
        }
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        stderrBuf.push(text)
        for (const line of trimLogChunk(text)) host.emitLog(jobId, line)
      })

      exportSessions.set(jobId, exportSession)

      return { ok: true }
    },

    async sendFrame(jobId: string, buf: ArrayBuffer) {
      const exportSession = exportSessions.get(jobId)
      if (!exportSession) return { error: `no session for export job ${jobId}` }
      if (exportSession.error) return { error: exportSession.error }
      if (exportSession.closed) return { error: `ffmpeg closed before export job ${jobId} finished` }

      const data = Buffer.from(buf)
      const stdin = exportSession.proc.stdin
      if (!stdin || stdin.destroyed) return { error: `ffmpeg input is closed for export job ${jobId}` }

      try {
        const ok = stdin.write(data)
        if (!ok) {
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              stdin.removeListener('drain', onDrain)
              stdin.removeListener('error', onError)
              exportSession.proc.removeListener('close', onClose)
            }
            const onDrain = () => {
              cleanup()
              resolve()
            }
            const onError = (err: Error) => {
              cleanup()
              reject(err)
            }
            const onClose = () => {
              cleanup()
              reject(new Error(exportSession.error ?? `ffmpeg closed before accepting frame for export job ${jobId}`))
            }

            stdin.once('drain', onDrain)
            stdin.once('error', onError)
            exportSession.proc.once('close', onClose)
          })
        }
      } catch (err: unknown) {
        return { error: errorMessage(err) }
      }

      return { ok: true }
    },

    async finish(jobId: string) {
      const exportSession = exportSessions.get(jobId)
      if (!exportSession) return { error: `no session for export job ${jobId}` }

      const { proc, outPath, stderrBuf } = exportSession
      exportSessions.delete(jobId)

      try {
        if (proc.stdin && !proc.stdin.destroyed) proc.stdin.end()
      } catch (err: unknown) {
        exportSession.error = errorMessage(err)
      }

      const exitCode = await waitForSessionClose(exportSession)
      if (exportSession.canceled) return { canceled: true }
      if (exportSession.error) return { error: exportSession.error }
      if (exitCode !== 0 && exitCode !== null) {
        const detail = stderrBuf.join('').slice(-2000)
        host.emitLog(jobId, `Frame export failed with exit code ${exitCode}`)
        return { error: `ffmpeg exited with code ${exitCode}: ${detail}` }
      }

      host.emitLog(jobId, `Frame export finished: ${outPath}`)
      return { success: true, path: outPath }
    },

    cancel(jobId: string) {
      const exportSession = exportSessions.get(jobId)
      if (!exportSession) return { ok: true }

      exportSession.canceled = true
      exportSessions.delete(jobId)
      host.emitLog(jobId, 'Frame export canceled')
      exportSession.proc.stdin?.destroy()
      exportSession.proc.kill('SIGTERM')

      return { ok: true }
    },
  }
}
