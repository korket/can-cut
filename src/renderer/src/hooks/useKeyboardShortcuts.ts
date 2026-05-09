import { useEffect } from 'react'
import { useEditorStore } from '../store/useEditorStore'
import { useShortcutsStore, matchesShortcut } from '../store/useShortcutsStore'
import { nanoid } from '../utils/nanoid'

export function useKeyboardShortcuts(onExport: () => void) {
  const shortcuts = useShortcutsStore((s) => s.shortcuts)

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      // Don't fire when typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const sc = (id: string) => shortcuts.find((s) => s.id === id)!
      const store = useEditorStore.getState()

      if (matchesShortcut(e, sc('play_pause'))) {
        e.preventDefault()
        if (store.timelineItems.length > 0) store.setIsPlaying(!store.isPlaying)

      } else if (matchesShortcut(e, sc('step_back'))) {
        e.preventDefault()
        store.setIsPlaying(false)
        store.setCurrentTime(Math.max(0, store.currentTime - 100))

      } else if (matchesShortcut(e, sc('step_forward'))) {
        e.preventDefault()
        store.setIsPlaying(false)
        store.setCurrentTime(Math.min(store.getTimelineDuration(), store.currentTime + 100))

      } else if (matchesShortcut(e, sc('jump_back'))) {
        e.preventDefault()
        store.setIsPlaying(false)
        store.setCurrentTime(Math.max(0, store.currentTime - 5000))

      } else if (matchesShortcut(e, sc('jump_forward'))) {
        e.preventDefault()
        store.setIsPlaying(false)
        store.setCurrentTime(Math.min(store.getTimelineDuration(), store.currentTime + 5000))

      } else if (matchesShortcut(e, sc('tool_select'))) {
        e.preventDefault()
        store.setTool('select')

      } else if (matchesShortcut(e, sc('tool_split'))) {
        e.preventDefault()
        const { timelineItems, currentTime, updateTimelineItem, addTimelineItem } = useEditorStore.getState()
        for (const item of [...timelineItems]) {
          const itemEnd = item.startTime + (item.trimEnd - item.trimStart)
          if (currentTime <= item.startTime + 50 || currentTime >= itemEnd - 50) continue
          const splitSource = item.trimStart + (currentTime - item.startTime)
          addTimelineItem({
            id: nanoid(),
            clipId: item.clipId,
            trackIndex: item.trackIndex,
            startTime: currentTime,
            trimStart: splitSource,
            trimEnd: item.trimEnd
          })
          updateTimelineItem(item.id, { trimEnd: splitSource })
        }

      } else if (matchesShortcut(e, sc('tool_text'))) {
        e.preventDefault()
        store.setTool('text')

      } else if (matchesShortcut(e, sc('delete'))) {
        e.preventDefault()
        if (store.selectedId) {
          store.removeTimelineItem(store.selectedId)
          store.removeTextOverlay(store.selectedId)
          store.setSelectedId(null)
        }

      } else if (matchesShortcut(e, sc('zoom_in'))) {
        e.preventDefault()
        store.setZoom(store.zoom + 20)

      } else if (matchesShortcut(e, sc('zoom_out'))) {
        e.preventDefault()
        store.setZoom(store.zoom - 20)

      } else if (matchesShortcut(e, sc('export'))) {
        e.preventDefault()
        onExport()
      }
    }

    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [shortcuts, onExport])
}
