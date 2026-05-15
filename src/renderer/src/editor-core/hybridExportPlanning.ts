import type { ExportProfile } from './exportSettings'
import type { RenderPlan, TextRenderLayer, VideoRenderLayer } from './renderPlan'
import {
  buildNativeExportOptions,
  getNativeTextLayerIneligibility,
  getNativeVideoLayerIneligibility,
  type NativeExportOptions,
  type SegmentRenderBackend,
} from './exportPlanning'
import { createRenderCacheDescriptor, createRenderCacheKey } from '../media-engine/renderCache'

export interface HybridExportSegment {
  index: number
  backend: SegmentRenderBackend
  startMs: number
  endMs: number
  durationMs: number
  reason?: string
}

export interface HybridExportSegmentPlan extends HybridExportSegment {
  plan: RenderPlan
  nativeOptions: NativeExportOptions
  cacheKey?: string
}

export interface HybridExportPlan {
  segments: HybridExportSegmentPlan[]
}

interface VisualRange {
  startMs: number
  endMs: number
  reason?: string
}

function mediaLayerEnd(layer: { startTime: number; trimStart: number; trimEnd: number }): number {
  return layer.startTime + Math.max(0, layer.trimEnd - layer.trimStart)
}

function clampBoundary(value: number, durationMs: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(durationMs, value))
}

function addBoundary(boundaries: Set<number>, value: number, durationMs: number): void {
  boundaries.add(clampBoundary(value, durationMs))
}

function rangeOverlaps(startMs: number, endMs: number, range: VisualRange): boolean {
  return range.startMs < endMs && range.endMs > startMs
}

function findAdjacentOutgoingLayer(layer: VideoRenderLayer, layers: VideoRenderLayer[]): VideoRenderLayer | null {
  return layers.find((candidate) =>
    candidate.id !== layer.id &&
    candidate.trackIndex === layer.trackIndex &&
    Math.abs(mediaLayerEnd(candidate) - layer.startTime) < 500
  ) ?? null
}

function addComplexVideoRange(ranges: VisualRange[], layer: VideoRenderLayer, layers: VideoRenderLayer[], durationMs: number): void {
  const reason = getNativeVideoLayerIneligibility(layer)
  if (!reason) return

  const outgoing = layer.transitionIn && layer.transitionIn.type !== 'cut'
    ? findAdjacentOutgoingLayer(layer, layers)
    : null
  const startMs = clampBoundary(outgoing?.startTime ?? layer.startTime, durationMs)
  const endMs = clampBoundary(mediaLayerEnd(layer), durationMs)
  if (endMs <= startMs) return
  ranges.push({ startMs, endMs, reason })
}

function addComplexTextRange(ranges: VisualRange[], layer: TextRenderLayer, durationMs: number): void {
  const reason = getNativeTextLayerIneligibility(layer)
  if (!reason) return

  const startMs = clampBoundary(layer.startTime, durationMs)
  const endMs = clampBoundary(layer.endTime, durationMs)
  if (endMs <= startMs) return
  ranges.push({ startMs, endMs, reason })
}

function mergeSegments(segments: HybridExportSegment[]): HybridExportSegment[] {
  const merged: HybridExportSegment[] = []

  for (const segment of segments) {
    const previous = merged[merged.length - 1]
    if (previous && previous.backend === segment.backend && previous.reason === segment.reason && previous.endMs === segment.startMs) {
      previous.endMs = segment.endMs
      previous.durationMs = previous.endMs - previous.startMs
      continue
    }

    merged.push({ ...segment, index: merged.length })
  }

  return merged.map((segment, index) => ({ ...segment, index }))
}

export function planHybridExportSegments(plan: RenderPlan): HybridExportSegment[] {
  const durationMs = Math.max(0, plan.durationMs)
  if (durationMs <= 0) return []

  const boundaries = new Set<number>([0, durationMs])
  const complexRanges: VisualRange[] = []

  for (const layer of plan.videoLayers) {
    addBoundary(boundaries, layer.startTime, durationMs)
    addBoundary(boundaries, mediaLayerEnd(layer), durationMs)
    addComplexVideoRange(complexRanges, layer, plan.videoLayers, durationMs)
  }

  for (const layer of plan.textLayers) {
    addBoundary(boundaries, layer.startTime, durationMs)
    addBoundary(boundaries, layer.endTime, durationMs)
    addComplexTextRange(complexRanges, layer, durationMs)
  }

  for (const layer of plan.audioLayers) {
    addBoundary(boundaries, layer.startTime, durationMs)
    addBoundary(boundaries, mediaLayerEnd(layer), durationMs)
  }

  const sortedBoundaries = [...boundaries].sort((a, b) => a - b)
  const segments: HybridExportSegment[] = []

  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const startMs = sortedBoundaries[i]
    const endMs = sortedBoundaries[i + 1]
    if (endMs <= startMs) continue

    const complexRange = complexRanges.find((range) => rangeOverlaps(startMs, endMs, range))
    const backend: SegmentRenderBackend = complexRange ? 'renderer-canvas' : 'ffmpeg-native'
    segments.push({
      index: segments.length,
      backend,
      startMs,
      endMs,
      durationMs: endMs - startMs,
      reason: complexRange?.reason,
    })
  }

  return mergeSegments(segments)
}

function overlapsRange(startMs: number, endMs: number, rangeStartMs: number, rangeEndMs: number): boolean {
  return startMs < rangeEndMs && endMs > rangeStartMs
}

function sliceMediaLayer<T extends { startTime: number; trimStart: number; trimEnd: number }>(
  layer: T,
  segment: HybridExportSegment
): T | null {
  const layerStart = layer.startTime
  const layerEnd = mediaLayerEnd(layer)
  if (!overlapsRange(layerStart, layerEnd, segment.startMs, segment.endMs)) return null

  const overlapStart = Math.max(layerStart, segment.startMs)
  const overlapEnd = Math.min(layerEnd, segment.endMs)
  if (overlapEnd <= overlapStart) return null

  return {
    ...layer,
    startTime: overlapStart - segment.startMs,
    trimStart: layer.trimStart + (overlapStart - layerStart),
    trimEnd: layer.trimStart + (overlapEnd - layerStart),
  }
}

function sliceTextLayer(layer: TextRenderLayer, segment: HybridExportSegment): TextRenderLayer | null {
  if (!overlapsRange(layer.startTime, layer.endTime, segment.startMs, segment.endMs)) return null

  const startTime = Math.max(layer.startTime, segment.startMs) - segment.startMs
  const endTime = Math.min(layer.endTime, segment.endMs) - segment.startMs
  if (endTime <= startTime) return null

  return { ...layer, startTime, endTime }
}

export function createSegmentRenderPlan(plan: RenderPlan, segment: HybridExportSegment): RenderPlan {
  return {
    ...plan,
    durationMs: segment.durationMs,
    videoLayers: plan.videoLayers.flatMap((layer) => {
      const sliced = sliceMediaLayer(layer, segment)
      return sliced ? [sliced] : []
    }),
    audioLayers: plan.audioLayers.flatMap((layer) => {
      const sliced = sliceMediaLayer(layer, segment)
      return sliced ? [sliced] : []
    }),
    textLayers: plan.textLayers.flatMap((layer) => {
      const sliced = sliceTextLayer(layer, segment)
      return sliced ? [sliced] : []
    }),
  }
}

export function createHybridExportPlan(plan: RenderPlan, profile: ExportProfile): HybridExportPlan {
  return {
    segments: planHybridExportSegments(plan).map((segment) => {
      const segmentPlan = createSegmentRenderPlan(plan, segment)
      const cacheKey = segment.backend === 'renderer-canvas'
        ? createRenderCacheKey(createRenderCacheDescriptor(segmentPlan, profile, 'renderer-canvas'))
        : undefined

      return {
        ...segment,
        plan: segmentPlan,
        nativeOptions: buildNativeExportOptions(segmentPlan, profile.encoder),
        cacheKey,
      }
    }),
  }
}
