import { create } from 'zustand'
import type { MediaClip, MediaFolder, TimelineItem, TextOverlay, Tool } from '../types'

interface EditorStore {
  // Media bin
  clips: MediaClip[]
  addClip: (clip: MediaClip) => void
  removeClip: (id: string) => void

  // Folders
  folders: MediaFolder[]
  addFolder: (folder: MediaFolder) => void
  removeFolder: (id: string) => void
  renameFolder: (id: string, name: string) => void
  moveClipToFolder: (clipId: string, folderId: string | null) => void

  // Timeline
  timelineItems: TimelineItem[]
  addTimelineItem: (item: TimelineItem) => void
  updateTimelineItem: (id: string, changes: Partial<TimelineItem>) => void
  removeTimelineItem: (id: string) => void
  moveTimelineItem: (id: string, startTime: number, trackIndex: number) => void

  // Text overlays
  textOverlays: TextOverlay[]
  addTextOverlay: (overlay: TextOverlay) => void
  updateTextOverlay: (id: string, changes: Partial<TextOverlay>) => void
  removeTextOverlay: (id: string) => void

  // Playback
  currentTime: number
  setCurrentTime: (t: number) => void
  isPlaying: boolean
  setIsPlaying: (v: boolean) => void
  duration: number

  // Selection
  selectedId: string | null
  setSelectedId: (id: string | null) => void

  // Active tool
  tool: Tool
  setTool: (t: Tool) => void

  // Timeline zoom (px per second)
  zoom: number
  setZoom: (z: number) => void

  // Track counts
  videoTrackCount: number
  audioTrackCount: number
  addVideoTrack: () => void
  addAudioTrack: () => void

  // Helpers
  getTimelineDuration: () => number
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  clips: [],
  addClip: (clip) => set((s) => ({ clips: [...s.clips, clip] })),
  removeClip: (id) => set((s) => ({ clips: s.clips.filter((c) => c.id !== id) })),

  folders: [],
  addFolder: (folder) => set((s) => ({ folders: [...s.folders, folder] })),
  removeFolder: (id) => set((s) => ({
    folders: s.folders.filter((f) => f.id !== id),
    clips: s.clips.map((c) => c.folderId === id ? { ...c, folderId: null } : c),
  })),
  renameFolder: (id, name) => set((s) => ({
    folders: s.folders.map((f) => f.id === id ? { ...f, name } : f),
  })),
  moveClipToFolder: (clipId, folderId) => set((s) => ({
    clips: s.clips.map((c) => c.id === clipId ? { ...c, folderId } : c),
  })),

  timelineItems: [],
  addTimelineItem: (item) => set((s) => ({ timelineItems: [...s.timelineItems, item] })),
  updateTimelineItem: (id, changes) =>
    set((s) => ({
      timelineItems: s.timelineItems.map((i) => (i.id === id ? { ...i, ...changes } : i))
    })),
  removeTimelineItem: (id) =>
    set((s) => ({ timelineItems: s.timelineItems.filter((i) => i.id !== id) })),
  moveTimelineItem: (id, startTime, trackIndex) =>
    set((s) => ({
      timelineItems: s.timelineItems.map((i) =>
        i.id === id ? { ...i, startTime: Math.max(0, startTime), trackIndex } : i
      )
    })),

  textOverlays: [],
  addTextOverlay: (overlay) => set((s) => ({ textOverlays: [...s.textOverlays, overlay] })),
  updateTextOverlay: (id, changes) =>
    set((s) => ({
      textOverlays: s.textOverlays.map((o) => (o.id === id ? { ...o, ...changes } : o))
    })),
  removeTextOverlay: (id) =>
    set((s) => ({ textOverlays: s.textOverlays.filter((o) => o.id !== id) })),

  currentTime: 0,
  setCurrentTime: (t) => set({ currentTime: t }),
  isPlaying: false,
  setIsPlaying: (v) => set({ isPlaying: v }),
  duration: 0,

  selectedId: null,
  setSelectedId: (id) => set({ selectedId: id }),

  tool: 'select',
  setTool: (t) => set({ tool: t }),

  zoom: 100,
  setZoom: (z) => set({ zoom: Math.max(20, Math.min(500, z)) }),

  videoTrackCount: 2,
  audioTrackCount: 2,
  addVideoTrack: () => set((s) => ({ videoTrackCount: s.videoTrackCount + 1 })),
  addAudioTrack: () => set((s) => ({ audioTrackCount: s.audioTrackCount + 1 })),

  getTimelineDuration: () => {
    const { timelineItems, clips } = get()
    if (timelineItems.length === 0) return 0
    let max = 0
    for (const item of timelineItems) {
      const clip = clips.find((c) => c.id === item.clipId)
      if (!clip) continue
      const end = item.startTime + (item.trimEnd - item.trimStart)
      if (end > max) max = end
    }
    return max
  }
}))
