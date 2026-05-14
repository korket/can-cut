import type { ExportOptions, FrameExportOptions } from './types'

export type RenderBackend = 'ffmpeg-native' | 'renderer-canvas'
export type ExportJobMode = 'native' | 'renderer'
export type ExportJobStatus = 'queued' | 'running' | 'canceling' | 'completed' | 'failed' | 'canceled' | 'interrupted'

export interface ExportProfileSnapshot {
  id: string
  label: string
  description: string
  encoder: ExportOptions['encoder']
}

export interface ExportPreflightSnapshot {
  backend: RenderBackend
  backendReason?: string
  profileId: string
  profileLabel: string
  framePipeFormat: 'raw-rgba' | 'mjpeg'
  resolution: { width: number; height: number }
  fps: number
  durationMs: number
  frameCount: number
  videoLayerCount: number
  audioLayerCount: number
  textLayerCount: number
  pixelCountPerFrame: number
  totalPixelCount: number
  warnings: Array<{ code: string; message: string }>
}

export type ExportValidationSeverity = 'error' | 'warning'

export interface ExportValidationIssue {
  severity: ExportValidationSeverity
  code: string
  message: string
  path?: string
  layerId?: string
}

export interface ExportValidationReport {
  ok: boolean
  checkedAt: number
  issues: ExportValidationIssue[]
}

export interface ExportJobTiming {
  queuedAt: number
  startedAt?: number
  finishedAt?: number
  queueWaitMs?: number
  validationMs?: number
  exportMs?: number
  totalMs?: number
  frameCount: number
  effectiveFps?: number
}

export interface ExportJob {
  id: string
  plan: unknown
  backend: RenderBackend
  mode: ExportJobMode
  profile: ExportProfileSnapshot
  preflight: ExportPreflightSnapshot
  validation?: ExportValidationReport
  timing: ExportJobTiming
  status: ExportJobStatus
  progress: number
  createdAt: number
  updatedAt: number
  error?: string
  outputPath?: string
}

export interface ExportJobResult {
  success?: boolean
  path?: string
  error?: string
  canceled?: boolean
}

export interface ExportJobLogEntry {
  at: number
  message: string
}

export interface ExportJobSnapshot extends ExportJob {
  logs: ExportJobLogEntry[]
  result?: ExportJobResult
}

export interface ExportJobStartRequest {
  plan: unknown
  profile: ExportProfileSnapshot
  preflight: ExportPreflightSnapshot
  nativeOptions: ExportOptions
  mediaPaths: string[]
  outputPath?: string
}

export interface RendererExportJobRequest {
  jobId: string
  outputPath: string
  plan: unknown
  profile: ExportProfileSnapshot
}

type GuardResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isRenderBackend(value: unknown): value is RenderBackend {
  return value === 'ffmpeg-native' || value === 'renderer-canvas'
}

function isFramePipeFormat(value: unknown): value is 'raw-rgba' | 'mjpeg' {
  return value === 'raw-rgba' || value === 'mjpeg'
}

function isVideoCodec(value: unknown): value is ExportOptions['encoder']['videoCodec'] {
  return value === 'libx264'
}

function isX264Preset(value: unknown): value is ExportOptions['encoder']['x264Preset'] {
  return value === 'ultrafast' || value === 'veryfast' || value === 'fast' || value === 'medium' || value === 'slow'
}

function isPixelFormat(value: unknown): value is ExportOptions['encoder']['pixelFormat'] {
  return value === 'yuv420p'
}

function isAudioCodec(value: unknown): value is ExportOptions['encoder']['audioCodec'] {
  return value === 'aac'
}

function isEncoderSettings(value: unknown): value is ExportOptions['encoder'] {
  if (!isObject(value)) return false
  return (
    isVideoCodec(value.videoCodec) &&
    isX264Preset(value.x264Preset) &&
    isFiniteNumber(value.crf) &&
    value.crf >= 0 &&
    value.crf <= 51 &&
    isPixelFormat(value.pixelFormat) &&
    isAudioCodec(value.audioCodec) &&
    isString(value.audioBitrate) &&
    isFramePipeFormat(value.framePipeFormat) &&
    isFiniteNumber(value.frameJpegQuality) &&
    value.frameJpegQuality > 0 &&
    value.frameJpegQuality <= 1
  )
}

function isTransform(value: unknown): value is ExportOptions['clips'][number]['transform'] {
  if (!isObject(value)) return false
  return (
    isFiniteNumber(value.scaleX) &&
    isFiniteNumber(value.scaleY) &&
    isFiniteNumber(value.posX) &&
    isFiniteNumber(value.posY) &&
    isFiniteNumber(value.rotation) &&
    isFiniteNumber(value.anchorX) &&
    isFiniteNumber(value.anchorY) &&
    typeof value.flipH === 'boolean' &&
    typeof value.flipV === 'boolean' &&
    isFiniteNumber(value.cropL) &&
    isFiniteNumber(value.cropR) &&
    isFiniteNumber(value.cropT) &&
    isFiniteNumber(value.cropB)
  )
}

function isEffects(value: unknown): value is ExportOptions['clips'][number]['effects'] {
  if (!isObject(value)) return false
  return (
    isFiniteNumber(value.brightness) &&
    isFiniteNumber(value.contrast) &&
    isFiniteNumber(value.saturate) &&
    isFiniteNumber(value.hue) &&
    isFiniteNumber(value.blur) &&
    isFiniteNumber(value.opacity) &&
    isFiniteNumber(value.grayscale) &&
    isFiniteNumber(value.sepia)
  )
}

function isClipType(value: unknown): value is ExportOptions['clips'][number]['type'] {
  return value === 'video' || value === 'audio' || value === 'image' || value === 'solid'
}

function isExportClip(value: unknown): value is ExportOptions['clips'][number] {
  if (!isObject(value)) return false
  return (
    isString(value.path) &&
    isNonNegativeNumber(value.trimStart) &&
    isNonNegativeNumber(value.trimEnd) &&
    isNonNegativeNumber(value.startTime) &&
    isFiniteNumber(value.trackIndex) &&
    isFiniteNumber(value.volume) &&
    isClipType(value.type) &&
    (value.color == null || isString(value.color)) &&
    isFiniteNumber(value.clipWidth) &&
    isFiniteNumber(value.clipHeight) &&
    isTransform(value.transform) &&
    isEffects(value.effects)
  )
}

function isTextOverlay(value: unknown): value is ExportOptions['textOverlays'][number] {
  if (!isObject(value)) return false
  return (
    isString(value.text) &&
    isString(value.color) &&
    isPositiveNumber(value.fontSize) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isNonNegativeNumber(value.startTime) &&
    isNonNegativeNumber(value.endTime)
  )
}

export function isExportOptions(value: unknown): value is ExportOptions {
  if (!isObject(value)) return false
  return (
    Array.isArray(value.clips) &&
    value.clips.every(isExportClip) &&
    Array.isArray(value.textOverlays) &&
    value.textOverlays.every(isTextOverlay) &&
    isString(value.resolution) &&
    /^\d+x\d+$/.test(value.resolution) &&
    isPositiveNumber(value.fps) &&
    isPositiveNumber(value.duration) &&
    isEncoderSettings(value.encoder) &&
    (value.outputPath == null || isString(value.outputPath))
  )
}

function isFrameClip(value: unknown): value is FrameExportOptions['clips'][number] {
  if (!isObject(value)) return false
  return (
    isString(value.id) &&
    isString(value.path) &&
    isString(value.type) &&
    (value.width == null || isFiniteNumber(value.width)) &&
    (value.height == null || isFiniteNumber(value.height))
  )
}

function isFrameItem(value: unknown): value is FrameExportOptions['timelineItems'][number] {
  if (!isObject(value)) return false
  return (
    isString(value.id) &&
    isString(value.clipId) &&
    isFiniteNumber(value.trackIndex) &&
    isNonNegativeNumber(value.startTime) &&
    isNonNegativeNumber(value.trimStart) &&
    isNonNegativeNumber(value.trimEnd) &&
    isFiniteNumber(value.volume)
  )
}

export function isFrameExportOptions(value: unknown): value is FrameExportOptions {
  if (!isObject(value)) return false
  return (
    isPositiveNumber(value.W) &&
    isPositiveNumber(value.H) &&
    isPositiveNumber(value.fps) &&
    isPositiveNumber(value.totalMs) &&
    isEncoderSettings(value.encoder) &&
    (value.outputPath == null || isString(value.outputPath)) &&
    Array.isArray(value.clips) &&
    value.clips.every(isFrameClip) &&
    Array.isArray(value.timelineItems) &&
    value.timelineItems.every(isFrameItem)
  )
}

function isProfileSnapshot(value: unknown): value is ExportProfileSnapshot {
  if (!isObject(value)) return false
  return (
    isString(value.id) &&
    isString(value.label) &&
    isString(value.description) &&
    isEncoderSettings(value.encoder)
  )
}

function isWarning(value: unknown): value is ExportPreflightSnapshot['warnings'][number] {
  if (!isObject(value)) return false
  return isString(value.code) && isString(value.message)
}

function isPreflightSnapshot(value: unknown): value is ExportPreflightSnapshot {
  if (!isObject(value) || !isObject(value.resolution)) return false
  return (
    isRenderBackend(value.backend) &&
    (value.backendReason == null || isString(value.backendReason)) &&
    isString(value.profileId) &&
    isString(value.profileLabel) &&
    isFramePipeFormat(value.framePipeFormat) &&
    isPositiveNumber(value.resolution.width) &&
    isPositiveNumber(value.resolution.height) &&
    isPositiveNumber(value.fps) &&
    isPositiveNumber(value.durationMs) &&
    isPositiveNumber(value.frameCount) &&
    isNonNegativeNumber(value.videoLayerCount) &&
    isNonNegativeNumber(value.audioLayerCount) &&
    isNonNegativeNumber(value.textLayerCount) &&
    isPositiveNumber(value.pixelCountPerFrame) &&
    isPositiveNumber(value.totalPixelCount) &&
    Array.isArray(value.warnings) &&
    value.warnings.every(isWarning)
  )
}

function isExportJobTiming(value: unknown): value is ExportJobTiming {
  if (!isObject(value)) return false
  return isFiniteNumber(value.queuedAt) && isNonNegativeNumber(value.frameCount)
}

export function isExportJobSnapshot(value: unknown): value is ExportJobSnapshot {
  if (!isObject(value)) return false
  return (
    isString(value.id) &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt) &&
    isFiniteNumber(value.progress) &&
    isString(value.status) &&
    isString(value.mode) &&
    isRenderBackend(value.backend) &&
    isProfileSnapshot(value.profile) &&
    isPreflightSnapshot(value.preflight) &&
    isExportJobTiming(value.timing) &&
    Array.isArray(value.logs)
  )
}

export function isExportJobResult(value: unknown): value is ExportJobResult {
  if (!isObject(value)) return false
  return (
    (value.success == null || typeof value.success === 'boolean') &&
    (value.path == null || isString(value.path)) &&
    (value.error == null || isString(value.error)) &&
    (value.canceled == null || typeof value.canceled === 'boolean')
  )
}

export function validateExportJobStartRequest(value: unknown): GuardResult<ExportJobStartRequest> {
  if (!isObject(value)) return { ok: false, error: 'Export request must be an object.' }
  if (!value.plan) return { ok: false, error: 'Export request is missing a render plan.' }
  if (!isProfileSnapshot(value.profile)) return { ok: false, error: 'Export request has an invalid profile.' }
  if (!isPreflightSnapshot(value.preflight)) return { ok: false, error: 'Export request has an invalid preflight report.' }
  if (!isExportOptions(value.nativeOptions)) return { ok: false, error: 'Export request has invalid native export options.' }
  if (!Array.isArray(value.mediaPaths) || !value.mediaPaths.every(isString)) {
    return { ok: false, error: 'Export request has invalid media paths.' }
  }
  if (value.outputPath != null && !isString(value.outputPath)) {
    return { ok: false, error: 'Export request has an invalid output path.' }
  }

  return { ok: true, value: value as unknown as ExportJobStartRequest }
}
