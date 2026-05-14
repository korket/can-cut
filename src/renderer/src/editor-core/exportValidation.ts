import type { RenderPlan } from './renderPlan'

export type ExportValidationSeverity = 'error' | 'warning'

export interface ExportPathValidationResult {
  path: string
  exists: boolean
  isFile: boolean
  error?: string
}

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

export function getExportMediaPaths(plan: RenderPlan): string[] {
  const paths = new Set<string>()

  for (const layer of [...plan.videoLayers, ...plan.audioLayers]) {
    if (layer.asset.type === 'solid') continue
    if (layer.asset.path) paths.add(layer.asset.path)
  }

  return [...paths]
}

export function validateExportPlan(
  plan: RenderPlan,
  pathResults: ExportPathValidationResult[] = []
): ExportValidationReport {
  const issues: ExportValidationIssue[] = []
  const pathResultByPath = new Map(pathResults.map((result) => [result.path, result]))

  if (plan.durationMs <= 0) {
    issues.push({ severity: 'error', code: 'empty-timeline', message: 'Timeline has no exportable duration.' })
  }

  if (plan.fps <= 0 || !Number.isFinite(plan.fps)) {
    issues.push({ severity: 'error', code: 'invalid-fps', message: 'Export frame rate is invalid.' })
  }

  if (plan.resolution.width <= 0 || plan.resolution.height <= 0) {
    issues.push({ severity: 'error', code: 'invalid-resolution', message: 'Export resolution is invalid.' })
  }

  for (const layer of [...plan.videoLayers, ...plan.audioLayers]) {
    if (layer.trimEnd <= layer.trimStart) {
      issues.push({
        severity: 'error',
        code: 'zero-duration-layer',
        message: `Layer ${layer.id} has no exportable duration.`,
        layerId: layer.id,
      })
    }

    if (layer.asset.type === 'solid') continue

    if (!layer.asset.path) {
      issues.push({
        severity: 'error',
        code: 'missing-path',
        message: `${layer.asset.name || layer.asset.id} does not have a media path.`,
        layerId: layer.id,
      })
      continue
    }

    const pathResult = pathResultByPath.get(layer.asset.path)
    if (!pathResult) continue

    if (!pathResult.exists) {
      issues.push({
        severity: 'error',
        code: 'missing-file',
        message: `${layer.asset.name || layer.asset.id} is missing from disk.`,
        path: layer.asset.path,
        layerId: layer.id,
      })
    } else if (!pathResult.isFile) {
      issues.push({
        severity: 'error',
        code: 'not-a-file',
        message: `${layer.asset.name || layer.asset.id} does not point to a file.`,
        path: layer.asset.path,
        layerId: layer.id,
      })
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    checkedAt: Date.now(),
    issues,
  }
}
