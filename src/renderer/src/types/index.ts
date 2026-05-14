export interface MediaClip {
  id: string
  name: string
  path: string
  duration: number   // ms
  width: number
  height: number
  fps: number
  type: 'video' | 'audio' | 'image' | 'solid'
  thumbnail?: string
  folderId?: string | null
  color?: string   // solid color clips only
}

export interface MediaFolder {
  id: string
  name: string
}

export interface Transform {
  scaleX: number     // 1 = 100 %
  scaleY: number
  posX: number       // % of container width
  posY: number       // % of container height
  rotation: number   // degrees
  anchorX: number    // 0–1, 0.5 = centre
  anchorY: number
  pitch: number      // degrees (rotateX)
  yaw: number        // degrees (rotateY)
  flipH: boolean
  flipV: boolean
  cropL: number      // % from left edge
  cropR: number      // % from right edge
  cropT: number      // % from top edge
  cropB: number      // % from bottom edge
}

export const DEFAULT_TRANSFORM: Transform = {
  scaleX: 1, scaleY: 1,
  posX: 0, posY: 0,
  rotation: 0,
  anchorX: 0.5, anchorY: 0.5,
  pitch: 0, yaw: 0,
  flipH: false, flipV: false,
  cropL: 0, cropR: 0, cropT: 0, cropB: 0,
}

export interface Effects {
  brightness: number   // 0–200,  100 = normal
  contrast:   number   // 0–200,  100 = normal
  saturate:   number   // 0–200,  100 = normal
  hue:        number   // -180–180 deg, 0 = normal
  blur:       number   // 0–20 px
  opacity:    number   // 0–100,  100 = normal
  grayscale:  number   // 0–100,  0 = normal
  sepia:      number   // 0–100,  0 = normal
  shadowOpacity: number  // 0–100,  0 = no shadow
  shadowX:       number  // px, -50–50
  shadowY:       number  // px, -50–50
  shadowBlur:    number  // px, 0–50
  shadowColor:   string  // hex
  backdropBlur:     number  // 0 = off, 1–30 px — blurs all layers rendered below this one
  backdropBlurFade: number  // fade-in/out duration in ms (0 = instant)
}

export const DEFAULT_EFFECTS: Effects = {
  brightness: 100, contrast: 100, saturate: 100,
  hue: 0, blur: 0, opacity: 100, grayscale: 0, sepia: 0,
  shadowOpacity: 0, shadowX: 4, shadowY: 4, shadowBlur: 8, shadowColor: '#000000',
  backdropBlur: 0, backdropBlurFade: 600,
}

export type AnimEffect =
  | 'none' | 'fade'
  | 'zoom-in' | 'zoom-out'
  | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'
  | 'blur-in' | 'blur-out'

export interface Animation {
  inEffect:   AnimEffect
  inDuration: number   // ms
  outEffect:  AnimEffect
  outDuration: number  // ms
}

export const DEFAULT_ANIMATION: Animation = {
  inEffect: 'none', inDuration: 500,
  outEffect: 'none', outDuration: 500,
}

export type EasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

export interface Keyframe {
  time: number      // ms from clip's trimStart (0 = clip start)
  value: number
  easing: EasingType
}

export interface KeyframeTrack {
  property: string   // e.g. 'posX', 'opacity'
  keyframes: Keyframe[]  // kept sorted by time ascending
}

export type TransitionType =
  | 'cut' | 'crossfade' | 'fade-color'
  | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down'

export interface Transition {
  type: TransitionType
  duration: number   // ms
  color: string      // hex, used by fade-color
}

export const DEFAULT_TRANSITION: Transition = {
  type: 'crossfade',
  duration: 500,
  color: '#000000',
}

export interface KenBurns {
  startScale: number   // multiplier, e.g. 1.0
  endScale:   number   // multiplier, e.g. 1.15
  startX:     number   // % pan offset
  startY:     number
  endX:       number
  endY:       number
  focalX:     number   // 0–100, zoom pivot X (% of frame width,  50 = centre)
  focalY:     number   // 0–100, zoom pivot Y (% of frame height, 50 = centre)
}

export const DEFAULT_KEN_BURNS: KenBurns = {
  startScale: 1.0, endScale: 1.0,
  startX: 0, startY: 0,
  endX:   0, endY:   0,
  focalX: 50, focalY: 50,
}

export interface TimelineItem {
  id: string
  clipId: string
  trackIndex: number
  startTime: number  // ms on timeline
  trimStart: number  // ms into source clip
  trimEnd: number    // ms into source clip (= duration used)
  volume?: number    // 0–200, 100 = normal
  kenBurns?: KenBurns
  transform?: Transform
  effects?: Effects
  animation?: Animation
  transitionIn?: Transition
  keyframeTracks?: KeyframeTrack[]
}

export interface TextOverlay {
  id: string
  text: string
  fontFamily: string
  fontSize: number
  color: string
  x: number          // px
  y: number          // px
  trackIndex: number // video track used for timeline/layer ordering
  startTime: number  // ms on timeline
  endTime: number    // ms on timeline
  bold: boolean
  italic: boolean
}

export type Tool = 'select' | 'text'
