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
    if (!recording) return

    function onKey(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()

      // Escape cancels recording
      if (e.key === 'Escape') { setRecording(null); return }

      // Ignore bare modifiers
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return

      const incoming: Partial<Shortcut> = {
        key: e.key,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey
      }

      // Check for conflict
      const taken = shortcuts.find(
        (sc) =>
          sc.id !== recording &&
          sc.key === incoming.key &&
          sc.ctrl === incoming.ctrl &&
          sc.shift === incoming.shift &&
          sc.alt === incoming.alt
      )

      if (taken) {
        setConflict(`Already used by "${taken.label}"`)
        setRecording(null)
        return
      }

      setConflict(null)
      setShortcut(recording, incoming)
      setRecording(null)
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
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

        <div style={styles.hint}>Click a shortcut to rebind it, then press the new key combination.</div>
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
        {isRecording ? 'Press keys…' : formatShortcut(shortcut)}
      </button>
      <button style={styles.rowReset} onClick={onReset} title="Reset to default">↺</button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 10, width: 460, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 },
  title: { fontSize: 15, fontWeight: 700, color: '#fff' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8 },
  resetBtn: { background: '#2a2a2a', border: '1px solid #444', color: '#aaa', padding: '4px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  closeBtn: { background: 'none', border: 'none', color: '#888', fontSize: 20, cursor: 'pointer', lineHeight: 1 },
  conflict: { background: '#3a1a1a', color: '#f88', fontSize: 12, padding: '6px 20px', flexShrink: 0 },
  list: { overflowY: 'auto', flex: 1, padding: '8px 0' },
  row: { display: 'flex', alignItems: 'center', padding: '7px 20px', gap: 12 },
  rowLabel: { flex: 1, fontSize: 13, color: '#ccc' },
  keyBadge: {
    background: '#2a2a2a', border: '1px solid #444', color: '#fff',
    padding: '4px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12,
    fontFamily: 'monospace', minWidth: 90, textAlign: 'center'
  },
  keyBadgeRecording: { background: '#1a3a5a', borderColor: '#4a9fd4', color: '#7cf', animation: 'none' },
  rowReset: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 15, padding: '0 4px' },
  hint: { fontSize: 11, color: '#555', padding: '10px 20px', borderTop: '1px solid #2a2a2a', flexShrink: 0 }
}
