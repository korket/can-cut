import { create } from 'zustand'
import { useEditorStore } from './useEditorStore'

export type HistorySnapshot = {
  clips: any[]
  folders: any[]
  timelineItems: any[]
  textOverlays: any[]
  videoTrackCount: number
  audioTrackCount: number
}

export function captureSnapshot(): HistorySnapshot {
  const s = useEditorStore.getState()
  return {
    clips:           s.clips,
    folders:         s.folders,
    timelineItems:   s.timelineItems,
    textOverlays:    s.textOverlays,
    videoTrackCount: s.videoTrackCount,
    audioTrackCount: s.audioTrackCount,
  }
}

export function snapshotChanged(a: HistorySnapshot, b: HistorySnapshot): boolean {
  return (
    a.clips           !== b.clips           ||
    a.folders         !== b.folders         ||
    a.timelineItems   !== b.timelineItems   ||
    a.textOverlays    !== b.textOverlays    ||
    a.videoTrackCount !== b.videoTrackCount ||
    a.audioTrackCount !== b.audioTrackCount
  )
}

interface HistoryStore {
  past: HistorySnapshot[]
  future: HistorySnapshot[]
  isApplying: boolean
  push: (snap: HistorySnapshot) => void
  undo: () => void
  redo: () => void
  clear: () => void
}

const MAX = 50

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],
  isApplying: false,

  push: (snap) => set((s) => ({
    past: [...s.past.slice(-(MAX - 1)), snap],
    future: [],
  })),

  undo: () => {
    const { past, future, isApplying } = get()
    if (!past.length || isApplying) return
    const current = captureSnapshot()
    const prev = past[past.length - 1]
    set({ past: past.slice(0, -1), future: [current, ...future.slice(0, MAX - 1)], isApplying: true })
    useEditorStore.setState(prev)
    set({ isApplying: false })
  },

  redo: () => {
    const { past, future, isApplying } = get()
    if (!future.length || isApplying) return
    const current = captureSnapshot()
    const next = future[0]
    set({ past: [...past.slice(-(MAX - 1)), current], future: future.slice(1), isApplying: true })
    useEditorStore.setState(next)
    set({ isApplying: false })
  },

  clear: () => set({ past: [], future: [], isApplying: false }),
}))
