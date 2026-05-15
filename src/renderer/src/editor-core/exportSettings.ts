export type ExportProfileId = 'draft' | 'balanced' | 'high'
export type ExportVideoCodec = 'libx264' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf'

export interface ExportVideoEncoderOption {
  codec: ExportVideoCodec
  label: string
  description: string
}

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

export interface ExportProfile {
  id: ExportProfileId
  label: string
  description: string
  encoder: ExportEncoderSettings
}

export const VIDEO_ENCODERS: ExportVideoEncoderOption[] = [
  { codec: 'libx264',    label: 'Software x264',      description: 'CPU encoding, most compatible' },
  { codec: 'h264_nvenc', label: 'NVIDIA NVENC',       description: 'Hardware H.264 on NVIDIA GPUs' },
  { codec: 'h264_qsv',   label: 'Intel Quick Sync',   description: 'Hardware H.264 on Intel GPUs' },
  { codec: 'h264_amf',   label: 'AMD AMF',            description: 'Hardware H.264 on AMD GPUs' },
]

export const EXPORT_PROFILES: ExportProfile[] = [
  {
    id: 'draft',
    label: 'Draft',
    description: 'Faster export, smaller file',
    encoder: {
      videoCodec: 'libx264',
      x264Preset: 'veryfast',
      crf: 28,
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      audioBitrate: '128k',
      framePipeFormat: 'mjpeg',
      frameJpegQuality: 0.82,
    },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Good quality and faster canvas export',
    encoder: {
      videoCodec: 'libx264',
      x264Preset: 'veryfast',
      crf: 23,
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      audioBitrate: '192k',
      framePipeFormat: 'mjpeg',
      frameJpegQuality: 0.9,
    },
  },
  {
    id: 'high',
    label: 'High Quality',
    description: 'Slower export, larger file',
    encoder: {
      videoCodec: 'libx264',
      x264Preset: 'medium',
      crf: 18,
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      audioBitrate: '256k',
      framePipeFormat: 'raw-rgba',
      frameJpegQuality: 0.96,
    },
  },
]

export const DEFAULT_EXPORT_PROFILE = EXPORT_PROFILES[1]

export function getExportProfile(id: string): ExportProfile {
  return EXPORT_PROFILES.find((profile) => profile.id === id) ?? DEFAULT_EXPORT_PROFILE
}

export function getVideoEncoderOption(codec: ExportVideoCodec): ExportVideoEncoderOption {
  return VIDEO_ENCODERS.find((encoder) => encoder.codec === codec) ?? VIDEO_ENCODERS[0]
}

export function withVideoCodec(profile: ExportProfile, videoCodec: ExportVideoCodec): ExportProfile {
  return {
    ...profile,
    encoder: {
      ...profile.encoder,
      videoCodec,
    },
  }
}
