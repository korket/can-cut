import type { KeyframeTrack, Transform, Effects, EasingType } from '../types'

export const KF_SNAP = 50  // ms tolerance — "is there a keyframe here?"

function applyEasing(t: number, easing: EasingType): number {
  switch (easing) {
    case 'ease-in':     return t * t
    case 'ease-out':    return t * (2 - t)
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
    default:            return t
  }
}

export function getKeyframedValue(
  tracks: KeyframeTrack[],
  property: string,
  clipTime: number,
  defaultValue: number
): number {
  const track = tracks.find(t => t.property === property)
  if (!track || track.keyframes.length === 0) return defaultValue
  const kfs = track.keyframes  // assumed sorted
  if (clipTime <= kfs[0].time) return kfs[0].value
  if (clipTime >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value
  for (let i = 0; i < kfs.length - 1; i++) {
    if (clipTime >= kfs[i].time && clipTime <= kfs[i + 1].time) {
      const span = kfs[i + 1].time - kfs[i].time
      if (span === 0) return kfs[i].value
      const t = (clipTime - kfs[i].time) / span
      return kfs[i].value + applyEasing(t, kfs[i].easing) * (kfs[i + 1].value - kfs[i].value)
    }
  }
  return defaultValue
}

export function hasKeyframeAt(tracks: KeyframeTrack[], property: string, clipTime: number): boolean {
  const track = tracks.find(t => t.property === property)
  if (!track) return false
  return track.keyframes.some(kf => Math.abs(kf.time - clipTime) <= KF_SNAP)
}

export function applyKeyframesToTransform(tracks: KeyframeTrack[], base: Transform, clipTime: number): Transform {
  const g = (p: string, d: number) => getKeyframedValue(tracks, p, clipTime, d)
  return {
    ...base,
    scaleX:   g('scaleX',   base.scaleX),
    scaleY:   g('scaleY',   base.scaleY),
    posX:     g('posX',     base.posX),
    posY:     g('posY',     base.posY),
    rotation: g('rotation', base.rotation),
    pitch:    g('pitch',    base.pitch),
    yaw:      g('yaw',      base.yaw),
    anchorX:  g('anchorX',  base.anchorX),
    anchorY:  g('anchorY',  base.anchorY),
  }
}

export function applyKeyframesToEffects(tracks: KeyframeTrack[], base: Effects, clipTime: number): Effects {
  const g = (p: string, d: number) => getKeyframedValue(tracks, p, clipTime, d)
  return {
    ...base,
    brightness: g('brightness', base.brightness),
    contrast:   g('contrast',   base.contrast),
    saturate:   g('saturate',   base.saturate),
    hue:        g('hue',        base.hue),
    blur:       g('blur',       base.blur),
    opacity:    g('opacity',    base.opacity),
    grayscale:  g('grayscale',  base.grayscale),
    sepia:      g('sepia',      base.sepia),
  }
}

export function allKeyframeTimes(tracks: KeyframeTrack[]): number[] {
  return Array.from(new Set(tracks.flatMap(t => t.keyframes.map(kf => kf.time)))).sort((a, b) => a - b)
}
