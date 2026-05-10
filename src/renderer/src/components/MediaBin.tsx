import { useState } from 'react'
import { useEditorStore } from '../store/useEditorStore'
import type { MediaClip, MediaFolder, TimelineItem } from '../types'
import { nanoid } from '../utils/nanoid'
import { importAndAddClips } from '../utils/importClip'


function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export default function MediaBin() {
  const {
    clips, addClip, removeClip, addTimelineItem, getTimelineDuration, videoTrackCount,
    folders, addFolder, removeFolder, renameFolder, moveClipToFolder,
  } = useEditorStore()

  const [draggingOver, setDraggingOver]       = useState(false)
  const [importing, setImporting]             = useState(false)
  const [solidColor, setSolidColor]           = useState('#000000')
  const [expanded, setExpanded]               = useState<Set<string>>(() => new Set(folders.map(f => f.id)))
  const [editingId, setEditingId]             = useState<string | null>(null)
  const [editingName, setEditingName]         = useState('')
  const [folderDragOver, setFolderDragOver]   = useState<string | null>(null)

  async function handleImport() {
    const paths = await window.api.openFiles()
    if (!paths.length) return
    setImporting(true)
    await importAndAddClips(paths)
    setImporting(false)
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDraggingOver(false)
    const paths = Array.from(e.dataTransfer.files).map((f) => (f as any).path as string)
    if (!paths.length) return
    setImporting(true)
    await importAndAddClips(paths)
    setImporting(false)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDraggingOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDraggingOver(false)
  }

  function addToTimeline(clip: MediaClip) {
    const startTime = getTimelineDuration()
    const item: TimelineItem = {
      id: nanoid(), clipId: clip.id,
      trackIndex: clip.type === 'audio' ? videoTrackCount : 0,
      startTime, trimStart: 0, trimEnd: clip.duration,
    }
    addTimelineItem(item)
  }

  function addSolidColor() {
    addClip({
      id: nanoid(), name: `Solid ${solidColor.toUpperCase()}`,
      path: '', duration: 3_600_000, width: 1920, height: 1080,
      fps: 30, type: 'solid', color: solidColor,
    })
  }

  function createFolder() {
    const id = nanoid()
    addFolder({ id, name: 'New Folder' })
    setExpanded(prev => new Set([...prev, id]))
    setEditingId(id)
    setEditingName('New Folder')
  }

  function toggleFolder(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function commitRename(id: string) {
    renameFolder(id, editingName.trim() || 'Folder')
    setEditingId(null)
  }

  function handleFolderDrop(e: React.DragEvent, folderId: string) {
    e.preventDefault()
    e.stopPropagation()
    setFolderDragOver(null)
    const clipId = e.dataTransfer.getData('text/x-clip-id')
    if (clipId) moveClipToFolder(clipId, folderId)
  }

  function handleFolderDragOver(e: React.DragEvent, folderId: string) {
    if (!e.dataTransfer.types.includes('text/x-clip-id')) return
    e.preventDefault()
    e.stopPropagation()
    setFolderDragOver(folderId)
  }

  function handleFolderDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setFolderDragOver(null)
  }

  const unfoldered = clips.filter(c => !c.folderId)

  return (
    <div
      style={styles.bin}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>Media</span>
        <div style={styles.headerBtns}>
          <button style={styles.headerBtn} onClick={createFolder}>+ Folder</button>
          <button style={styles.headerBtn} onClick={handleImport}>+ Import</button>
        </div>
      </div>

      {/* Solid color row */}
      <div style={styles.solidRow}>
        <input type="color" value={solidColor} onChange={e => setSolidColor(e.target.value)}
          style={styles.solidSwatch} title="Pick solid color" />
        <span style={styles.solidLabel}>{solidColor.toUpperCase()}</span>
        <button style={styles.solidBtn} onClick={addSolidColor}>+ Solid Color</button>
      </div>

      {/* Scrollable content */}
      <div style={{ ...styles.content, ...(draggingOver ? styles.contentDragging : {}) }}>
        {draggingOver && (
          <div style={styles.dropOverlay}>
            <div style={styles.dropIcon}>+</div>
            <div style={styles.dropText}>Drop media here</div>
          </div>
        )}
        {importing && <div style={styles.importing}>Importing…</div>}

        {!draggingOver && clips.length === 0 && folders.length === 0 && !importing && (
          <div style={styles.empty} onClick={handleImport}>
            <div style={styles.emptyIcon}>▶</div>
            <div style={styles.emptyText}>Click to import</div>
            <div style={styles.emptySubtext}>or drag files here</div>
          </div>
        )}

        {/* Folders */}
        {folders.map(folder => {
          const folderClips = clips.filter(c => c.folderId === folder.id)
          const isOpen = expanded.has(folder.id)
          const isDragTarget = folderDragOver === folder.id
          return (
            <div key={folder.id} style={styles.folderSection}>
              {/* Folder header */}
              <div
                style={{ ...styles.folderHeader, ...(isDragTarget ? styles.folderHeaderOver : {}) }}
                onDrop={e => handleFolderDrop(e, folder.id)}
                onDragOver={e => handleFolderDragOver(e, folder.id)}
                onDragLeave={handleFolderDragLeave}
              >
                <button style={styles.toggleBtn} onClick={() => toggleFolder(folder.id)}>
                  {isOpen ? '▾' : '▸'}
                </button>
                {editingId === folder.id ? (
                  <input
                    style={styles.nameInput}
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onBlur={() => commitRename(folder.id)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(folder.id); if (e.key === 'Escape') setEditingId(null) }}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span
                    style={styles.folderName}
                    onDoubleClick={() => { setEditingId(folder.id); setEditingName(folder.name) }}
                    onClick={() => toggleFolder(folder.id)}
                  >
                    {folder.name}
                  </span>
                )}
                <span style={styles.folderCount}>{folderClips.length}</span>
                <button style={styles.folderRename} onClick={e => { e.stopPropagation(); setEditingId(folder.id); setEditingName(folder.name) }} title="Rename folder">✎</button>
                <button style={styles.folderDel} onClick={() => removeFolder(folder.id)}>×</button>
              </div>

              {/* Folder contents */}
              {isOpen && (
                <div style={styles.folderGrid}>
                  {folderClips.length === 0
                    ? <div style={styles.folderEmpty}>Drag clips here</div>
                    : folderClips.map(clip => (
                        <ClipCard key={clip.id} clip={clip} onAdd={() => addToTimeline(clip)} onRemove={() => removeClip(clip.id)} />
                      ))
                  }
                </div>
              )}
            </div>
          )
        })}

        {/* Unfoldered clips */}
        {unfoldered.length > 0 && (
          <div style={styles.grid}>
            {unfoldered.map(clip => (
              <ClipCard key={clip.id} clip={clip} onAdd={() => addToTimeline(clip)} onRemove={() => removeClip(clip.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ClipCard({ clip, onAdd, onRemove }: { clip: MediaClip; onAdd: () => void; onRemove: () => void }) {
  return (
    <div
      style={styles.card}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/x-clip-id', clip.id)
        e.dataTransfer.setData('text/x-clip-type', clip.type)
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <div style={styles.thumb} onDoubleClick={onAdd} title="Double-click to add to timeline">
        {clip.type === 'solid'
          ? <div style={{ width: '100%', height: '100%', background: clip.color ?? '#000' }} />
          : clip.thumbnail
            ? <img src={clip.thumbnail} style={styles.thumbImg} />
            : <div style={styles.thumbPlaceholder}>{clip.type === 'audio' ? '♫' : '▶'}</div>
        }
        {clip.type !== 'solid' && <div style={styles.duration}>{formatDuration(clip.duration)}</div>}
      </div>
      <div style={styles.clipInfo}>
        <div style={styles.clipName} title={clip.name}>{clip.name}</div>
        <div style={styles.clipActions}>
          <button style={styles.addBtn} onClick={onAdd}>+</button>
          <button style={styles.delBtn} onClick={onRemove}>×</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bin:             { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  header:          { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 },
  title:           { fontSize: 15, fontWeight: 600, color: '#ccc' },
  headerBtns:      { display: 'flex', gap: 8 },
  headerBtn:       { background: '#2a2a2a', border: 'none', color: '#ddd', padding: '5px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 13 },

  solidRow:   { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 },
  solidSwatch:{ width: 26, height: 26, padding: 0, border: '1px solid #444', borderRadius: 4, cursor: 'pointer', background: 'none' },
  solidLabel: { fontSize: 12, color: '#666', fontFamily: 'monospace', flex: 1 },
  solidBtn:   { background: '#2a2a2a', border: 'none', color: '#ddd', padding: '4px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12 },

  content:         { flex: 1, overflowY: 'auto', padding: 10, position: 'relative', transition: 'background 0.15s' },
  contentDragging: { background: 'rgba(42,191,90,0.06)', outline: '2px dashed #2abf5a', outlineOffset: -4 },
  dropOverlay:     { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, pointerEvents: 'none', zIndex: 10 },
  dropIcon:        { fontSize: 48, color: '#2abf5a', lineHeight: 1 },
  dropText:        { fontSize: 16, color: '#2abf5a', fontWeight: 600 },
  importing:       { textAlign: 'center', color: '#888', fontSize: 14, padding: '24px 0' },
  empty:           { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '48px 0', cursor: 'pointer', color: '#555' },
  emptyIcon:       { fontSize: 38 },
  emptyText:       { fontSize: 14 },
  emptySubtext:    { fontSize: 13, color: '#3a3a3a' },

  // Folder
  folderSection:   { marginBottom: 6 },
  folderHeader:    { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 5, cursor: 'pointer', userSelect: 'none', background: '#1e1e1e', marginBottom: 3, transition: 'background 0.1s' },
  folderHeaderOver:{ background: 'rgba(42,191,90,0.12)', outline: '1px dashed #2abf5a' },
  toggleBtn:       { background: 'none', border: 'none', color: '#888', fontSize: 15, cursor: 'pointer', padding: 0, width: 18, flexShrink: 0 },
  folderName:      { flex: 1, fontSize: 14, color: '#ccc', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  nameInput:       { flex: 1, background: '#2a2a2a', border: '1px solid #444', color: '#fff', fontSize: 13, padding: '2px 6px', borderRadius: 3, outline: 'none' },
  folderCount:     { fontSize: 12, color: '#555', flexShrink: 0 },
  folderRename:    { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0 },
  folderDel:       { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0 },
  folderGrid:      { display: 'flex', flexWrap: 'wrap', gap: 10, padding: '6px 4px 10px 24px' },
  folderEmpty:     { fontSize: 13, color: '#444', padding: '10px 0', width: '100%', textAlign: 'center' },

  // Clips
  grid:            { display: 'flex', flexWrap: 'wrap', gap: 10, padding: '4px 0' },
  card:            { width: 130, display: 'flex', flexDirection: 'column', gap: 5 },
  thumb:           { width: 130, height: 82, background: '#222', borderRadius: 6, overflow: 'hidden', position: 'relative', cursor: 'pointer' },
  thumbImg:        { width: '100%', height: '100%', objectFit: 'cover' },
  thumbPlaceholder:{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#555' },
  duration:        { position: 'absolute', bottom: 4, right: 5, fontSize: 11, color: '#fff', background: 'rgba(0,0,0,0.7)', padding: '1px 5px', borderRadius: 3 },
  clipInfo:        { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  clipName:        { fontSize: 12, color: '#aaa', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  clipActions:     { display: 'flex', gap: 3 },
  addBtn:          { background: '#333', border: 'none', color: '#6cf', padding: '2px 6px', borderRadius: 3, cursor: 'pointer', fontSize: 14 },
  delBtn:          { background: '#333', border: 'none', color: '#f66', padding: '2px 6px', borderRadius: 3, cursor: 'pointer', fontSize: 14 },
}
