import type { MediaClip, MediaFolder, TextOverlay, TimelineItem } from '../types'

export const PROJECT_SCHEMA_VERSION = 1

export interface ProjectSettings {
  fps: number
  videoTrackCount: number
  audioTrackCount: number
  zoom?: number
  resolution?: string
}

export interface TimelineDocument {
  id: string
  name: string
  items: TimelineItem[]
  textOverlays: TextOverlay[]
}

export interface ProjectDocument {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  id: string
  name: string
  createdAt?: string
  updatedAt?: string
  thumbnail?: string | null
  settings: ProjectSettings
  media: {
    clips: MediaClip[]
    folders: MediaFolder[]
  }
  timelines: TimelineDocument[]
  activeTimelineId: string
}

export interface EditorDocumentState {
  id: string
  name: string
  createdAt?: string
  updatedAt?: string
  thumbnail?: string | null
  clips: MediaClip[]
  folders: MediaFolder[]
  timelineItems: TimelineItem[]
  textOverlays: TextOverlay[]
  fps: number
  videoTrackCount: number
  audioTrackCount: number
  zoom?: number
}

function isProjectDocument(value: unknown): value is ProjectDocument {
  const doc = value as Partial<ProjectDocument> | null
  return !!doc && doc.schemaVersion === PROJECT_SCHEMA_VERSION && !!doc.media && Array.isArray(doc.timelines)
}

function getThumbnail(state: Pick<EditorDocumentState, 'thumbnail' | 'timelineItems' | 'clips'>): string | null {
  if (state.thumbnail) return state.thumbnail
  const first = state.timelineItems[0]
  if (!first) return null
  const clip = state.clips.find((candidate) => candidate.id === first.clipId)
  return clip?.thumbnail ?? null
}

export function createProjectDocument(state: EditorDocumentState): ProjectDocument {
  const activeTimelineId = 'main'

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: state.id,
    name: state.name,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    thumbnail: getThumbnail(state),
    settings: {
      fps: state.fps,
      videoTrackCount: state.videoTrackCount,
      audioTrackCount: state.audioTrackCount,
      zoom: state.zoom,
    },
    media: {
      clips: state.clips,
      folders: state.folders,
    },
    timelines: [{
      id: activeTimelineId,
      name: 'Main Timeline',
      items: state.timelineItems,
      textOverlays: state.textOverlays,
    }],
    activeTimelineId,
  }
}

export function getActiveTimeline(document: ProjectDocument): TimelineDocument {
  return (
    document.timelines.find((timeline) => timeline.id === document.activeTimelineId) ??
    document.timelines[0] ?? {
      id: 'main',
      name: 'Main Timeline',
      items: [],
      textOverlays: [],
    }
  )
}

export function readEditorStateFromProjectData(raw: unknown): EditorDocumentState {
  if (isProjectDocument(raw)) {
    const timeline = getActiveTimeline(raw)
    return {
      id: raw.id,
      name: raw.name,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      thumbnail: raw.thumbnail ?? null,
      clips: raw.media.clips ?? [],
      folders: raw.media.folders ?? [],
      timelineItems: timeline.items ?? [],
      textOverlays: timeline.textOverlays ?? [],
      fps: raw.settings.fps ?? 30,
      videoTrackCount: raw.settings.videoTrackCount ?? 2,
      audioTrackCount: raw.settings.audioTrackCount ?? 2,
      zoom: raw.settings.zoom ?? 100,
    }
  }

  const legacy = raw as Record<string, any>
  return {
    id: String(legacy?.id ?? ''),
    name: String(legacy?.name ?? 'Untitled'),
    createdAt: legacy?.createdAt,
    updatedAt: legacy?.updatedAt,
    thumbnail: legacy?.thumbnail ?? null,
    clips: legacy?.clips ?? [],
    folders: legacy?.folders ?? [],
    timelineItems: legacy?.timelineItems ?? [],
    textOverlays: legacy?.textOverlays ?? [],
    fps: legacy?.fps ?? 30,
    videoTrackCount: legacy?.videoTrackCount ?? 2,
    audioTrackCount: legacy?.audioTrackCount ?? 2,
    zoom: legacy?.zoom ?? 100,
  }
}
