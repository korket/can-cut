import type { Animation, Effects, KenBurns, TextOverlay, TimelineItem, Transform, Transition } from '../types'
import { DEFAULT_ANIMATION, DEFAULT_EFFECTS, DEFAULT_TRANSFORM } from '../types'
import { applyKeyframesToEffects, applyKeyframesToTransform } from '../utils/keyframes'
import { getItemDuration, getItemEnd } from './timeline'

export type TransitionState = {
  outItem: TimelineItem
  inItem: TimelineItem
  transition: Transition
  progress: number
} | null

export interface EvaluatedAnimation {
  opacity: number
  scale: number
  translateXPct: number
  translateYPct: number
  blurPx: number
}

export interface EvaluatedClipState {
  transform: Transform
  effects: Effects
  animation: EvaluatedAnimation
}

export interface EvaluatedTransition {
  outOpacity?: number
  inOpacity?: number
  overlayOpacity: number
  wipe?: {
    side: 'left' | 'right' | 'top' | 'bottom'
    hiddenFraction: number
  }
}

export function smoothstep(progress: number): number {
  return progress * progress * (3 - 2 * progress)
}

export function evaluateAnimation(
  animation: Animation | undefined,
  clipTime: number,
  clipDuration: number
): EvaluatedAnimation {
  const anim = { ...DEFAULT_ANIMATION, ...animation }
  const inP = anim.inEffect !== 'none' && clipTime < anim.inDuration
    ? smoothstep(Math.max(0, Math.min(1, clipTime / anim.inDuration)))
    : 1
  const outP = anim.outEffect !== 'none' && (clipDuration - clipTime) < anim.outDuration
    ? smoothstep(Math.max(0, Math.min(1, (clipDuration - clipTime) / anim.outDuration)))
    : 1

  let opacity = 1
  let scale = 1
  let translateXPct = 0
  let translateYPct = 0
  let blurPx = 0

  switch (anim.inEffect) {
    case 'fade': opacity *= inP; break
    case 'zoom-in': scale *= 0.3 + 0.7 * inP; break
    case 'zoom-out': scale *= 1.7 - 0.7 * inP; break
    case 'slide-left': translateXPct += (inP - 1) * 100; break
    case 'slide-right': translateXPct += (1 - inP) * 100; break
    case 'slide-up': translateYPct += (inP - 1) * 100; break
    case 'slide-down': translateYPct += (1 - inP) * 100; break
    case 'blur-in': blurPx += 20 * (1 - inP); break
  }

  switch (anim.outEffect) {
    case 'fade': opacity *= outP; break
    case 'zoom-in': if (outP < 1) scale *= 1 + 0.7 * (1 - outP); break
    case 'zoom-out': if (outP < 1) scale *= outP * 0.7 + 0.3; break
    case 'slide-left': if (outP < 1) translateXPct += (outP - 1) * 100; break
    case 'slide-right': if (outP < 1) translateXPct += (1 - outP) * 100; break
    case 'slide-up': if (outP < 1) translateYPct += (outP - 1) * 100; break
    case 'slide-down': if (outP < 1) translateYPct += (1 - outP) * 100; break
    case 'blur-out': if (outP < 1) blurPx += 20 * (1 - outP); break
  }

  return { opacity, scale, translateXPct, translateYPct, blurPx }
}

export function evaluateKenBurns(
  kenBurns: KenBurns | undefined,
  clipTime: number,
  clipDuration: number,
  transform: Transform
): Transform {
  if (!kenBurns) return transform

  const progress = clipDuration > 0 ? Math.max(0, clipTime / clipDuration) : 0
  const scale = kenBurns.startScale + (kenBurns.endScale - kenBurns.startScale) * progress

  return {
    ...transform,
    scaleX: transform.scaleX * scale,
    scaleY: transform.scaleY * scale,
    posX: transform.posX + kenBurns.startX + (kenBurns.endX - kenBurns.startX) * progress,
    posY: transform.posY + kenBurns.startY + (kenBurns.endY - kenBurns.startY) * progress,
    anchorX: (kenBurns.focalX ?? 50) / 100,
    anchorY: (kenBurns.focalY ?? 50) / 100,
  }
}

export function evaluateClipAtTime(item: TimelineItem, clipTime: number): EvaluatedClipState {
  const clipDuration = getItemDuration(item)
  const keyframeTracks = item.keyframeTracks ?? []

  let transform: Transform = { ...DEFAULT_TRANSFORM, ...item.transform }
  let effects: Effects = { ...DEFAULT_EFFECTS, ...item.effects }

  if (keyframeTracks.length > 0) {
    transform = applyKeyframesToTransform(keyframeTracks, transform, clipTime)
    effects = applyKeyframesToEffects(keyframeTracks, effects, clipTime)
  }

  transform = evaluateKenBurns(item.kenBurns, clipTime, clipDuration, transform)

  return {
    transform,
    effects,
    animation: evaluateAnimation(item.animation, clipTime, clipDuration),
  }
}

export function evaluateTextOverlayAtTime(overlay: TextOverlay, clipTime: number): EvaluatedClipState {
  const clipDuration = Math.max(1, overlay.endTime - overlay.startTime)
  const keyframeTracks = overlay.keyframeTracks ?? []

  let transform: Transform = { ...DEFAULT_TRANSFORM, ...overlay.transform }
  let effects: Effects = { ...DEFAULT_EFFECTS, ...overlay.effects }

  if (keyframeTracks.length > 0) {
    transform = applyKeyframesToTransform(keyframeTracks, transform, clipTime)
    effects = applyKeyframesToEffects(keyframeTracks, effects, clipTime)
  }

  return {
    transform,
    effects,
    animation: evaluateAnimation(overlay.animation, clipTime, clipDuration),
  }
}

export function findTransitionState(
  items: TimelineItem[],
  itemId: string,
  timelineTime: number,
  toleranceMs = 500
): TransitionState {
  const inItem = items.find((item) => item.id === itemId)
  if (!inItem?.transitionIn || inItem.transitionIn.type === 'cut') return null

  const transition = inItem.transitionIn
  if (timelineTime < inItem.startTime || timelineTime >= inItem.startTime + transition.duration) return null

  const outItem = items.find((item) =>
    item.trackIndex === inItem.trackIndex &&
    item.id !== inItem.id &&
    Math.abs(getItemEnd(item) - inItem.startTime) < toleranceMs
  )

  if (!outItem) return null

  return {
    outItem,
    inItem,
    transition,
    progress: (timelineTime - inItem.startTime) / transition.duration,
  }
}

export function evaluateTransition(transition: Transition, progress: number): EvaluatedTransition {
  switch (transition.type) {
    case 'crossfade':
      return { outOpacity: 1 - progress, inOpacity: progress, overlayOpacity: 0 }
    case 'fade-color':
      return {
        outOpacity: Math.max(0, 1 - progress * 2),
        inOpacity: Math.max(0, (progress - 0.5) * 2),
        overlayOpacity: Math.sin(progress * Math.PI),
      }
    case 'wipe-left':
      return { overlayOpacity: 0, wipe: { side: 'right', hiddenFraction: 1 - progress } }
    case 'wipe-right':
      return { overlayOpacity: 0, wipe: { side: 'left', hiddenFraction: 1 - progress } }
    case 'wipe-up':
      return { overlayOpacity: 0, wipe: { side: 'bottom', hiddenFraction: 1 - progress } }
    case 'wipe-down':
      return { overlayOpacity: 0, wipe: { side: 'top', hiddenFraction: 1 - progress } }
    default:
      return { overlayOpacity: 0 }
  }
}
