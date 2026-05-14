import { planExportBackend, type RenderBackend } from './exportPlanning'
import type { ExportProfile } from './exportSettings'
import type { RenderPlan, RenderResolution } from './renderPlan'

export interface ExportPreflightWarning {
  code: string
  message: string
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
  warnings: ExportPreflightWarning[]
}

function createWarnings(plan: RenderPlan, backend: RenderBackend, backendReason: string | undefined, frameCount: number): ExportPreflightWarning[] {
  const warnings: ExportPreflightWarning[] = []
  const pixelCount = plan.resolution.width * plan.resolution.height

  if (plan.durationMs <= 0 || frameCount <= 0) {
    warnings.push({ code: 'empty-timeline', message: 'Timeline has no exportable duration.' })
  }

  if (backend === 'renderer-canvas' && backendReason) {
    warnings.push({ code: 'canvas-backend', message: backendReason })
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

  return warnings
}

export function buildExportPreflight(plan: RenderPlan, profile: ExportProfile): ExportPreflight {
  const backendPlan = planExportBackend(plan)
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
    warnings: createWarnings(plan, backendPlan.backend, backendPlan.reason, frameCount),
  }
}
