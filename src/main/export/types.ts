export interface ExportEngineHost {
  chooseOutputPath: () => Promise<string | null>
  emitProgress: (jobId: string, progress: number) => void
  emitLog: (jobId: string, message: string) => void
  getTempPath: () => string
}

export interface ExportTransform {
  scaleX: number
  scaleY: number
  posX: number
  posY: number
  rotation: number
  anchorX: number
  anchorY: number
  flipH: boolean
  flipV: boolean
  cropL: number
  cropR: number
  cropT: number
  cropB: number
}

export interface ExportEffects {
  brightness: number
  contrast: number
  saturate: number
  hue: number
  blur: number
  opacity: number
  grayscale: number
  sepia: number
}

export type ExportTransitionType = 'cut' | 'crossfade' | 'fade-color' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down'

export interface ExportTransition {
  type: ExportTransitionType
  duration: number
  color: string
}

export type ExportAnimationEffect = 'none' | 'fade' | 'zoom-in' | 'zoom-out' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'blur-in' | 'blur-out'

export interface ExportAnimation {
  inEffect: ExportAnimationEffect
  inDuration: number
  outEffect: ExportAnimationEffect
  outDuration: number
}

export type ExportVideoCodec = 'libx264' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf'

export interface ExportEncoderSettings {
  videoCodec: ExportVideoCodec
  x264Preset: 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow'
  crf: number
  pixelFormat: 'yuv420p'
  audioCodec: 'aac'
  audioBitrate: string
  framePipeFormat: 'raw-rgba' | 'mjpeg'
  frameJpegQuality: number
}

export interface ClipExportInfo {
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
  transform: ExportTransform
  effects: ExportEffects
  transitionIn?: ExportTransition
  animation?: ExportAnimation
}

export interface TextOverlayExportInfo {
  text: string
  fontFamily: string
  color: string
  fontSize: number
  x: number
  y: number
  bold: boolean
  italic: boolean
  animation?: ExportAnimation
  startTime: number
  endTime: number
}

export interface ExportOptions {
  clips: ClipExportInfo[]
  textOverlays: TextOverlayExportInfo[]
  resolution: string
  fps: number
  duration: number
  encoder: ExportEncoderSettings
  outputPath?: string
  includeAudio?: boolean
}

export interface FrameClip {
  id: string
  path: string
  type: string
}

export interface FrameItem {
  id: string
  clipId: string
  trackIndex: number
  startTime: number
  trimStart: number
  trimEnd: number
  volume: number
}

export interface FrameExportOptions {
  W: number
  H: number
  fps: number
  totalMs: number
  encoder: ExportEncoderSettings
  outputPath?: string
  includeAudio?: boolean
  clips: FrameClip[]
  timelineItems: FrameItem[]
}

export interface FrameAudioSource {
  path: string
  startTime: number
  trimStart: number
  trimEnd: number
  volume: number
}
