import { planExportBackend, type RenderBackend } from './exportPlanning'
import type { ExportProfile } from './exportSettings'
import { planHybridExportSegments } from './hybridExportPlanning'
import type { RenderPlan, RenderResolution } from './renderPlan'

export interface ExportPreflightWarning {
  code: string
  message: string
}

export interface ExportHybridDiagnostics {
  segmentCount: number
  nativeSegmentCount: number
  rendererSegmentCount: number
  nativeDurationMs: number
  rendererDurationMs: number
}

export interface ExportPreflight {
  backend: RenderBackend
  backendReason?: string
  profileId: string
  profileLabel: string
  framePipeFormat: 'raw-rgba' | 'mjpeg'
  resolution: RenderResolution
  fps: number
  durationMs: number
  frameCount: number
  videoLayerCount: number
  audioLayerCount: number
  textLayerCount: number
  pixelCountPerFrame: number
  totalPixelCount: number
  hybridDiagnostics?: ExportHybridDiagnostics
  warnings: ExportPreflightWarning[]
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function createHybridDiagnostics(segments: ReturnType<typeof planHybridExportSegments>): ExportHybridDiagnostics | undefined {
  if (segments.length === 0) return undefined

  let nativeSegmentCount = 0
  let rendererSegmentCount = 0
  let nativeDurationMs = 0
  let rendererDurationMs = 0

  for (const segment of segments) {
    if (segment.backend === 'ffmpeg-native') {
      nativeSegmentCount++
      nativeDurationMs += segment.durationMs
    } else {
      rendererSegmentCount++
      rendererDurationMs += segment.durationMs
    }
  }

  return {
    segmentCount: segments.length,
    nativeSegmentCount,
    rendererSegmentCount,
    nativeDurationMs,
    rendererDurationMs,
  }
}

function createWarnings(plan: RenderPlan, profile: ExportProfile, backend: RenderBackend, backendReason: string | undefined, frameCount: number): ExportPreflightWarning[] {
  const warnings: ExportPreflightWarning[] = []
  const pixelCount = plan.resolution.width * plan.resolution.height

  if (plan.durationMs <= 0 || frameCount <= 0) {
    warnings.push({ code: 'empty-timeline', message: 'Timeline has no exportable duration.' })
  }

  if (backend === 'renderer-canvas' && backendReason) {
    warnings.push({ code: 'canvas-backend', message: backendReason })
  }

  if (backend === 'hybrid') {
    warnings.push({ code: 'hybrid-backend', message: backendReason ?? 'Hybrid export will render only complex timeline ranges.' })
  }

  if (backend === 'renderer-canvas' && pixelCount > 1920 * 1080) {
    warnings.push({ code: 'high-res-canvas', message: 'High-resolution canvas export may take longer.' })
  }

  if (backend === 'renderer-canvas' && plan.fps > 30) {
    warnings.push({ code: 'high-fps-canvas', message: 'High-FPS canvas export increases rendered frame count.' })
  }

  if (frameCount > 10000) {
    warnings.push({ code: 'large-frame-count', message: 'Long exports create many frames and can take a while.' })
  }

  if (profile.encoder.videoCodec !== 'libx264') {
    warnings.push({ code: 'hardware-encoder', message: 'Hardware encoding requires a compatible GPU, driver, and FFmpeg encoder.' })
  }

  return warnings
}

export function buildExportPreflight(plan: RenderPlan, profile: ExportProfile): ExportPreflight {
  const wholeBackendPlan = planExportBackend(plan)
  const hybridSegments = wholeBackendPlan.backend === 'renderer-canvas'
    ? planHybridExportSegments(plan)
    : []
  const hybridDiagnostics = createHybridDiagnostics(hybridSegments)
  const hasNativeSegment = hybridSegments.some((segment) => segment.backend === 'ffmpeg-native')
  const hasRendererSegment = hybridSegments.some((segment) => segment.backend === 'renderer-canvas')
  const backendPlan = hasNativeSegment && hasRendererSegment
    ? {
      backend: 'hybrid' as const,
      reason: hybridDiagnostics
        ? `${hybridDiagnostics.segmentCount} segments: ${formatSeconds(hybridDiagnostics.nativeDurationMs)} FFmpeg, ${formatSeconds(hybridDiagnostics.rendererDurationMs)} renderer.`
        : `${hybridSegments.length} export segments: FFmpeg for simple ranges, renderer for complex ranges.`,
    }
    : wholeBackendPlan
  const frameCount = Math.max(0, Math.ceil((plan.durationMs / 1000) * plan.fps))
  const pixelCountPerFrame = plan.resolution.width * plan.resolution.height

  return {
    backend: backendPlan.backend,
    backendReason: backendPlan.reason,
    profileId: profile.id,
    profileLabel: profile.label,
    framePipeFormat: profile.encoder.framePipeFormat,
    resolution: plan.resolution,
    fps: plan.fps,
    durationMs: plan.durationMs,
    frameCount,
    videoLayerCount: plan.videoLayers.length,
    audioLayerCount: plan.audioLayers.length,
    textLayerCount: plan.textLayers.length,
    pixelCountPerFrame,
    totalPixelCount: pixelCountPerFrame * frameCount,
    hybridDiagnostics,
    warnings: createWarnings(plan, profile, backendPlan.backend, backendPlan.reason, frameCount),
  }
}
