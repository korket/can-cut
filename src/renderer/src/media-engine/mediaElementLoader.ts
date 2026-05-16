import type { MediaClip, TimelineItem } from '../types'
import { getClipSourceTimeMs, isItemActiveAt } from '../editor-core/timeline'
import { toFileUrl } from '../utils/fileUrl'

const PLAYBACK_SEEK_DRIFT_SEC = 1.0
const PLAYBACK_RATE_DRIFT_SEC = 0.08
const MAX_PLAYBACK_RATE_ADJUST = 0.12

export interface LoadedCanvasMedia {
  videoEls: Map<string, HTMLVideoElement>
  imageEls: Map<string, HTMLImageElement>
}

export async function loadCanvasMedia(
  timelineItems: TimelineItem[],
  clips: MediaClip[]
): Promise<LoadedCanvasMedia> {
  const videoEls = new Map<string, HTMLVideoElement>()
  const imageEls = new Map<string, HTMLImageElement>()
  const loads: Promise<void>[] = []

  for (const item of timelineItems) {
    const clip = clips.find((candidate) => candidate.id === item.clipId)
    if (!clip) continue

    if (clip.type === 'video' && !videoEls.has(item.id)) {
      const video = document.createElement('video')
      video.src = toFileUrl(clip.path)
      video.preload = 'auto'
      video.muted = true
      video.playsInline = true
      loads.push(new Promise<void>((resolve) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true })
        video.addEventListener('error', () => resolve(), { once: true })
        video.load()
      }))
      videoEls.set(item.id, video)
    } else if (clip.type === 'image' && !imageEls.has(clip.id)) {
      const image = new Image()
      image.src = toFileUrl(clip.path)
      loads.push(new Promise<void>((resolve) => {
        image.onload = () => resolve()
        image.onerror = () => resolve()
      }))
      imageEls.set(clip.id, image)
    }
  }

  await Promise.all(loads)
  return { videoEls, imageEls }
}

export function disposeCanvasMedia(media: LoadedCanvasMedia) {
  media.videoEls.forEach((video) => {
    video.pause()
    video.src = ''
    video.load()
  })
  media.videoEls.clear()
  media.imageEls.clear()
}

export function pauseCanvasVideos(media: LoadedCanvasMedia | null) {
  if (!media) return
  media.videoEls.forEach((video) => {
    video.playbackRate = 1
    video.pause()
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function playbackRateForDrift(driftSec: number): number {
  return clamp(1 + driftSec * 0.2, 1 - MAX_PLAYBACK_RATE_ADJUST, 1 + MAX_PLAYBACK_RATE_ADJUST)
}

export function activeCanvasVideosReady(
  media: LoadedCanvasMedia | null,
  timeMs: number,
  timelineItems: TimelineItem[]
): boolean {
  if (!media) return false

  for (const item of timelineItems) {
    const video = media.videoEls.get(item.id)
    if (!video || !isItemActiveAt(item, timeMs)) continue
    if (video.readyState < 2) return false
  }

  return true
}

export function syncCanvasVideoPlayback(
  media: LoadedCanvasMedia | null,
  timeMs: number,
  timelineItems: TimelineItem[]
) {
  if (!media) return
  const activeIds = new Set<string>()

  for (const item of timelineItems) {
    const video = media.videoEls.get(item.id)
    if (!video || !isItemActiveAt(item, timeMs)) continue

    activeIds.add(item.id)
    const targetSec = Math.max(0, getClipSourceTimeMs(item, timeMs) / 1000)
    if (!Number.isFinite(targetSec)) continue

    const driftSec = targetSec - video.currentTime
    const absDriftSec = Math.abs(driftSec)
    const shouldHardSeek = video.paused || video.ended || absDriftSec > PLAYBACK_SEEK_DRIFT_SEC

    if (shouldHardSeek && !video.seeking) {
      video.currentTime = targetSec
      video.playbackRate = 1
    } else if (absDriftSec > PLAYBACK_RATE_DRIFT_SEC) {
      video.playbackRate = playbackRateForDrift(driftSec)
    } else {
      video.playbackRate = 1
    }

    if (video.paused || video.ended) void video.play().catch(() => {})
  }

  for (const [itemId, video] of media.videoEls) {
    if (!activeIds.has(itemId)) video.pause()
  }
}
