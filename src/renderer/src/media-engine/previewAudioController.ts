import { getClipSourceTimeMs, isItemActiveAt } from '../editor-core/timeline'
import type { MediaClip, TimelineItem } from '../types'

export interface PreviewAudioController {
  load(timelineItems: TimelineItem[], clips: MediaClip[]): void
  seek(timeMs: number, timelineItems: TimelineItem[]): void
  playActive(timeMs: number, timelineItems: TimelineItem[]): void
  sync(timeMs: number, timelineItems: TimelineItem[]): void
  pause(): void
  dispose(): void
}

function clipHasPlayableAudio(clip: MediaClip) {
  return clip.type === 'audio' || clip.type === 'video'
}

function sourceTimeSec(item: TimelineItem, timeMs: number) {
  return Math.max(0, getClipSourceTimeMs(item, timeMs) / 1000)
}

export function createPreviewAudioController(): PreviewAudioController {
  const audioEls = new Map<string, HTMLAudioElement>()
  let activeAudioIds = new Set<string>()

  function pauseInactive(ids: Set<string>) {
    for (const id of activeAudioIds) {
      if (!ids.has(id)) audioEls.get(id)?.pause()
    }
  }

  function syncElementVolume(item: TimelineItem) {
    const el = audioEls.get(item.id)
    if (!el) return
    el.volume = Math.min(1, (item.volume ?? 100) / 100)
  }

  function playItem(item: TimelineItem, timeMs: number) {
    const el = audioEls.get(item.id)
    if (!el) return
    el.currentTime = sourceTimeSec(item, timeMs)
    el.play().catch(() => {})
  }

  return {
    load(timelineItems: TimelineItem[], clips: MediaClip[]) {
      const liveAudioIds = new Set<string>()

      for (const item of timelineItems) {
        const clip = clips.find((candidate) => candidate.id === item.clipId)
        if (!clip || !clipHasPlayableAudio(clip)) continue

        liveAudioIds.add(item.id)
        const src = `file://${clip.path}`
        if (!audioEls.has(item.id)) {
          const el = new Audio()
          el.src = src
          el.preload = 'auto'
          audioEls.set(item.id, el)
        } else {
          const el = audioEls.get(item.id)!
          if (el.src !== src) el.src = src
        }
        syncElementVolume(item)
      }

      for (const [id, el] of audioEls) {
        if (!liveAudioIds.has(id)) {
          el.pause()
          el.src = ''
          audioEls.delete(id)
        }
      }

      activeAudioIds = new Set([...activeAudioIds].filter((id) => liveAudioIds.has(id)))
    },
    seek(timeMs: number, timelineItems: TimelineItem[]) {
      for (const [id, el] of audioEls) {
        const item = timelineItems.find((candidate) => candidate.id === id)
        if (!item) continue
        const timeSec = sourceTimeSec(item, timeMs)
        if (Number.isFinite(timeSec)) el.currentTime = timeSec
      }
    },
    playActive(timeMs: number, timelineItems: TimelineItem[]) {
      const nextActiveIds = new Set<string>()

      for (const [id] of audioEls) {
        const item = timelineItems.find((candidate) => candidate.id === id)
        if (!item || !isItemActiveAt(item, timeMs)) continue

        playItem(item, timeMs)
        nextActiveIds.add(id)
      }

      pauseInactive(nextActiveIds)
      activeAudioIds = nextActiveIds
    },
    sync(timeMs: number, timelineItems: TimelineItem[]) {
      const nextActiveIds = new Set<string>()

      for (const [id, el] of audioEls) {
        const item = timelineItems.find((candidate) => candidate.id === id)
        if (!item || !isItemActiveAt(item, timeMs)) {
          if (activeAudioIds.has(id)) el.pause()
          continue
        }

        nextActiveIds.add(id)
        if (!activeAudioIds.has(id)) playItem(item, timeMs)
      }

      activeAudioIds = nextActiveIds
    },
    pause() {
      for (const [, el] of audioEls) el.pause()
      activeAudioIds = new Set()
    },
    dispose() {
      for (const [, el] of audioEls) {
        el.pause()
        el.src = ''
      }
      audioEls.clear()
      activeAudioIds = new Set()
    },
  }
}
