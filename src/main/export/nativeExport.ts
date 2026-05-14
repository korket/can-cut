import { ffmpeg, hasAudioStream } from './ffmpegRuntime'
import type { ClipExportInfo, ExportEffects, ExportEngineHost, ExportOptions, ExportTransform } from './types'

type ClipInfo = ClipExportInfo & { origIdx: number; hasAudio: boolean }

interface NativeExportSession {
  command: ReturnType<typeof ffmpeg> | null
  canceled: boolean
}

function buildClipFilter(
  inputRef: string,
  outputLabel: string,
  tr: ExportTransform,
  ef: ExportEffects,
  SW: number,
  SH: number,
  W: number,
  H: number,
): { filter: string; overlayX: number; overlayY: number; hasOpacity: boolean } {
  const cSW = SW > 0 ? SW : W
  const cSH = SH > 0 ? SH : H
  const fitRatio = Math.min(W / cSW, H / cSH)
  const NW = Math.max(2, Math.floor((cSW * fitRatio) / 2) * 2)
  const NH = Math.max(2, Math.floor((cSH * fitRatio) / 2) * 2)

  const cropX = Math.round((tr.cropL / 100) * W)
  const cropY = Math.round((tr.cropT / 100) * H)
  const CW = Math.max(2, Math.floor((W * (1 - tr.cropL / 100 - tr.cropR / 100)) / 2) * 2)
  const CH = Math.max(2, Math.floor((H * (1 - tr.cropT / 100 - tr.cropB / 100)) / 2) * 2)
  const hasCrop = tr.cropL > 0 || tr.cropR > 0 || tr.cropT > 0 || tr.cropB > 0

  const asx = Math.abs(tr.scaleX)
  const asy = Math.abs(tr.scaleY)
  const TW = Math.max(2, Math.floor((CW * asx) / 2) * 2)
  const TH = Math.max(2, Math.floor((CH * asy) / 2) * 2)
  const hasScale = tr.scaleX !== 1 || tr.scaleY !== 1

  const filters: string[] = []

  filters.push(`scale=${NW}:${NH}`)
  filters.push(`pad=${W}:${H}:trunc((ow-iw)/2):trunc((oh-ih)/2)`)

  if (hasCrop) filters.push(`crop=${CW}:${CH}:${cropX}:${cropY}`)
  if (hasScale || hasCrop) filters.push(`scale=${TW}:${TH}`)

  if (tr.flipH) filters.push('hflip')
  if (tr.flipV) filters.push('vflip')

  if (tr.rotation !== 0) {
    const rad = ((tr.rotation * Math.PI) / 180).toFixed(6)
    filters.push(`rotate=${rad}:fillcolor=black@0:ow=${TW}:oh=${TH}`)
  }

  const finalSat = (ef.saturate / 100) * (1 - ef.grayscale / 100)
  if (ef.brightness !== 100 || ef.contrast !== 100 || ef.saturate !== 100 || ef.grayscale !== 0) {
    const brightness = (ef.brightness / 100 - 1).toFixed(4)
    const contrast = (ef.contrast / 100).toFixed(4)
    const saturation = finalSat.toFixed(4)
    filters.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`)
  }
  if (ef.hue !== 0) filters.push(`hue=h=${ef.hue}`)
  if (ef.sepia > 0) {
    const s = ef.sepia / 100
    filters.push([
      'colorchannelmixer',
      `=${(0.393 * s + (1 - s)).toFixed(4)}:${(0.769 * s).toFixed(4)}:${(0.189 * s).toFixed(4)}:0`,
      `:${(0.349 * s).toFixed(4)}:${(0.686 * s + (1 - s)).toFixed(4)}:${(0.168 * s).toFixed(4)}:0`,
      `:${(0.272 * s).toFixed(4)}:${(0.534 * s).toFixed(4)}:${(0.131 * s + (1 - s)).toFixed(4)}:0`,
    ].join(''))
  }
  if (ef.blur > 0) filters.push(`gblur=sigma=${ef.blur}`)

  const hasOpacity = ef.opacity < 100
  if (hasOpacity) filters.push(`format=rgba,colorchannelmixer=aa=${(ef.opacity / 100).toFixed(4)}`)

  const overlayX = Math.round(tr.anchorX * W * (1 - asx) + (tr.cropL / 100) * W * asx + (tr.posX / 100) * W)
  const overlayY = Math.round(tr.anchorY * H * (1 - asy) + (tr.cropT / 100) * H * asy + (tr.posY / 100) * H)

  return { filter: `${inputRef}${filters.join(',')}[${outputLabel}]`, overlayX, overlayY, hasOpacity }
}

function progressFromTimemark(timemark: string | undefined, percent: number | undefined, totalSec: string): number {
  if (timemark) {
    const [hh, mm, ss] = timemark.split(':').map(parseFloat)
    const elapsed = hh * 3600 + mm * 60 + ss
    return Math.min(99, Math.round((elapsed / parseFloat(totalSec)) * 100))
  }

  if (percent != null && percent > 0) return Math.min(99, Math.round(percent))
  return 0
}

function isNoisyFfmpegProgressLine(line: string): boolean {
  return /^frame=\s*\d+/i.test(line) || /^size=\s*\S+\s+time=/i.test(line)
}

async function exportNativeVideo(
  jobId: string,
  options: ExportOptions,
  host: ExportEngineHost,
  sessions: Map<string, NativeExportSession>,
  canceledJobs: Set<string>,
) {
  const outPath = options.outputPath ?? await host.chooseOutputPath()
  if (!outPath) return { canceled: true }
  if (canceledJobs.delete(jobId)) return { canceled: true }

  const { clips, textOverlays, resolution, fps, duration: totalMs } = options
  const encoder = options.encoder
  const [W, H] = resolution.split('x').map(Number)
  const totalSec = (totalMs / 1000).toFixed(3)

  host.emitLog(jobId, `Preparing native export: ${resolution} @ ${fps} fps, ${encoder.x264Preset}, CRF ${encoder.crf}`)

  const clipsInfo: ClipInfo[] = await Promise.all(
    clips.map(async (clip, origIdx) => {
      if (clip.type !== 'video') return { ...clip, origIdx, hasAudio: false }
      const hasAudio = await hasAudioStream(clip.path)
      return { ...clip, origIdx, hasAudio }
    }),
  )

  const session: NativeExportSession = { command: null, canceled: false }
  sessions.set(jobId, session)

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
    session.command = cmd

    const videoClips = clipsInfo
      .filter((clip) => clip.type !== 'audio')
      .sort((a, b) => a.trackIndex - b.trackIndex || a.startTime - b.startTime)

    const inputOf = new Map<number, number>()
    let nextInput = 0

    for (const clip of videoClips) {
      if (clip.type === 'solid') continue
      if (clip.type === 'image') {
        cmd.input(clip.path).inputOptions(['-loop', '1', '-framerate', String(fps)])
      } else {
        cmd.input(clip.path)
      }
      inputOf.set(clip.origIdx, nextInput++)
    }

    const audioOnlyClips = clipsInfo.filter((clip) => clip.type === 'audio')
    for (const clip of audioOnlyClips) {
      cmd.input(clip.path)
      inputOf.set(clip.origIdx, nextInput++)
    }

    const parts: string[] = []

    parts.push(`color=black:s=${W}x${H}:r=${fps}:d=${totalSec}[base]`)
    let baseLabel = 'base'

    for (let vi = 0; vi < videoClips.length; vi++) {
      const clip = videoClips[vi]
      const ss = (clip.startTime / 1000).toFixed(6)
      const es = ((clip.startTime + clip.trimEnd - clip.trimStart) / 1000).toFixed(6)
      const ts = (clip.trimStart / 1000).toFixed(6)
      const dur = ((clip.trimEnd - clip.trimStart) / 1000).toFixed(6)
      const vLbl = `vc${vi}`
      const isLast = vi === videoClips.length - 1
      const outLbl = isLast && textOverlays.length === 0 ? 'vout' : `vb${vi}`

      let overlayX = 0
      let overlayY = 0
      let hasOpacity = false

      if (clip.type === 'solid') {
        parts.push(`color=c=${clip.color ?? '#000000'}:s=${W}x${H}:r=${fps}:d=${dur},setpts=PTS-STARTPTS+${ss}/TB[${vLbl}]`)
      } else {
        const i = inputOf.get(clip.origIdx)!
        const src = clip.type === 'image'
          ? `[${i}:v]trim=duration=${dur},setpts=PTS-STARTPTS+${ss}/TB,`
          : `[${i}:v]trim=start=${ts}:duration=${dur},setpts=PTS-STARTPTS+${ss}/TB,`

        const { filter, overlayX: ox, overlayY: oy, hasOpacity: hop } = buildClipFilter(
          src,
          vLbl,
          clip.transform,
          clip.effects,
          clip.clipWidth,
          clip.clipHeight,
          W,
          H,
        )
        parts.push(filter)
        overlayX = ox
        overlayY = oy
        hasOpacity = hop
      }

      const ovFmt = hasOpacity ? ':format=auto' : ''
      parts.push(`[${baseLabel}][${vLbl}]overlay=x=${overlayX}:y=${overlayY}:enable='between(t,${ss},${es})':eof_action=pass${ovFmt}[${outLbl}]`)
      baseLabel = outLbl
    }

    if (videoClips.length === 0) {
      const outLbl = textOverlays.length === 0 ? 'vout' : 'vbase'
      parts.push(`[base]copy[${outLbl}]`)
      baseLabel = outLbl
    }

    for (let t = 0; t < textOverlays.length; t++) {
      const overlay = textOverlays[t]
      const ss = (overlay.startTime / 1000).toFixed(3)
      const es = (overlay.endTime / 1000).toFixed(3)
      const txt = overlay.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')
      const isLast = t === textOverlays.length - 1
      const outLbl = isLast ? 'vout' : `vtxt${t}`
      parts.push(`[${baseLabel}]drawtext=text='${txt}':fontcolor=${overlay.color}:fontsize=${overlay.fontSize}:x=${overlay.x}:y=${overlay.y}:enable='between(t,${ss},${es})'[${outLbl}]`)
      baseLabel = outLbl
    }

    const audioLabels: string[] = []
    const audioSources = [
      ...clipsInfo.filter((clip) => clip.type === 'video' && clip.hasAudio),
      ...audioOnlyClips,
    ]

    for (let ai = 0; ai < audioSources.length; ai++) {
      const clip = audioSources[ai]
      const i = inputOf.get(clip.origIdx)!
      const ts = (clip.trimStart / 1000).toFixed(6)
      const dur = ((clip.trimEnd - clip.trimStart) / 1000).toFixed(6)
      const startMs = Math.round(clip.startTime)
      const vol = ((clip.volume ?? 100) / 100).toFixed(3)
      const lbl = `ao${ai}`
      parts.push(`[${i}:a]atrim=start=${ts}:duration=${dur},asetpts=PTS-STARTPTS,volume=${vol},adelay=delays=${startMs}ms:all=1,apad=whole_dur=${totalSec}[${lbl}]`)
      audioLabels.push(`[${lbl}]`)
    }

    if (audioLabels.length > 0) {
      parts.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest[aout]`)
    }

    cmd
      .complexFilter(parts.join(';'))
      .map('[vout]')
      .videoCodec(encoder.videoCodec)
      .outputOptions(['-y', `-crf ${encoder.crf}`, `-r ${fps}`, `-preset ${encoder.x264Preset}`, `-pix_fmt ${encoder.pixelFormat}`, '-threads 0'])

    if (audioLabels.length > 0) {
      cmd.map('[aout]').audioCodec(encoder.audioCodec).audioBitrate(encoder.audioBitrate)
    }

    cmd
      .output(outPath)
      .on('start', (commandLine) => host.emitLog(jobId, `FFmpeg native command: ${commandLine}`))
      .on('stderr', (line) => {
        const message = String(line).trim()
        if (message && !isNoisyFfmpegProgressLine(message)) host.emitLog(jobId, message)
      })
      .on('progress', (progress) => host.emitProgress(jobId, progressFromTimemark(progress.timemark, progress.percent, totalSec)))
      .on('end', () => {
        sessions.delete(jobId)
        host.emitLog(jobId, `Native export finished: ${outPath}`)
        resolve({ success: true, path: outPath })
      })
      .on('error', (err) => {
        sessions.delete(jobId)
        if (session.canceled) {
          host.emitLog(jobId, 'Native export canceled')
          resolve({ canceled: true })
          return
        }
        host.emitLog(jobId, `Native export failed: ${err.message}`)
        reject(err.message)
      })
      .run()
  })
}

export function createNativeExportController(host: ExportEngineHost) {
  const sessions = new Map<string, NativeExportSession>()
  const canceledJobs = new Set<string>()

  return {
    exportVideo(jobId: string, options: ExportOptions) {
      return exportNativeVideo(jobId, options, host, sessions, canceledJobs)
    },

    cancel(jobId: string) {
      const session = sessions.get(jobId)
      if (!session) {
        canceledJobs.add(jobId)
        return { ok: true }
      }

      session.canceled = true
      host.emitLog(jobId, 'Cancel requested for native export')
      session.command?.kill('SIGTERM')
      return { ok: true }
    },
  }
}
