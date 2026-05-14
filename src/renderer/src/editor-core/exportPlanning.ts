import type { Effects, Transform } from '../types'
import { DEFAULT_ANIMATION, DEFAULT_EFFECTS, DEFAULT_TRANSFORM } from '../types'
import type { RenderPlan } from './renderPlan'
import { DEFAULT_EXPORT_PROFILE, type ExportEncoderSettings } from './exportSettings'

type NativeExportTransform = Pick<
  Transform,
  'scaleX' | 'scaleY' | 'posX' | 'posY' | 'rotation' | 'anchorX' | 'anchorY' |
  'flipH' | 'flipV' | 'cropL' | 'cropR' | 'cropT' | 'cropB'
>

type NativeExportEffects = Pick<
  Effects,
  'brightness' | 'contrast' | 'saturate' | 'hue' | 'blur' |
  'opacity' | 'grayscale' | 'sepia'
>

export interface NativeExportOptions {
  resolution: string
  fps: number
  duration: number
  encoder: ExportEncoderSettings
  outputPath?: string
  clips: Array<{
    path: string
    trimStart: number
    trimEnd: number
    startTime: number
    trackIndex: number
    volume: number
    type: 'video' | 'audio' | 'image' | 'solid'
    color?: string
    clipWidth: number
    clipHeight: number
    transform: NativeExportTransform
    effects: NativeExportEffects
  }>
  textOverlays: Array<{
    text: string
    color: string
    fontSize: number
    x: number
    y: number
    startTime: number
    endTime: number
  }>
}

export type RenderBackend = 'ffmpeg-native' | 'renderer-canvas'

export type NativeExportEligibility =
  | { ok: true }
  | { ok: false; reason: string }

export interface ExportBackendPlan {
  backend: RenderBackend
  reason?: string
}

function near(a: number, b: number) {
  return Math.abs(a - b) < 0.0001
}

function isDefaultTransform(t: Transform) {
  return (
    near(t.scaleX, DEFAULT_TRANSFORM.scaleX) &&
    near(t.scaleY, DEFAULT_TRANSFORM.scaleY) &&
    near(t.posX, DEFAULT_TRANSFORM.posX) &&
    near(t.posY, DEFAULT_TRANSFORM.posY) &&
    near(t.rotation, DEFAULT_TRANSFORM.rotation) &&
    near(t.anchorX, DEFAULT_TRANSFORM.anchorX) &&
    near(t.anchorY, DEFAULT_TRANSFORM.anchorY) &&
    near(t.pitch, DEFAULT_TRANSFORM.pitch) &&
    near(t.yaw, DEFAULT_TRANSFORM.yaw) &&
    t.flipH === DEFAULT_TRANSFORM.flipH &&
    t.flipV === DEFAULT_TRANSFORM.flipV &&
    near(t.cropL, DEFAULT_TRANSFORM.cropL) &&
    near(t.cropR, DEFAULT_TRANSFORM.cropR) &&
    near(t.cropT, DEFAULT_TRANSFORM.cropT) &&
    near(t.cropB, DEFAULT_TRANSFORM.cropB)
  )
}

function isDefaultEffects(e: Effects) {
  return (
    near(e.brightness, DEFAULT_EFFECTS.brightness) &&
    near(e.contrast, DEFAULT_EFFECTS.contrast) &&
    near(e.saturate, DEFAULT_EFFECTS.saturate) &&
    near(e.hue, DEFAULT_EFFECTS.hue) &&
    near(e.blur, DEFAULT_EFFECTS.blur) &&
    near(e.opacity, DEFAULT_EFFECTS.opacity) &&
    near(e.grayscale, DEFAULT_EFFECTS.grayscale) &&
    near(e.sepia, DEFAULT_EFFECTS.sepia) &&
    near(e.shadowOpacity, DEFAULT_EFFECTS.shadowOpacity) &&
    near(e.backdropBlur, DEFAULT_EFFECTS.backdropBlur)
  )
}

function animationIsDefault(layer: { animation?: unknown }) {
  const a = { ...DEFAULT_ANIMATION, ...(layer.animation ?? {}) }
  return (
    a.inEffect === DEFAULT_ANIMATION.inEffect &&
    near(a.inDuration, DEFAULT_ANIMATION.inDuration) &&
    a.outEffect === DEFAULT_ANIMATION.outEffect &&
    near(a.outDuration, DEFAULT_ANIMATION.outDuration)
  )
}

export function getNativeExportEligibility(plan: RenderPlan): NativeExportEligibility {
  if (plan.textLayers.length > 0) {
    return { ok: false, reason: 'title clips require renderer export' }
  }

  for (const layer of plan.videoLayers) {
    if (layer.transitionIn && layer.transitionIn.type !== 'cut') {
      return { ok: false, reason: 'transitions require renderer export' }
    }
    if (layer.kenBurns) {
      return { ok: false, reason: 'Ken Burns requires renderer export' }
    }
    if ((layer.keyframeTracks?.length ?? 0) > 0) {
      return { ok: false, reason: 'keyframes require renderer export' }
    }
    if (!animationIsDefault(layer)) {
      return { ok: false, reason: 'clip animations require renderer export' }
    }

    const transform = { ...DEFAULT_TRANSFORM, ...layer.transform }
    if (!near(transform.pitch, 0) || !near(transform.yaw, 0)) {
      return { ok: false, reason: '3D rotation requires renderer export' }
    }

    const effects = { ...DEFAULT_EFFECTS, ...layer.effects }
    if (effects.shadowOpacity > 0 || effects.backdropBlur > 0) {
      return { ok: false, reason: 'shadow or backdrop blur requires renderer export' }
    }

    if (layer.asset.type === 'solid' && (!isDefaultTransform(transform) || !isDefaultEffects(effects))) {
      return { ok: false, reason: 'transformed solid clips require renderer export' }
    }
  }

  return { ok: true }
}

export function planExportBackend(plan: RenderPlan): ExportBackendPlan {
  const native = getNativeExportEligibility(plan)
  return native.ok
    ? { backend: 'ffmpeg-native' }
    : { backend: 'renderer-canvas', reason: native.reason }
}

export function buildNativeExportOptions(
  plan: RenderPlan,
  encoder: ExportEncoderSettings = DEFAULT_EXPORT_PROFILE.encoder,
  outputPath?: string
): NativeExportOptions {
  const layers = [...plan.videoLayers, ...plan.audioLayers]

  return {
    resolution: `${plan.resolution.width}x${plan.resolution.height}`,
    fps: plan.fps,
    duration: plan.durationMs,
    encoder,
    outputPath,
    clips: layers.map((layer) => {
      const t = { ...DEFAULT_TRANSFORM, ...('transform' in layer ? layer.transform : undefined) }
      const e = { ...DEFAULT_EFFECTS, ...('effects' in layer ? layer.effects : undefined) }

      return {
        path: layer.asset.path ?? '',
        trimStart: layer.trimStart,
        trimEnd: layer.trimEnd,
        startTime: layer.startTime,
        trackIndex: layer.trackIndex,
        volume: layer.volume,
        type: layer.asset.type,
        color: layer.asset.color,
        clipWidth: layer.asset.width,
        clipHeight: layer.asset.height,
        transform: {
          scaleX: t.scaleX,
          scaleY: t.scaleY,
          posX: t.posX,
          posY: t.posY,
          rotation: t.rotation,
          anchorX: t.anchorX,
          anchorY: t.anchorY,
          flipH: t.flipH,
          flipV: t.flipV,
          cropL: t.cropL,
          cropR: t.cropR,
          cropT: t.cropT,
          cropB: t.cropB,
        },
        effects: {
          brightness: e.brightness,
          contrast: e.contrast,
          saturate: e.saturate,
          hue: e.hue,
          blur: e.blur,
          opacity: e.opacity,
          grayscale: e.grayscale,
          sepia: e.sepia,
        },
      }
    }),
    textOverlays: plan.textLayers.map((layer) => ({
      text: layer.text,
      color: layer.color,
      fontSize: layer.fontSize,
      x: layer.x,
      y: layer.y,
      startTime: layer.startTime,
      endTime: layer.endTime,
    })),
  }
}
