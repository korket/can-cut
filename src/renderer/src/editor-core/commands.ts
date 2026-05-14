import type { MediaClip, MediaFolder, TextOverlay, TimelineItem } from '../types'

export interface EditableDocumentState {
  clips: MediaClip[]
  folders: MediaFolder[]
  timelineItems: TimelineItem[]
  textOverlays: TextOverlay[]
  videoTrackCount: number
  audioTrackCount: number
}

export interface EditorCommand {
  id: string
  label: string
  before: EditableDocumentState
  after: EditableDocumentState
  createdAt: number
  updatedAt: number
}

export function editableStateChanged(a: EditableDocumentState, b: EditableDocumentState): boolean {
  return (
    a.clips !== b.clips ||
    a.folders !== b.folders ||
    a.timelineItems !== b.timelineItems ||
    a.textOverlays !== b.textOverlays ||
    a.videoTrackCount !== b.videoTrackCount ||
    a.audioTrackCount !== b.audioTrackCount
  )
}

export function createEditorCommand(
  label: string,
  before: EditableDocumentState,
  after: EditableDocumentState
): EditorCommand | null {
  if (!editableStateChanged(before, after)) return null
  const now = Date.now()
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2)}`,
    label,
    before,
    after,
    createdAt: now,
    updatedAt: now,
  }
}

export function mergeEditorCommands(previous: EditorCommand, next: EditorCommand): EditorCommand {
  return {
    ...previous,
    label: previous.label === next.label ? previous.label : 'Edit',
    after: next.after,
    updatedAt: next.updatedAt,
  }
}
