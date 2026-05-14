import { create } from 'zustand'
import type { EditableDocumentState, EditorCommand } from '../editor-core/commands'
import { mergeEditorCommands } from '../editor-core/commands'

const MAX = 50
const MERGE_WINDOW_MS = 300

let applyEditableState: ((state: EditableDocumentState) => void) | null = null

export function registerHistoryApplier(applier: (state: EditableDocumentState) => void) {
  applyEditableState = applier
}

interface HistoryStore {
  past: EditorCommand[]
  future: EditorCommand[]
  isApplying: boolean
  record: (command: EditorCommand) => void
  undo: () => void
  redo: () => void
  clear: () => void
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],
  isApplying: false,

  record: (command) => {
    if (get().isApplying) return

    set((s) => {
      const previous = s.past[s.past.length - 1]
      const shouldMerge =
        previous &&
        command.updatedAt - previous.updatedAt <= MERGE_WINDOW_MS

      const past = shouldMerge
        ? [...s.past.slice(0, -1), mergeEditorCommands(previous, command)]
        : [...s.past.slice(-(MAX - 1)), command]

      return { past, future: [] }
    })
  },

  undo: () => {
    const { past, future, isApplying } = get()
    if (!past.length || isApplying || !applyEditableState) return

    const command = past[past.length - 1]
    set({ past: past.slice(0, -1), future: [command, ...future.slice(0, MAX - 1)], isApplying: true })
    applyEditableState(command.before)
    set({ isApplying: false })
  },

  redo: () => {
    const { past, future, isApplying } = get()
    if (!future.length || isApplying || !applyEditableState) return

    const command = future[0]
    set({ past: [...past.slice(-(MAX - 1)), command], future: future.slice(1), isApplying: true })
    applyEditableState(command.after)
    set({ isApplying: false })
  },

  clear: () => set({ past: [], future: [], isApplying: false }),
}))
