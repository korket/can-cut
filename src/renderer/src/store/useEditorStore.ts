import { create } from 'zustand'
import type { MediaClip, MediaFolder, TimelineItem, Transform, Effects, Animation, Transition, KeyframeTrack, Keyframe, TextOverlay, Tool } from '../types'
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_ANIMATION, DEFAULT_TRANSITION } from '../types'

const KF_SNAP = 50  // ms

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
  updateTransform: (id: string, changes: Partial<Transform>) => void
  updateEffects: (id: string, changes: Partial<Effects>) => void
  updateAnimation: (id: string, changes: Partial<Animation>) => void
  updateTransition: (id: string, changes: Partial<Transition> | null) => void
  addKeyframe: (itemId: string, property: string, time: number, value: number) => void
  removeKeyframe: (itemId: string, property: string, time: number) => void
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

  // Default transform (applied automatically to new clips when enabled)
  defaultTransformEnabled: boolean
  defaultTransform: Transform
  setDefaultTransformEnabled: (v: boolean) => void
  setDefaultTransform: (changes: Partial<Transform>) => void
  captureDefaultTransform: (t: Transform) => void

  // Project frame rate
  fps: number
  setFps: (fps: number) => void

  // Timeline zoom (px per second)
  zoom: number
  setZoom: (z: number) => void

  // Track counts
  videoTrackCount: number
  audioTrackCount: number
  addVideoTrack: () => void
  addAudioTrack: () => void

  // Hover preview (media bin clip hovered → show in main player)
  hoverPreviewClip: MediaClip | null
  setHoverPreviewClip: (clip: MediaClip | null) => void

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
  updateTransform: (id, changes) =>
    set((s) => ({
      timelineItems: s.timelineItems.map((i) =>
        i.id === id ? { ...i, transform: { ...DEFAULT_TRANSFORM, ...i.transform, ...changes } } : i
      )
    })),
  updateEffects: (id, changes) =>
    set((s) => ({
      timelineItems: s.timelineItems.map((i) =>
        i.id === id ? { ...i, effects: { ...DEFAULT_EFFECTS, ...i.effects, ...changes } } : i
      )
    })),
  updateAnimation: (id, changes) =>
    set((s) => ({
      timelineItems: s.timelineItems.map((i) =>
        i.id === id ? { ...i, animation: { ...DEFAULT_ANIMATION, ...i.animation, ...changes } } : i
      )
    })),
  updateTransition: (id, changes) =>
    set((s) => ({
      timelineItems: s.timelineItems.map((i) =>
        i.id === id
          ? { ...i, transitionIn: changes === null ? undefined : { ...DEFAULT_TRANSITION, ...i.transitionIn, ...changes } }
          : i
      )
    })),
  addKeyframe: (itemId, property, time, value) =>
    set((s) => ({
      timelineItems: s.timelineItems.map((i) => {
        if (i.id !== itemId) return i
        const tracks: KeyframeTrack[] = i.keyframeTracks ?? []
        const tIdx = tracks.findIndex(t => t.property === property)
        const newKf: Keyframe = { time, value, easing: 'linear' }
        if (tIdx === -1) {
          return { ...i, keyframeTracks: [...tracks, { property, keyframes: [newKf] }] }
        }
        const track = tracks[tIdx]
        const eIdx = track.keyframes.findIndex(kf => Math.abs(kf.time - time) <= KF_SNAP)
        const newKfs = eIdx !== -1
          ? track.keyframes.map((kf, k) => k === eIdx ? { ...kf, value } : kf)
          : [...track.keyframes, newKf].sort((a, b) => a.time - b.time)
        return { ...i, keyframeTracks: tracks.map((t, k) => k === tIdx ? { ...t, keyframes: newKfs } : t) }
      })
    })),

  removeKeyframe: (itemId, property, time) =>
    set((s) => ({
      timelineItems: s.timelineItems.map((i) => {
        if (i.id !== itemId) return i
        const tracks = (i.keyframeTracks ?? [])
          .map(t => t.property !== property ? t : {
            ...t, keyframes: t.keyframes.filter(kf => Math.abs(kf.time - time) > KF_SNAP)
          })
          .filter(t => t.keyframes.length > 0)
        return { ...i, keyframeTracks: tracks.length > 0 ? tracks : undefined }
      })
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

  hoverPreviewClip: null,
  setHoverPreviewClip: (clip) => set({ hoverPreviewClip: clip }),

  currentTime: 0,
  setCurrentTime: (t) => set({ currentTime: t }),
  isPlaying: false,
  setIsPlaying: (v) => set({ isPlaying: v }),
  duration: 0,

  selectedId: null,
  setSelectedId: (id) => set({ selectedId: id }),

  tool: 'select',
  setTool: (t) => set({ tool: t }),

  defaultTransformEnabled: false,
  defaultTransform: { ...DEFAULT_TRANSFORM },
  setDefaultTransformEnabled: (v) => set({ defaultTransformEnabled: v }),
  setDefaultTransform: (changes) => set((s) => ({ defaultTransform: { ...s.defaultTransform, ...changes } })),
  captureDefaultTransform: (t) => set({ defaultTransform: { ...t } }),

  fps: 30,
  setFps: (fps) => set({ fps }),

  zoom: 100,
  setZoom: (z) => set({ zoom: Math.max(1, Math.min(2000, z)) }),

  videoTrackCount: 2,
  audioTrackCount: 2,
  addVideoTrack: () => set((s) => ({
    videoTrackCount: s.videoTrackCount + 1,
    timelineItems: s.timelineItems.map(i =>
      i.trackIndex >= s.videoTrackCount ? { ...i, trackIndex: i.trackIndex + 1 } : i
    ),
  })),
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
