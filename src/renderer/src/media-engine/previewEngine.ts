import {
  getRenderPlanAssets,
  getRenderPlanTimelineItems,
  type RenderPlan,
} from '../editor-core/renderPlan'
import type { MediaClip, TextOverlay, TimelineItem } from '../types'
import { createCanvasPreviewRenderer } from './canvasPreviewRenderer'
import { createGpuPreviewRenderer } from './gpuPreviewRenderer'
import { createPreviewAudioController } from './previewAudioController'
import { createTimelinePlaybackClock } from './timelinePlaybackClock'

export interface PreviewEngineOptions {
  canvas: HTMLCanvasElement
  width: number
  height: number
  onTimeUpdate: (timeMs: number) => void
  onEnded: () => void
}

export interface PreviewEngine {
  setPlan(plan: RenderPlan): void
  render(timeMs: number): void
  seek(timeMs: number): void
  play(timeMs: number): void
  pause(): void
  dispose(): void
}

interface PreviewPlanParts {
  timelineItems: TimelineItem[]
  clips: MediaClip[]
  textOverlays: TextOverlay[]
}

function getPlanParts(plan: RenderPlan): PreviewPlanParts {
  return {
    timelineItems: getRenderPlanTimelineItems(plan),
    clips: getRenderPlanAssets(plan),
    textOverlays: plan.textLayers,
  }
}

function mediaSignature(parts: PreviewPlanParts) {
  const clipSignature = parts.clips
    .map((clip) => `${clip.id}:${clip.path}:${clip.type}`)
    .join('|')
  const itemSignature = parts.timelineItems
    .map((item) => `${item.id}:${item.clipId}`)
    .join('|')
  return `${clipSignature}::${itemSignature}`
}

function gpuPreviewEnabled(): boolean {
  try {
    return localStorage.getItem('canCut.gpuPreview') === '1'
  } catch {
    return false
  }
}

function createPreviewRenderer(canvas: HTMLCanvasElement, width: number, height: number) {
  if (gpuPreviewEnabled()) {
    const gpuRenderer = createGpuPreviewRenderer(canvas, width, height)
    if (gpuRenderer) return gpuRenderer
    console.warn('GPU preview requested but unavailable; falling back to canvas preview')
  }

  return createCanvasPreviewRenderer(canvas, width, height)
}

export function createPreviewEngine(options: PreviewEngineOptions): PreviewEngine {
  const renderer = createPreviewRenderer(options.canvas, options.width, options.height)
  const audio = createPreviewAudioController()
  let currentPlan: RenderPlan | null = null
  let currentParts: PreviewPlanParts | null = null
  let currentMediaSignature = ''

  const clock = createTimelinePlaybackClock({
    getDuration: () => currentPlan?.durationMs ?? 0,
    onTick: (timeMs) => {
      if (currentParts) {
        audio.sync(timeMs, currentParts.timelineItems)
        renderer.render(timeMs, currentParts.timelineItems, currentParts.clips, currentParts.textOverlays)
      }
      options.onTimeUpdate(timeMs)
    },
    onEnd: () => {
      audio.pause()
      options.onEnded()
    },
  })

  return {
    setPlan(plan: RenderPlan) {
      currentPlan = plan
      currentParts = getPlanParts(plan)

      const nextMediaSignature = mediaSignature(currentParts)
      if (nextMediaSignature !== currentMediaSignature) {
        currentMediaSignature = nextMediaSignature
        void renderer.loadMedia(currentParts.timelineItems, currentParts.clips)
      }

      audio.load(currentParts.timelineItems, currentParts.clips)
    },
    render(timeMs: number) {
      if (!currentParts) {
        renderer.clear()
        return
      }
      renderer.render(timeMs, currentParts.timelineItems, currentParts.clips, currentParts.textOverlays)
    },
    seek(timeMs: number) {
      if (!currentParts) {
        renderer.clear()
        return
      }
      renderer.render(timeMs, currentParts.timelineItems, currentParts.clips, currentParts.textOverlays)
    },
    play(timeMs: number) {
      if (!currentParts) return
      audio.playActive(timeMs, currentParts.timelineItems)
      clock.play(timeMs)
    },
    pause() {
      clock.pause()
      audio.pause()
    },
    dispose() {
      clock.dispose()
      audio.dispose()
      renderer.dispose()
      currentPlan = null
      currentParts = null
      currentMediaSignature = ''
    },
  }
}
