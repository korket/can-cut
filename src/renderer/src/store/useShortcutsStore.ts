import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Shortcut {
  id: string
  label: string
  key: string        // e.g. 'Space', 'ArrowLeft', 's'
  ctrl: boolean
  shift: boolean
  alt: boolean
}

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: 'play_pause',     label: 'Play / Pause',        key: 'Space',      ctrl: false, shift: false, alt: false },
  { id: 'step_back',      label: 'Step Back (100ms)',    key: 'ArrowLeft',  ctrl: false, shift: false, alt: false },
  { id: 'step_forward',   label: 'Step Forward (100ms)', key: 'ArrowRight', ctrl: false, shift: false, alt: false },
  { id: 'jump_back',      label: 'Jump Back 5s',         key: 'ArrowLeft',  ctrl: false, shift: true,  alt: false },
  { id: 'jump_forward',   label: 'Jump Forward 5s',      key: 'ArrowRight', ctrl: false, shift: true,  alt: false },
  { id: 'tool_select',    label: 'Select Tool',          key: 'v',          ctrl: false, shift: false, alt: false },
  { id: 'tool_split',     label: 'Split at Playhead',    key: 'c',          ctrl: false, shift: false, alt: false },
  { id: 'tool_text',      label: 'Text Tool',            key: 't',          ctrl: false, shift: false, alt: false },
  { id: 'delete',         label: 'Delete Selected',      key: 'Delete',     ctrl: false, shift: false, alt: false },
  { id: 'zoom_in',        label: 'Timeline Zoom In',     key: '=',          ctrl: false, shift: false, alt: false },
  { id: 'zoom_out',       label: 'Timeline Zoom Out',    key: '-',          ctrl: false, shift: false, alt: false },
  { id: 'export',         label: 'Export',               key: 'e',          ctrl: true,  shift: false, alt: false },
]

interface ShortcutsStore {
  shortcuts: Shortcut[]
  setShortcut: (id: string, shortcut: Partial<Shortcut>) => void
  resetAll: () => void
}

export const useShortcutsStore = create<ShortcutsStore>()(
  persist(
    (set) => ({
      shortcuts: DEFAULT_SHORTCUTS,
      setShortcut: (id, changes) =>
        set((s) => ({
          shortcuts: s.shortcuts.map((sc) => (sc.id === id ? { ...sc, ...changes } : sc))
        })),
      resetAll: () => set({ shortcuts: DEFAULT_SHORTCUTS })
    }),
    { name: 'can-cut-shortcuts' }
  )
)

export function formatShortcut(sc: Shortcut): string {
  const parts: string[] = []
  if (sc.ctrl)  parts.push('Ctrl')
  if (sc.shift) parts.push('Shift')
  if (sc.alt)   parts.push('Alt')
  parts.push(sc.key === 'Space' ? 'Space' : sc.key === 'Delete' ? 'Del' : sc.key.toUpperCase())
  return parts.join('+')
}

export function matchesShortcut(e: KeyboardEvent, sc: Shortcut): boolean {
  return (
    e.key === sc.key &&
    e.ctrlKey  === sc.ctrl  &&
    e.shiftKey === sc.shift &&
    e.altKey   === sc.alt
  )
}
