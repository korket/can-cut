import type { ExportEncoderSettings, ExportVideoCodec } from './types'

type EncoderOption = [flag: string, value?: string]

const VIDEO_ENCODER_LABELS: Record<ExportVideoCodec, string> = {
  libx264: 'Software x264',
  h264_nvenc: 'NVIDIA NVENC',
  h264_qsv: 'Intel Quick Sync',
  h264_amf: 'AMD AMF',
}

function clampQuality(value: number): string {
  return String(Math.max(0, Math.min(51, Math.round(value))))
}

function hardwareQualityPreset(encoder: ExportEncoderSettings): 'fast' | 'balanced' | 'quality' {
  if (encoder.x264Preset === 'slow') return 'quality'
  if (encoder.x264Preset === 'medium') return 'balanced'
  return 'fast'
}

function nvencPreset(encoder: ExportEncoderSettings): string {
  const preset = hardwareQualityPreset(encoder)
  if (preset === 'quality') return 'slow'
  if (preset === 'balanced') return 'medium'
  return 'fast'
}

function qsvPreset(encoder: ExportEncoderSettings): string {
  const preset = hardwareQualityPreset(encoder)
  if (preset === 'quality') return 'slow'
  if (preset === 'balanced') return 'medium'
  return 'veryfast'
}

function amfQuality(encoder: ExportEncoderSettings): string {
  const preset = hardwareQualityPreset(encoder)
  if (preset === 'quality') return 'quality'
  if (preset === 'balanced') return 'balanced'
  return 'speed'
}

export function describeVideoEncoder(encoder: ExportEncoderSettings): string {
  const label = VIDEO_ENCODER_LABELS[encoder.videoCodec]
  if (encoder.videoCodec === 'libx264') return `${label}, ${encoder.x264Preset}, CRF ${encoder.crf}`
  return `${label}, quality ${clampQuality(encoder.crf)}`
}

export function getVideoEncoderOptionPairs(encoder: ExportEncoderSettings): EncoderOption[] {
  const quality = clampQuality(encoder.crf)
  const pixelFormat = encoder.videoCodec === 'h264_qsv' ? 'nv12' : encoder.pixelFormat
  const options: EncoderOption[] = [['-pix_fmt', pixelFormat]]

  if (encoder.videoCodec === 'libx264') {
    options.push(['-preset', encoder.x264Preset], ['-crf', quality], ['-threads', '0'])
  } else if (encoder.videoCodec === 'h264_nvenc') {
    options.push(['-preset', nvencPreset(encoder)], ['-rc:v', 'vbr'], ['-cq:v', quality], ['-b:v', '0'])
  } else if (encoder.videoCodec === 'h264_qsv') {
    options.push(['-preset', qsvPreset(encoder)], ['-global_quality:v', quality])
  } else if (encoder.videoCodec === 'h264_amf') {
    options.push(['-quality', amfQuality(encoder)], ['-rc', 'cqp'], ['-qp_i', quality], ['-qp_p', quality], ['-qp_b', quality])
  }

  return options
}

export function appendVideoEncoderArgs(args: string[], encoder: ExportEncoderSettings): void {
  args.push('-c:v', encoder.videoCodec)
  for (const [flag, value] of getVideoEncoderOptionPairs(encoder)) {
    args.push(flag)
    if (value != null) args.push(value)
  }
}

export function getFluentVideoEncoderOptions(encoder: ExportEncoderSettings): string[] {
  return getVideoEncoderOptionPairs(encoder).map(([flag, value]) => value == null ? flag : `${flag} ${value}`)
}
