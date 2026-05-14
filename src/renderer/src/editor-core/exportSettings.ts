export type ExportProfileId = 'draft' | 'balanced' | 'high'

export interface ExportEncoderSettings {
  videoCodec: 'libx264'
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
