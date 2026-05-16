import type { MediaClip, TextOverlay, TimelineItem } from '../types'
import { renderCanvasFrame } from './canvasFrameRenderer'
import {
  activeCanvasVideosReady,
  disposeCanvasMedia,
  loadCanvasMedia,
  pauseCanvasVideos,
  syncCanvasVideoPlayback,
  type LoadedCanvasMedia,
} from './mediaElementLoader'

interface PreviewRenderRequest {
  timeMs: number
  timelineItems: TimelineItem[]
  clips: MediaClip[]
  textOverlays: TextOverlay[]
  playbackActive: boolean
  generation: number
}

export interface CanvasPreviewRenderer {
  loadMedia(timelineItems: TimelineItem[], clips: MediaClip[]): Promise<void>
  render(timeMs: number, timelineItems: TimelineItem[], clips: MediaClip[], textOverlays: TextOverlay[]): void
  startPlayback(timeMs: number, timelineItems: TimelineItem[]): void
  stopPlayback(): void
  clear(): void
  dispose(): void
}

export function createCanvasPreviewRenderer(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): CanvasPreviewRenderer {
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Could not create preview canvas context')

  let disposed = false
  let mediaGeneration = 0
  let media: LoadedCanvasMedia | null = null
  let renderRequest: PreviewRenderRequest | null = null
  let renderRunning = false
  let playbackActive = false
  let playbackTimeMs = 0
  let playbackTimelineItems: TimelineItem[] = []
  let renderGeneration = 0

  function clear() {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
  }

  function disposeCurrentMedia() {
    if (!media) return
    disposeCanvasMedia(media)
    media = null
  }

  async function flushRenderQueue() {
    if (renderRunning) return
    renderRunning = true

    try {
      while (renderRequest && !disposed) {
        const request = renderRequest
        renderRequest = null

        if (!media) {
          clear()
          continue
        }

        try {
          if (request.generation !== renderGeneration) continue

          if (request.playbackActive) {
            syncCanvasVideoPlayback(media, request.timeMs, request.timelineItems)
            if (!activeCanvasVideosReady(media, request.timeMs, request.timelineItems)) continue
          }

          const renderOptions = request.playbackActive
            ? { seekTimeoutMs: 90, realtimeVideoPlayback: true, shouldContinue: () => request.generation === renderGeneration }
            : { seekTimeoutMs: 120, strictSeek: true, prepareVideoBeforeClear: true, shouldContinue: () => request.generation === renderGeneration }

          await renderCanvasFrame(
            ctx,
            width,
            height,
            request.timeMs,
            request.timelineItems,
            request.clips,
            request.textOverlays,
            media,
            renderOptions
          )
        } catch (err) {
          console.error('Preview render failed', err)
        }
      }
    } finally {
      renderRunning = false
      if (renderRequest && !disposed) void flushRenderQueue()
    }
  }

  return {
    async loadMedia(timelineItems: TimelineItem[], clips: MediaClip[]) {
      const generation = ++mediaGeneration
      disposeCurrentMedia()
      clear()

      const loadedMedia = await loadCanvasMedia(timelineItems, clips)
      if (disposed || generation !== mediaGeneration) {
        disposeCanvasMedia(loadedMedia)
        return
      }

      media = loadedMedia
      if (playbackActive) syncCanvasVideoPlayback(media, playbackTimeMs, playbackTimelineItems)
      if (renderRequest) void flushRenderQueue()
    },
    render(timeMs: number, timelineItems: TimelineItem[], clips: MediaClip[], textOverlays: TextOverlay[]) {
      if (playbackActive) {
        playbackTimeMs = timeMs
        playbackTimelineItems = timelineItems
      }
      renderRequest = { timeMs, timelineItems, clips, textOverlays, playbackActive, generation: renderGeneration }
      if (!media) {
        clear()
        return
      }
      void flushRenderQueue()
    },
    startPlayback(timeMs: number, timelineItems: TimelineItem[]) {
      renderGeneration++
      playbackActive = true
      playbackTimeMs = timeMs
      playbackTimelineItems = timelineItems
      syncCanvasVideoPlayback(media, timeMs, timelineItems)
    },
    stopPlayback() {
      renderGeneration++
      playbackActive = false
      pauseCanvasVideos(media)
    },
    clear,
    dispose() {
      disposed = true
      playbackActive = false
      renderGeneration++
      mediaGeneration++
      renderRequest = null
      pauseCanvasVideos(media)
      disposeCurrentMedia()
      clear()
    },
  }
}
