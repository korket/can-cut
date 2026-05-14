import type { MediaClip, TimelineItem } from '../types'

export interface ResolvedTimelineItem {
  item: TimelineItem
  clip: MediaClip
}

export function getItemDuration(item: TimelineItem): number {
  return Math.max(0, item.trimEnd - item.trimStart)
}

export function getItemEnd(item: TimelineItem): number {
  return item.startTime + getItemDuration(item)
}

export function isItemActiveAt(item: TimelineItem, timeMs: number): boolean {
  return timeMs >= item.startTime && timeMs < getItemEnd(item)
}

export function resolveTimelineItems(items: TimelineItem[], clips: MediaClip[]): ResolvedTimelineItem[] {
  return items.flatMap((item) => {
    const clip = clips.find((candidate) => candidate.id === item.clipId)
    return clip ? [{ item, clip }] : []
  })
}

export function sortVideoLayersBottomToTop(a: ResolvedTimelineItem, b: ResolvedTimelineItem): number {
  return a.item.trackIndex - b.item.trackIndex || a.item.startTime - b.item.startTime
}

export function getActiveVideoLayersAt(
  items: TimelineItem[],
  clips: MediaClip[],
  timeMs: number
): ResolvedTimelineItem[] {
  return resolveTimelineItems(items, clips)
    .filter(({ item, clip }) => clip.type !== 'audio' && isItemActiveAt(item, timeMs))
    .sort(sortVideoLayersBottomToTop)
}

export function getTimelineDuration(items: TimelineItem[]): number {
  let max = 0
  for (const item of items) {
    const end = getItemEnd(item)
    if (end > max) max = end
  }
  return max
}

export function findAdjacentPreviousItem(
  items: TimelineItem[],
  item: TimelineItem,
  toleranceMs = 500
): TimelineItem | null {
  return items.find((candidate) =>
    candidate.trackIndex === item.trackIndex &&
    candidate.id !== item.id &&
    Math.abs(getItemEnd(candidate) - item.startTime) < toleranceMs
  ) ?? null
}

export function getClipSourceTimeMs(item: TimelineItem, timelineTimeMs: number): number {
  return item.trimStart + (timelineTimeMs - item.startTime)
}
