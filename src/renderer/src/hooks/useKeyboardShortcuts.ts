import { useEffect } from 'react'
import { useEditorStore } from '../store/useEditorStore'
import { useHistoryStore } from '../store/useHistoryStore'
import { useShortcutsStore, matchesShortcut } from '../store/useShortcutsStore'
import { nanoid } from '../utils/nanoid'
import { frameDurationMs, snapToFrame } from '../utils/frame'

export function useKeyboardShortcuts(onExport: () => void) {
  const shortcuts = useShortcutsStore((s) => s.shortcuts)

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      // Don't fire when typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const sc = (id: string) => shortcuts.find((s) => s.id === id)!
      const store = useEditorStore.getState()

      // Undo / redo (always handled regardless of shortcut config)
      if (e.ctrlKey && !e.altKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); useHistoryStore.getState().undo(); return
      }
      if (e.ctrlKey && !e.altKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault(); useHistoryStore.getState().redo(); return
      }

      if (matchesShortcut(e, sc('play_pause'))) {
        e.preventDefault()
        if (store.timelineItems.length > 0) store.setIsPlaying(!store.isPlaying)

      } else if (matchesShortcut(e, sc('step_back'))) {
        e.preventDefault()
        store.setIsPlaying(false)
        store.setCurrentTime(Math.max(0, snapToFrame(store.currentTime - frameDurationMs(store.fps), store.fps)))

      } else if (matchesShortcut(e, sc('step_forward'))) {
        e.preventDefault()
        store.setIsPlaying(false)
        store.setCurrentTime(Math.min(store.getTimelineDuration(), snapToFrame(store.currentTime + frameDurationMs(store.fps), store.fps)))

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
        const { timelineItems, currentTime, selectedId, updateTimelineItem, addTimelineItem } = useEditorStore.getState()
        const targets = selectedId
          ? timelineItems.filter(i => i.id === selectedId)
          : [...timelineItems]
        for (const item of targets) {
          const itemEnd = item.startTime + (item.trimEnd - item.trimStart)
          if (currentTime <= item.startTime + 50 || currentTime >= itemEnd - 50) continue
          const splitSource = item.trimStart + (currentTime - item.startTime)

          // Split Ken Burns: each half covers only its portion of the animation at the same speed.
          // Without this, the left half's duration shrinks but its KB still spans start→end, doubling its speed.
          let leftKenBurns = item.kenBurns
          let rightKenBurns = item.kenBurns
          if (item.kenBurns) {
            const kb = item.kenBurns
            const origDur = item.trimEnd - item.trimStart
            const pSplit = origDur > 0 ? (splitSource - item.trimStart) / origDur : 0
            const midScale = kb.startScale + (kb.endScale - kb.startScale) * pSplit
            const midX     = kb.startX + (kb.endX - kb.startX) * pSplit
            const midY     = kb.startY + (kb.endY - kb.startY) * pSplit
            leftKenBurns  = { ...kb, endScale: midScale, endX: midX, endY: midY }
            rightKenBurns = { ...kb, startScale: midScale, startX: midX, startY: midY }
          }

          addTimelineItem({
            ...item,
            id: nanoid(),
            startTime: currentTime,
            trimStart: splitSource,
            trimEnd: item.trimEnd,
            transitionIn: undefined,
            kenBurns: rightKenBurns,
          })
          updateTimelineItem(item.id, { trimEnd: splitSource, kenBurns: leftKenBurns })
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
