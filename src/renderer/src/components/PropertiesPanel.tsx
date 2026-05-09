import { useEditorStore } from '../store/useEditorStore'
import type { TextOverlay } from '../types'
import { nanoid } from '../utils/nanoid'

export default function PropertiesPanel() {
  const { selectedId, timelineItems, textOverlays, updateTimelineItem, updateTextOverlay, removeTextOverlay, clips, currentTime, addTextOverlay, tool } = useEditorStore()

  const selectedTimelineItem = timelineItems.find((i) => i.id === selectedId)
  const selectedOverlay = textOverlays.find((o) => o.id === selectedId)

  function addText() {
    const overlay: TextOverlay = {
      id: nanoid(),
      text: 'Sample Text',
      fontFamily: 'sans-serif',
      fontSize: 36,
      color: '#ffffff',
      x: 100,
      y: 80,
      startTime: currentTime,
      endTime: currentTime + 3000,
      bold: false,
      italic: false
    }
    addTextOverlay(overlay)
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>Properties</div>

      {/* Text tool actions */}
      {tool === 'text' && (
        <div style={styles.section}>
          <button style={styles.addTextBtn} onClick={addText}>+ Add Text</button>
        </div>
      )}

      {/* Text overlay properties */}
      {selectedOverlay && <TextProps overlay={selectedOverlay} update={(c) => updateTextOverlay(selectedOverlay.id, c)} onDelete={() => removeTextOverlay(selectedOverlay.id)} />}

      {/* Timeline item properties */}
      {selectedTimelineItem && (() => {
        const clip = clips.find(c => c.id === selectedTimelineItem.clipId)
        return clip ? <ClipProps item={selectedTimelineItem} clip={clip} update={(c) => updateTimelineItem(selectedTimelineItem.id, c)} /> : null
      })()}

      {!selectedOverlay && !selectedTimelineItem && tool !== 'text' && (
        <div style={styles.empty}>Select an item to edit its properties</div>
      )}

      {/* Text overlays list */}
      {textOverlays.length > 0 && <TextList />}
    </div>
  )
}

function TextList() {
  const { textOverlays, setSelectedId, selectedId, removeTextOverlay } = useEditorStore()
  return (
    <div style={{ marginTop: 12 }}>
      <div style={styles.sectionTitle}>Text Layers</div>
      {textOverlays.map((o) => (
        <div key={o.id} style={{ ...styles.overlayRow, background: selectedId === o.id ? '#2a2a2a' : 'transparent' }} onClick={() => setSelectedId(o.id)}>
          <span style={styles.overlayText}>{o.text.slice(0, 20)}</span>
          <button style={styles.smallBtn} onClick={(e) => { e.stopPropagation(); removeTextOverlay(o.id) }}>×</button>
        </div>
      ))}
    </div>
  )
}

function TextProps({ overlay, update, onDelete }: { overlay: TextOverlay; update: (c: Partial<TextOverlay>) => void; onDelete: () => void }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>Text</div>
      <label style={styles.label}>Content</label>
      <textarea style={styles.textarea} value={overlay.text} onChange={(e) => update({ text: e.target.value })} rows={2} />

      <label style={styles.label}>Font Size</label>
      <input type="range" min={12} max={120} value={overlay.fontSize} onChange={(e) => update({ fontSize: +e.target.value })} style={styles.range} />
      <span style={styles.value}>{overlay.fontSize}px</span>

      <label style={styles.label}>Color</label>
      <input type="color" value={overlay.color} onChange={(e) => update({ color: e.target.value })} style={styles.colorPicker} />

      <div style={styles.row}>
        <label style={styles.label}>Bold</label>
        <input type="checkbox" checked={overlay.bold} onChange={(e) => update({ bold: e.target.checked })} />
      </div>
      <div style={styles.row}>
        <label style={styles.label}>Italic</label>
        <input type="checkbox" checked={overlay.italic} onChange={(e) => update({ italic: e.target.checked })} />
      </div>

      <label style={styles.label}>Position X</label>
      <input type="number" value={overlay.x} onChange={(e) => update({ x: +e.target.value })} style={styles.input} />
      <label style={styles.label}>Position Y</label>
      <input type="number" value={overlay.y} onChange={(e) => update({ y: +e.target.value })} style={styles.input} />

      <label style={styles.label}>Start (ms)</label>
      <input type="number" value={overlay.startTime} onChange={(e) => update({ startTime: +e.target.value })} style={styles.input} />
      <label style={styles.label}>End (ms)</label>
      <input type="number" value={overlay.endTime} onChange={(e) => update({ endTime: +e.target.value })} style={styles.input} />

      <button style={styles.deleteBtn} onClick={onDelete}>Delete Text</button>
    </div>
  )
}

function ClipProps({ item, clip, update }: { item: import('../types').TimelineItem; clip: import('../types').MediaClip; update: (c: Partial<import('../types').TimelineItem>) => void }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>Clip: {clip.name}</div>
      <label style={styles.label}>Trim Start (ms)</label>
      <input type="number" value={item.trimStart} min={0} max={item.trimEnd - 1} onChange={(e) => update({ trimStart: +e.target.value })} style={styles.input} />
      <label style={styles.label}>Trim End (ms)</label>
      <input type="number" value={item.trimEnd} min={item.trimStart + 1} max={clip.duration} onChange={(e) => update({ trimEnd: +e.target.value })} style={styles.input} />
      <div style={styles.info}>Duration: {((item.trimEnd - item.trimStart) / 1000).toFixed(2)}s</div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: { display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', background: '#181818', padding: '0 0 16px 0' },
  header: { fontSize: 13, fontWeight: 600, color: '#ccc', padding: '10px 12px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 },
  section: { padding: '10px 12px', borderBottom: '1px solid #222', display: 'flex', flexDirection: 'column', gap: 6 },
  sectionTitle: { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, padding: '6px 12px 0' },
  label: { fontSize: 12, color: '#aaa' },
  input: { background: '#222', border: '1px solid #333', color: '#fff', borderRadius: 4, padding: '3px 6px', fontSize: 12 },
  textarea: { background: '#222', border: '1px solid #333', color: '#fff', borderRadius: 4, padding: '4px 6px', fontSize: 12, resize: 'vertical' },
  range: { width: '100%', accentColor: '#e63950' },
  value: { fontSize: 11, color: '#666' },
  colorPicker: { width: 40, height: 24, border: 'none', background: 'none', cursor: 'pointer', padding: 0 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  deleteBtn: { background: '#3a1a1a', border: '1px solid #5a2a2a', color: '#f66', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginTop: 4 },
  addTextBtn: { background: '#1a3a1a', border: '1px solid #2abf5a', color: '#6cf87c', padding: '6px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 13, fontWeight: 600, width: '100%' },
  empty: { fontSize: 12, color: '#444', textAlign: 'center', padding: '20px 12px' },
  info: { fontSize: 11, color: '#666' },
  overlayRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px', cursor: 'pointer', borderRadius: 4, margin: '0 4px' },
  overlayText: { fontSize: 12, color: '#ccc' },
  smallBtn: { background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14 }
}
