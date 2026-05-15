import type { ExportProfile } from '../editor-core/exportSettings'
import type { RenderPlan } from '../editor-core/renderPlan'

export interface PreviewRenderer {
  setPlan(plan: RenderPlan): void
  seek(timeMs: number): void | Promise<void>
  play(timeMs: number): void
  pause(): void
  dispose(): void
}

export interface ExportTraceMetrics {
  planHash?: string
  cacheKey?: string
  mediaLoadMs?: number
  encoderStartMs?: number
  frameRenderMs?: number
  frameReadbackMs?: number
  frameTransferMs?: number
  encoderFinalizeMs?: number
  totalMs?: number
  frameCount?: number
  frameBytes?: number
}

export interface ExportRendererResult {
  success?: boolean
  path?: string
  error?: string
  canceled?: boolean
  trace?: ExportTraceMetrics
}

export interface ExportRendererControls {
  isCanceled?: () => boolean
  outputPath?: string
  cacheKey?: string
  includeAudio?: boolean
}

export interface ExportRenderer {
  id: string
  label: string
  export(
    jobId: string,
    plan: RenderPlan,
    profile: ExportProfile,
    onProgress: (pct: number) => void,
    controls?: ExportRendererControls,
  ): Promise<ExportRendererResult>
}
