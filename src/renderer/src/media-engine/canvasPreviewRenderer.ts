import type { MediaClip, TextOverlay, TimelineItem } from '../types'
import { renderCanvasFrame } from './canvasFrameRenderer'
import { disposeCanvasMedia, loadCanvasMedia, type LoadedCanvasMedia } from './mediaElementLoader'

interface PreviewRenderRequest {
  timeMs: number
  timelineItems: TimelineItem[]
  clips: MediaClip[]
  textOverlays: TextOverlay[]
}

export interface CanvasPreviewRenderer {
  loadMedia(timelineItems: TimelineItem[], clips: MediaClip[]): Promise<void>
  render(timeMs: number, timelineItems: TimelineItem[], clips: MediaClip[], textOverlays: TextOverlay[]): void
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
          await renderCanvasFrame(
            ctx,
            width,
            height,
            request.timeMs,
            request.timelineItems,
            request.clips,
            request.textOverlays,
            media,
            { seekTimeoutMs: 90 }
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
      if (renderRequest) void flushRenderQueue()
    },
    render(timeMs: number, timelineItems: TimelineItem[], clips: MediaClip[], textOverlays: TextOverlay[]) {
      renderRequest = { timeMs, timelineItems, clips, textOverlays }
      if (!media) {
        clear()
        return
      }
      void flushRenderQueue()
    },
    clear,
    dispose() {
      disposed = true
      mediaGeneration++
      renderRequest = null
      disposeCurrentMedia()
      clear()
    },
  }
}
