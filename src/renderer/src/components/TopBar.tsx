import { useEditorStore } from '../store/useEditorStore'
import { useShortcutsStore, formatShortcut } from '../store/useShortcutsStore'
import type { Tool } from '../types'

interface Props {
  onExport: () => void
  onShortcuts: () => void
  onBack: () => void
  projectName: string
}

const tools: { id: Tool; label: string; icon: string; shortcutId: string }[] = [
  { id: 'select', label: 'Select', icon: '↖', shortcutId: 'tool_select' },
  { id: 'text',   label: 'Text',   icon: 'T', shortcutId: 'tool_text'   }
]

export default function TopBar({ onExport, onShortcuts, onBack, projectName }: Props) {
  const { tool, setTool } = useEditorStore()
  const shortcuts = useShortcutsStore((s) => s.shortcuts)
  const sc = (id: string) => shortcuts.find((s) => s.id === id)

  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        <button style={styles.backBtn} onClick={onBack} title="Back to projects">
          ‹
        </button>
        <span style={styles.projectName}>{projectName}</span>
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
    height: 48, background: '#111', borderBottom: '1px solid #2a2a2a',
    display: 'flex', alignItems: 'center', paddingLeft: 8, paddingRight: 150,
    gap: 12, WebkitAppRegion: 'drag' as never, flexShrink: 0,
  },
  left:        { flex: 1, display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' as never },
  backBtn:     { background: 'none', border: 'none', color: '#888', fontSize: 26, cursor: 'pointer', lineHeight: 1, padding: '0 4px', marginTop: -2 },
  projectName: { fontSize: 13, color: '#ccc', fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tools:       { display: 'flex', gap: 4, WebkitAppRegion: 'no-drag' as never },
  toolBtn:     { background: 'transparent', border: 'none', color: '#aaa', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 },
  toolActive:  { background: '#2a2a2a', color: '#fff' },
  toolIcon:    { fontSize: 15 },
  toolLabel:   {},
  right:       { flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' as never },
  shortcutsBtn:{ background: '#2a2a2a', border: '1px solid #444', color: '#ccc', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  exportBtn:   { background: '#e63950', border: 'none', color: '#fff', padding: '6px 18px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 },
}
