import { buildNativeExportOptions, type NativeExportOptions, type RenderBackend } from '../editor-core/exportPlanning'
import { buildExportPreflight, type ExportPreflight } from '../editor-core/exportPreflight'
import { DEFAULT_EXPORT_PROFILE, type ExportProfile } from '../editor-core/exportSettings'
import { getExportMediaPaths, type ExportValidationReport } from '../editor-core/exportValidation'
import type { RenderPlan } from '../editor-core/renderPlan'

export type ExportJobMode = 'native' | 'renderer'
export type ExportJobStatus = 'queued' | 'running' | 'canceling' | 'completed' | 'failed' | 'canceled' | 'interrupted'

export interface ExportJob {
  id: string
  plan: RenderPlan
  backend: RenderBackend
  mode: ExportJobMode
  profile: ExportProfile
  preflight: ExportPreflight
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

export interface ExportJobStartRequest {
  plan: RenderPlan
  profile: ExportProfile
  preflight: ExportPreflight
  nativeOptions: NativeExportOptions
  mediaPaths: string[]
}

export function isTerminalExportStatus(status: ExportJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled' || status === 'interrupted'
}

export function createExportJobStartRequest(
  plan: RenderPlan,
  profile: ExportProfile = DEFAULT_EXPORT_PROFILE
): ExportJobStartRequest {
  return {
    plan,
    profile,
    preflight: buildExportPreflight(plan, profile),
    nativeOptions: buildNativeExportOptions(plan, profile.encoder),
    mediaPaths: getExportMediaPaths(plan),
  }
}
