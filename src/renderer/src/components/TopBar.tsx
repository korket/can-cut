import { useEditorStore } from '../store/useEditorStore'
import { useHistoryStore } from '../store/useHistoryStore'
import { useShortcutsStore, formatShortcut } from '../store/useShortcutsStore'
import type { Tool } from '../types'

interface Props {
  onExport: () => void
  onShortcuts: () => void
  onVersions: () => void
  onBack: () => void
  projectName: string
}

const tools: { id: Tool; label: string; icon: string; shortcutId: string }[] = [
  { id: 'select', label: 'Select', icon: '↖', shortcutId: 'tool_select' },
  { id: 'text',   label: 'Text',   icon: 'T', shortcutId: 'tool_text'   }
]

const FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]

export default function TopBar({ onExport, onShortcuts, onVersions, onBack, projectName }: Props) {
  const { tool, setTool, fps, setFps } = useEditorStore()
  const shortcuts = useShortcutsStore((s) => s.shortcuts)
  const sc = (id: string) => shortcuts.find((s) => s.id === id)
  const canUndo = useHistoryStore((s) => s.past.length > 0)
  const canRedo = useHistoryStore((s) => s.future.length > 0)
  const { undo, redo } = useHistoryStore()

  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        <button style={styles.backBtn} onClick={onBack} title="Back to projects">
          ‹
        </button>
        <span style={styles.projectName}>{projectName}</span>
      </div>
      <div style={styles.undoRedo}>
        <button style={{ ...styles.undoRedoBtn, opacity: canUndo ? 1 : 0.3 }} disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">⟲</button>
        <button style={{ ...styles.undoRedoBtn, opacity: canRedo ? 1 : 0.3 }} disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">⟳</button>
      </div>
      <div style={styles.tools}>
        {tools.map((t) => {
          const shortcut = sc(t.shortcutId)
          return (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              style={{ ...styles.toolBtn, ...(tool === t.id ? styles.toolActive : {}) }}
              title={shortcut ? formatShortcut(shortcut) : t.label}
            >
              <span style={styles.toolIcon}>{t.icon}</span>
              <span style={styles.toolLabel}>{t.label}</span>
            </button>
          )
        })}
      </div>
      <div style={styles.right}>
        <select
          value={fps}
          onChange={e => setFps(Number(e.target.value))}
          style={styles.fpsSelect}
          title="Project frame rate"
        >
          {FPS_OPTIONS.map(f => (
            <option key={f} value={f}>{f} fps</option>
          ))}
        </select>
        <button style={styles.shortcutsBtn} onClick={onVersions}>Versions</button>
        <button style={styles.shortcutsBtn} onClick={onShortcuts}>Shortcuts</button>
        <button style={styles.exportBtn} onClick={onExport} title={sc('export') ? formatShortcut(sc('export')!) : 'Export'}>
          Export
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    height: 54, background: '#111', borderBottom: '1px solid #2a2a2a',
    display: 'flex', alignItems: 'center', paddingLeft: 10, paddingRight: 150,
    gap: 14, WebkitAppRegion: 'drag' as never, flexShrink: 0,
  },
  left:        { flex: 1, display: 'flex', alignItems: 'center', gap: 10, WebkitAppRegion: 'no-drag' as never },
  backBtn:     { background: 'none', border: 'none', color: '#888', fontSize: 30, cursor: 'pointer', lineHeight: 1, padding: '0 4px', marginTop: -2 },
  projectName: { fontSize: 15, color: '#ccc', fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  undoRedo:    { display: 'flex', gap: 2, WebkitAppRegion: 'no-drag' as never },
  undoRedoBtn: { background: 'none', border: 'none', color: '#ccc', fontSize: 20, cursor: 'pointer', padding: '4px 7px', borderRadius: 5, lineHeight: 1, transition: 'opacity 0.15s' },
  tools:       { display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' as never },
  toolBtn:     { background: 'transparent', border: 'none', color: '#aaa', padding: '6px 13px', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 },
  toolActive:  { background: '#2a2a2a', color: '#fff' },
  toolIcon:    { fontSize: 17 },
  toolLabel:   {},
  right:       { flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, WebkitAppRegion: 'no-drag' as never },
  fpsSelect:   { background: '#2a2a2a', border: '1px solid #444', color: '#ccc', padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13, outline: 'none' },
  shortcutsBtn:{ background: '#2a2a2a', border: '1px solid #444', color: '#ccc', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  exportBtn:   { background: '#e63950', border: 'none', color: '#fff', padding: '7px 22px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
}
