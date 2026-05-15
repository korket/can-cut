import type { Animation, Effects, TextOverlay, Transform, Transition } from '../types'
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

type NativeExportAnimation = Pick<Animation, 'inEffect' | 'inDuration' | 'outEffect' | 'outDuration'>

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
    transitionIn?: Transition
    animation?: NativeExportAnimation
  }>
  textOverlays: Array<{
    text: string
    fontFamily: string
    color: string
    fontSize: number
    x: number
    y: number
    bold: boolean
    italic: boolean
    animation?: NativeExportAnimation
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

type NativeTransitionLayer = {
  id: string
  trackIndex: number
  startTime: number
  trimStart: number
  trimEnd: number
  transitionIn?: Transition
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
    near(e.backdropBlur, DEFAULT_EFFECTS.backdropBlur) &&
    e.compositeMode === DEFAULT_EFFECTS.compositeMode
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

function getNativeClipAnimationIneligibility(layer: { animation?: Animation }, durationMs: number): string | null {
  const animation = { ...DEFAULT_ANIMATION, ...layer.animation }
  const hasFadeIn = animation.inEffect === 'fade'
  const hasFadeOut = animation.outEffect === 'fade'

  if (animation.inEffect !== 'none' && !hasFadeIn) return 'clip animation requires renderer export'
  if (animation.outEffect !== 'none' && !hasFadeOut) return 'clip animation requires renderer export'
  if (hasFadeIn && (animation.inDuration <= 0 || animation.inDuration > durationMs)) return 'clip fade duration requires renderer export'
  if (hasFadeOut && (animation.outDuration <= 0 || animation.outDuration > durationMs)) return 'clip fade duration requires renderer export'

  return null
}

function getNativeTextIneligibility(layer: TextOverlay): string | null {
  const durationMs = layer.endTime - layer.startTime
  const animationReason = getNativeClipAnimationIneligibility(layer, durationMs)
  const fontFamily = (layer.fontFamily || 'sans-serif').trim()
  if (!fontFamily || fontFamily.includes(',')) {
    return 'title font stacks require renderer export'
  }
  if (layer.bold || layer.italic) {
    return 'bold or italic title styling requires renderer export'
  }
  if (!isDefaultTransform({ ...DEFAULT_TRANSFORM, ...layer.transform })) {
    return 'transformed title clips require renderer export'
  }
  if (!isDefaultEffects({ ...DEFAULT_EFFECTS, ...layer.effects })) {
    return 'title effects require renderer export'
  }
  if (animationReason) return animationReason.replace('clip', 'title')
  if ((layer.keyframeTracks?.length ?? 0) > 0) {
    return 'title keyframes require renderer export'
  }

  return null
}

function getItemDuration(layer: { trimStart: number; trimEnd: number }): number {
  return layer.trimEnd - layer.trimStart
}

function getItemEnd(layer: { startTime: number; trimStart: number; trimEnd: number }): number {
  return layer.startTime + getItemDuration(layer)
}

function hasAdjacentOutgoingLayer(layer: NativeTransitionLayer, layers: NativeTransitionLayer[]): boolean {
  return layers.some((candidate) =>
    candidate.id !== layer.id &&
    candidate.trackIndex === layer.trackIndex &&
    Math.abs(getItemEnd(candidate) - layer.startTime) < 500
  )
}

function getNativeTransitionIneligibility(layer: NativeTransitionLayer, layers: NativeTransitionLayer[]): string | null {
  const transition = layer.transitionIn
  if (!transition || transition.type === 'cut') return null

  if (
    transition.type !== 'crossfade' &&
    transition.type !== 'fade-color' &&
    transition.type !== 'wipe-left' &&
    transition.type !== 'wipe-right' &&
    transition.type !== 'wipe-up' &&
    transition.type !== 'wipe-down'
  ) return 'this transition requires renderer export'
  if (transition.duration <= 0 || transition.duration > getItemDuration(layer)) {
    return 'transition duration requires renderer export'
  }
  if (!hasAdjacentOutgoingLayer(layer, layers)) {
    return 'transition without adjacent outgoing clip requires renderer export'
  }

  return null
}

export function getNativeExportEligibility(plan: RenderPlan): NativeExportEligibility {
  for (const layer of plan.textLayers) {
    const reason = getNativeTextIneligibility(layer)
    if (reason) return { ok: false, reason }
  }

  for (const layer of plan.videoLayers) {
    const transitionReason = getNativeTransitionIneligibility(layer, plan.videoLayers)
    if (transitionReason) return { ok: false, reason: transitionReason }

    if (layer.kenBurns) {
      return { ok: false, reason: 'Ken Burns requires renderer export' }
    }
    if ((layer.keyframeTracks?.length ?? 0) > 0) {
      return { ok: false, reason: 'keyframes require renderer export' }
    }
    const animationReason = layer.transitionIn && layer.transitionIn.type !== 'cut' && !animationIsDefault(layer)
      ? 'combined transitions and clip animations require renderer export'
      : getNativeClipAnimationIneligibility(layer, getItemDuration(layer))
    if (animationReason) {
      return { ok: false, reason: animationReason }
    }

    const transform = { ...DEFAULT_TRANSFORM, ...layer.transform }
    if (!near(transform.pitch, 0) || !near(transform.yaw, 0)) {
      return { ok: false, reason: '3D rotation requires renderer export' }
    }

    const effects = { ...DEFAULT_EFFECTS, ...layer.effects }
    if (effects.shadowOpacity > 0 || effects.backdropBlur > 0 || effects.compositeMode !== 'normal') {
      return { ok: false, reason: 'advanced layer effects require renderer export' }
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
        ...('transitionIn' in layer && layer.transitionIn ? { transitionIn: layer.transitionIn } : {}),
        ...('animation' in layer && layer.animation ? { animation: layer.animation } : {}),
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
      fontFamily: layer.fontFamily,
      color: layer.color,
      fontSize: layer.fontSize,
      x: layer.x,
      y: layer.y,
      bold: layer.bold,
      italic: layer.italic,
      animation: layer.animation,
      startTime: layer.startTime,
      endTime: layer.endTime,
    })),
  }
}
