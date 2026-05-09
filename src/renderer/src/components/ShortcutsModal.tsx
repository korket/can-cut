import { useState, useEffect, useRef } from 'react'
import { useShortcutsStore, formatShortcut, DEFAULT_SHORTCUTS } from '../store/useShortcutsStore'
import type { Shortcut } from '../store/useShortcutsStore'

interface Props {
  onClose: () => void
}

export default function ShortcutsModal({ onClose }: Props) {
  const { shortcuts, setShortcut, resetAll } = useShortcutsStore()
  const [recording, setRecording] = useState<string | null>(null) // shortcut id being recorded
  const [conflict, setConflict] = useState<string | null>(null)

  useEffect(() => {
    if (recording) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onClose])

  // Recording: key shortcuts
  useEffect(() => {
    if (!recording) return
    const sc = shortcuts.find(s => s.id === recording)
    if (sc?.type === 'scroll') return  // handled by wheel effect below

    function onKey(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setRecording(null); return }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return

      const incoming: Partial<Shortcut> = {
        key: e.key,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey
      }

      const taken = shortcuts.find(
        (s) => s.id !== recording && s.type !== 'scroll' &&
          s.key === incoming.key && s.ctrl === incoming.ctrl &&
          s.shift === incoming.shift && s.alt === incoming.alt
      )
      if (taken) { setConflict(`Already used by "${taken.label}"`); setRecording(null); return }

      setConflict(null)
      setShortcut(recording, incoming)
      setRecording(null)
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, shortcuts])

  // Recording: scroll shortcuts
  useEffect(() => {
    if (!recording) return
    const sc = shortcuts.find(s => s.id === recording)
    if (sc?.type !== 'scroll') return

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      e.stopPropagation()
      const incoming: Partial<Shortcut> = {
        key: 'Scroll',
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey
      }
      const taken = shortcuts.find(
        s => s.id !== recording && s.type === 'scroll' &&
          s.ctrl === incoming.ctrl && s.shift === incoming.shift && s.alt === incoming.alt
      )
      if (taken) { setConflict(`Already used by "${taken.label}"`); setRecording(null); return }
      setConflict(null)
      setShortcut(recording, incoming)
      setRecording(null)
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); setRecording(null) }
    }

    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('keydown', onKey, true)
    }
  }, [recording, shortcuts])

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Keyboard Shortcuts</span>
          <div style={styles.headerActions}>
            <button style={styles.resetBtn} onClick={() => { resetAll(); setConflict(null) }}>Reset all</button>
            <button style={styles.closeBtn} onClick={onClose}>×</button>
          </div>
        </div>

        {conflict && <div style={styles.conflict}>{conflict}</div>}

        <div style={styles.list}>
          {shortcuts.map((sc) => (
            <ShortcutRow
              key={sc.id}
              shortcut={sc}
              isRecording={recording === sc.id}
              onStartRecord={() => { setConflict(null); setRecording(sc.id) }}
              onReset={() => {
                const def = DEFAULT_SHORTCUTS.find((d) => d.id === sc.id)!
                setShortcut(sc.id, { key: def.key, ctrl: def.ctrl, shift: def.shift, alt: def.alt })
              }}
            />
          ))}
        </div>

        <div style={styles.hint}>Click a shortcut to rebind it. For key shortcuts, press the new combination. For scroll shortcuts, scroll with the desired modifier.</div>
      </div>
    </div>
  )
}

function ShortcutRow({
  shortcut,
  isRecording,
  onStartRecord,
  onReset
}: {
  shortcut: Shortcut
  isRecording: boolean
  onStartRecord: () => void
  onReset: () => void
}) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{shortcut.label}</span>
      <button
        style={{ ...styles.keyBadge, ...(isRecording ? styles.keyBadgeRecording : {}) }}
        onClick={onStartRecord}
        title="Click to rebind"
      >
        {isRecording
          ? (shortcut.type === 'scroll' ? 'Scroll now…' : 'Press keys…')
          : formatShortcut(shortcut)}
      </button>
      <button style={styles.rowReset} onClick={onReset} title="Reset to default">↺</button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 12, width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 },
  title: { fontSize: 17, fontWeight: 700, color: '#fff' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 10 },
  resetBtn: { background: '#2a2a2a', border: '1px solid #444', color: '#aaa', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  closeBtn: { background: 'none', border: 'none', color: '#888', fontSize: 24, cursor: 'pointer', lineHeight: 1 },
  conflict: { background: '#3a1a1a', color: '#f88', fontSize: 13, padding: '8px 24px', flexShrink: 0 },
  list: { overflowY: 'auto', flex: 1, padding: '10px 0' },
  row: { display: 'flex', alignItems: 'center', padding: '9px 24px', gap: 14 },
  rowLabel: { flex: 1, fontSize: 14, color: '#ccc' },
  keyBadge: {
    background: '#2a2a2a', border: '1px solid #444', color: '#fff',
    padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
    fontFamily: 'monospace', minWidth: 100, textAlign: 'center'
  },
  keyBadgeRecording: { background: '#1a3a5a', borderColor: '#4a9fd4', color: '#7cf', animation: 'none' },
  rowReset: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 17, padding: '0 4px' },
  hint: { fontSize: 13, color: '#555', padding: '12px 24px', borderTop: '1px solid #2a2a2a', flexShrink: 0 }
}
