import type { MediaClip, TimelineItem } from '../types'

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
      video.src = `file://${clip.path}`
      video.preload = 'auto'
      video.muted = true
      loads.push(new Promise<void>((resolve) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true })
        video.addEventListener('error', () => resolve(), { once: true })
        video.load()
      }))
      videoEls.set(item.id, video)
    } else if (clip.type === 'image' && !imageEls.has(clip.id)) {
      const image = new Image()
      image.src = `file://${clip.path}`
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
    video.src = ''
    video.load()
  })
  media.videoEls.clear()
  media.imageEls.clear()
}
