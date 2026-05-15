import { ffmpeg, hasAudioStream } from './ffmpegRuntime'
import { describeVideoEncoder, getFluentVideoEncoderOptions } from './encoderOptions'
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
  extraFilters: string[] = [],
  forceAlpha = false,
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
  if (forceAlpha && !hasOpacity) filters.push('format=rgba')
  filters.push(...extraFilters)

  const overlayX = Math.round(tr.anchorX * W * (1 - asx) + (tr.cropL / 100) * W * asx + (tr.posX / 100) * W)
  const overlayY = Math.round(tr.anchorY * H * (1 - asy) + (tr.cropT / 100) * H * asy + (tr.posY / 100) * H)

  return { filter: `${inputRef}${filters.join(',')}[${outputLabel}]`, overlayX, overlayY, hasOpacity: hasOpacity || forceAlpha }
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

function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\r?\n/g, '\\n')
}

function ffmpegColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `0x${color.slice(1)}` : color
}

function getDrawtextFontOption(fontFamily: string): string | null {
  const family = fontFamily.trim()
  if (!family || family === 'sans-serif') return null
  return `font='${escapeDrawtextText(family)}'`
}

function smoothstepExpr(valueExpr: string): string {
  return `(${valueExpr})*(${valueExpr})*(3-2*(${valueExpr}))`
}

function getDrawtextAlphaExpression(overlay: ExportOptions['textOverlays'][number]): string | null {
  const animation = overlay.animation
  if (!animation) return null

  const expressions: string[] = []
  const start = (overlay.startTime / 1000).toFixed(6)
  const end = (overlay.endTime / 1000).toFixed(6)

  if (animation.inEffect === 'fade' && animation.inDuration > 0) {
    const inDuration = (animation.inDuration / 1000).toFixed(6)
    const inEnd = ((overlay.startTime + animation.inDuration) / 1000).toFixed(6)
    const progress = `(t-${start})/${inDuration}`
    expressions.push(`if(lt(t,${inEnd}),${smoothstepExpr(progress)},1)`)
  }

  if (animation.outEffect === 'fade' && animation.outDuration > 0) {
    const outDuration = (animation.outDuration / 1000).toFixed(6)
    const outStart = ((overlay.endTime - animation.outDuration) / 1000).toFixed(6)
    const progress = `(${end}-t)/${outDuration}`
    expressions.push(`if(gt(t,${outStart}),${smoothstepExpr(progress)},1)`)
  }

  return expressions.length > 0 ? expressions.join('*') : null
}

function getClipDuration(clip: ClipInfo): number {
  return clip.trimEnd - clip.trimStart
}

function getClipEnd(clip: ClipInfo): number {
  return clip.startTime + getClipDuration(clip)
}

function findOutgoingTransitionClip(clips: ClipInfo[], incoming: ClipInfo): ClipInfo | null {
  return clips.find((candidate) =>
    candidate.origIdx !== incoming.origIdx &&
    candidate.trackIndex === incoming.trackIndex &&
    candidate.type !== 'audio' &&
    Math.abs(getClipEnd(candidate) - incoming.startTime) < 500
  ) ?? null
}

function getClipAnimationAlphaFilters(clip: ClipInfo): string[] {
  const animation = clip.animation
  if (!animation) return []

  const filters: string[] = []
  const start = (clip.startTime / 1000).toFixed(6)
  const endMs = clip.startTime + getClipDuration(clip)

  if (animation.inEffect === 'fade' && animation.inDuration > 0) {
    filters.push(`fade=t=in:st=${start}:d=${(animation.inDuration / 1000).toFixed(6)}:alpha=1`)
  }

  if (animation.outEffect === 'fade' && animation.outDuration > 0) {
    const outStart = Math.max(clip.startTime, endMs - animation.outDuration)
    filters.push(`fade=t=out:st=${(outStart / 1000).toFixed(6)}:d=${(animation.outDuration / 1000).toFixed(6)}:alpha=1`)
  }

  return filters
}

function isNativeTransition(clip: ClipInfo): boolean {
  return (
    clip.transitionIn?.type === 'crossfade' ||
    clip.transitionIn?.type === 'fade-color' ||
    clip.transitionIn?.type === 'wipe-left' ||
    clip.transitionIn?.type === 'wipe-right' ||
    clip.transitionIn?.type === 'wipe-up' ||
    clip.transitionIn?.type === 'wipe-down'
  ) && clip.transitionIn.duration > 0
}

function getWipeAlphaFilter(type: NonNullable<ClipInfo['transitionIn']>['type'], startSec: string, durationSec: string): string | null {
  const progress = `((T-${startSec})/${durationSec})`
  const visible = type === 'wipe-left'
    ? `lte(X,W*${progress})`
    : type === 'wipe-right'
      ? `gte(X,W*(1-${progress}))`
      : type === 'wipe-up'
        ? `lte(Y,H*${progress})`
        : type === 'wipe-down'
          ? `gte(Y,H*(1-${progress}))`
          : null

  return visible
    ? `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(${visible},alpha(X,Y),0)'`
    : null
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

  host.emitLog(jobId, `Preparing native export: ${resolution} @ ${fps} fps, ${describeVideoEncoder(encoder)}`)

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
      const transition = isNativeTransition(clip)
        ? clip.transitionIn
        : null
      const transitionDur = transition ? (transition.duration / 1000).toFixed(6) : '0'
      const transitionHalfDur = transition ? (transition.duration / 2000).toFixed(6) : '0'
      const transitionMid = transition ? ((clip.startTime + transition.duration / 2) / 1000).toFixed(6) : ss
      const transitionEnd = transition ? ((clip.startTime + transition.duration) / 1000).toFixed(6) : ss
      const vLbl = `vc${vi}`
      const isLast = vi === videoClips.length - 1
      const outLbl = isLast && textOverlays.length === 0 ? 'vout' : `vb${vi}`

      let overlayX = 0
      let overlayY = 0
      let hasOpacity = false
      const clipExtraFilters = getClipAnimationAlphaFilters(clip)
      let clipForceAlpha = clipExtraFilters.length > 0

      if (transition) {
        const outgoing = findOutgoingTransitionClip(videoClips, clip)
        if (outgoing) {
          const frozenLbl = `vtxo${vi}`
          const transitionBaseLbl = `vtxb${vi}`
          let frozenOverlayX = 0
          let frozenOverlayY = 0
          let frozenHasOpacity = false
          const isWipe = transition.type === 'wipe-left' || transition.type === 'wipe-right' || transition.type === 'wipe-up' || transition.type === 'wipe-down'
          const fadeOut = isWipe
            ? null
            : transition.type === 'fade-color'
            ? `fade=t=out:st=${ss}:d=${transitionHalfDur}:alpha=1`
            : `fade=t=out:st=${ss}:d=${transitionDur}:alpha=1`

          if (outgoing.type === 'solid') {
            const alphaPart = fadeOut ? `,format=rgba,${fadeOut}` : ''
            parts.push(`color=c=${outgoing.color ?? '#000000'}:s=${W}x${H}:r=${fps}:d=${transitionDur},setpts=PTS-STARTPTS+${ss}/TB${alphaPart}[${frozenLbl}]`)
            frozenHasOpacity = Boolean(fadeOut)
          } else {
            const outgoingInput = inputOf.get(outgoing.origIdx)!
            const source = outgoing.type === 'image'
              ? `[${outgoingInput}:v]trim=duration=${transitionDur},setpts=PTS-STARTPTS+${ss}/TB,`
              : (() => {
                  const frameSec = 1 / fps
                  const lastFrameStart = Math.max(outgoing.trimStart, outgoing.trimEnd - frameSec * 1000) / 1000
                  return `[${outgoingInput}:v]trim=start=${lastFrameStart.toFixed(6)}:duration=${frameSec.toFixed(6)},setpts=PTS-STARTPTS+${ss}/TB,tpad=stop_mode=clone:stop_duration=${transitionDur},`
                })()
            const frozen = buildClipFilter(
              source,
              frozenLbl,
              outgoing.transform,
              outgoing.effects,
              outgoing.clipWidth,
              outgoing.clipHeight,
              W,
              H,
              fadeOut ? [fadeOut] : [],
              Boolean(fadeOut),
            )
            parts.push(frozen.filter)
            frozenOverlayX = frozen.overlayX
            frozenOverlayY = frozen.overlayY
            frozenHasOpacity = frozen.hasOpacity
          }

          const frozenFmt = frozenHasOpacity ? ':format=auto' : ''
          parts.push(`[${baseLabel}][${frozenLbl}]overlay=x=${frozenOverlayX}:y=${frozenOverlayY}:enable='between(t,${ss},${transitionEnd})':eof_action=pass${frozenFmt}[${transitionBaseLbl}]`)
          baseLabel = transitionBaseLbl

          if (transition.type === 'fade-color') {
            const colorLbl = `vtxc${vi}`
            const colorBaseLbl = `vtxcb${vi}`
            parts.push(`color=c=${transition.color}:s=${W}x${H}:r=${fps}:d=${transitionDur},setpts=PTS-STARTPTS+${ss}/TB,format=rgba,fade=t=in:st=${ss}:d=${transitionHalfDur}:alpha=1,fade=t=out:st=${transitionMid}:d=${transitionHalfDur}:alpha=1[${colorLbl}]`)
            parts.push(`[${baseLabel}][${colorLbl}]overlay=x=0:y=0:enable='between(t,${ss},${transitionEnd})':eof_action=pass:format=auto[${colorBaseLbl}]`)
            baseLabel = colorBaseLbl
            clipExtraFilters.push(`fade=t=in:st=${transitionMid}:d=${transitionHalfDur}:alpha=1`)
          } else {
            const wipeAlphaFilter = getWipeAlphaFilter(transition.type, ss, transitionDur)
            if (wipeAlphaFilter) clipExtraFilters.push(wipeAlphaFilter)
            else clipExtraFilters.push(`fade=t=in:st=${ss}:d=${transitionDur}:alpha=1`)
          }
          clipForceAlpha = true
        }
      }

      if (clip.type === 'solid') {
        const fadeIn = clipExtraFilters.length > 0 ? `,format=rgba,${clipExtraFilters.join(',')}` : ''
        parts.push(`color=c=${clip.color ?? '#000000'}:s=${W}x${H}:r=${fps}:d=${dur},setpts=PTS-STARTPTS+${ss}/TB${fadeIn}[${vLbl}]`)
        hasOpacity = clipForceAlpha
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
          clipExtraFilters,
          clipForceAlpha,
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
      const txt = escapeDrawtextText(overlay.text)
      const isLast = t === textOverlays.length - 1
      const outLbl = isLast ? 'vout' : `vtxt${t}`
      const fontOption = getDrawtextFontOption(overlay.fontFamily)
      const alphaExpression = getDrawtextAlphaExpression(overlay)
      const textOptions = [
        `text='${txt}'`,
        fontOption,
        `fontcolor=${ffmpegColor(overlay.color)}`,
        `fontsize=${overlay.fontSize}`,
        alphaExpression ? `alpha='${alphaExpression}'` : null,
        `x=${overlay.x}`,
        `y=${overlay.y}`,
        'shadowcolor=black@0.8',
        'shadowx=0',
        'shadowy=1',
        `enable='between(t,${ss},${es})'`,
      ].filter(Boolean).join(':')
      parts.push(`[${baseLabel}]drawtext=${textOptions}[${outLbl}]`)
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
      .outputOptions(['-y', `-r ${fps}`, ...getFluentVideoEncoderOptions(encoder)])

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
