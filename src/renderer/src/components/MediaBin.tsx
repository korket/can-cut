import { useState, useEffect, useRef } from 'react'
import { useEditorStore } from '../store/useEditorStore'
import type { MediaClip, MediaFolder, TimelineItem } from '../types'
import { nanoid } from '../utils/nanoid'
import { importAndAddClips } from '../utils/importClip'

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

type ViewMode   = 'grid' | 'list'
type TypeFilter = 'all' | 'video' | 'audio' | 'image' | 'solid'
type SortMode = 'recent' | 'name-asc' | 'name-desc' | 'type' | 'duration-desc' | 'duration-asc'
const SORT_ORDER: SortMode[] = ['name-asc', 'name-desc', 'recent', 'type', 'duration-desc', 'duration-asc']

const TYPE_BADGE: Record<string, string> = {
  video: 'VIDEO', audio: 'AUDIO', image: 'IMG', solid: 'SOLID',
}

const SORT_LABELS: Record<SortMode, string> = {
  recent: 'Newest',
  'name-asc': 'Name A-Z',
  'name-desc': 'Name Z-A',
  type: 'Type',
  'duration-desc': 'Longest',
  'duration-asc': 'Shortest',
}

function selectOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.select()
}

// ── Context menu ──────────────────────────────────────────────────────────────

interface CtxMenuProps {
  clip: MediaClip; folders: MediaFolder[]
  x: number; y: number
  onClose: () => void; onAdd: () => void
  onMoveToFolder: (id: string | null) => void; onRemove: () => void
}

function ContextMenu({ clip, folders, x, y, onClose, onAdd, onMoveToFolder, onRemove }: CtxMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const menuW = 190, menuH = 40 + folders.length * 32 + 80
  const cx = x + menuW > window.innerWidth  ? x - menuW : x
  const cy = y + menuH > window.innerHeight ? y - menuH : y

  return (
    <div ref={ref} style={{ ...s.ctx, left: cx, top: cy }}>
      <Ci label="+ Add to Timeline" onDown={onAdd} />
      {folders.length > 0 && <>
        <div style={s.ctxDiv} />
        <div style={s.ctxLbl}>Move to folder</div>
        {folders.map(f => <Ci key={f.id} label={f.name} onDown={() => onMoveToFolder(f.id)} />)}
        {clip.folderId && <Ci label="Remove from folder" onDown={() => onMoveToFolder(null)} />}
      </>}
      <div style={s.ctxDiv} />
      <Ci label="Remove" danger onDown={onRemove} />
    </div>
  )
}

function Ci({ label, onDown, danger }: { label: string; onDown: () => void; danger?: boolean }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      style={{ ...s.ctxItem, ...(hov ? s.ctxItemHov : {}), ...(danger ? s.ctxDanger : {}) }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onMouseDown={e => { e.stopPropagation(); onDown() }}
    >{label}</button>
  )
}

// ── Folder card ───────────────────────────────────────────────────────────────

function FolderCard({ folder, count, viewMode, dragOver, onClick, onDrop, onDragOver, onDragLeave }: {
  folder: MediaFolder; count: number; viewMode: ViewMode; dragOver: boolean
  onClick: () => void
  onDrop: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
}) {
  const [hov, setHov] = useState(false)
  const active = hov || dragOver

  if (viewMode === 'list') return (
    <div
      style={{ ...s.listRow, ...(active ? s.listRowHov : {}), ...(dragOver ? s.listRowDrop : {}), cursor: 'pointer' }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={onClick} onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
    >
      <div style={{ ...s.listThumb, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#555' }}>📁</div>
      <span style={{ ...s.listName, color: '#bbb', fontWeight: 600 }}>{folder.name}</span>
      <span style={s.listDur}>{count}</span>
    </div>
  )

  return (
    <div
      style={{ ...s.card, ...(dragOver ? s.cardDrop : {}) }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={onClick} onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
    >
      <div style={{ ...s.thumb, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', background: active ? '#222' : '#1a1a1a' }}>
        <span style={{ fontSize: 38, lineHeight: 1 }}>📁</span>
        <span style={{ fontSize: 9, color: '#555' }}>{count} {count === 1 ? 'item' : 'items'}</span>
      </div>
      <div style={{ ...s.cardName, color: '#bbb', fontWeight: 600 }} title={folder.name}>{folder.name}</div>
    </div>
  )
}

// ── Clip card ─────────────────────────────────────────────────────────────────

function ClipCard({ clip, viewMode, onAdd, onRemove, onCtx, onHoverEnter, onHoverLeave }: {
  clip: MediaClip; viewMode: ViewMode
  onAdd: () => void; onRemove: () => void; onCtx: (e: React.MouseEvent) => void
  onHoverEnter: () => void; onHoverLeave: () => void
}) {
  const [hov, setHov] = useState(false)

  const thumbnail = (small: boolean) => (
    <div style={small ? s.listThumb : s.thumb}>
      {clip.type === 'solid'
        ? <div style={{ width: '100%', height: '100%', background: clip.color ?? '#000' }} />
        : clip.thumbnail
          ? <img src={clip.thumbnail} style={s.thumbImg} alt="" />
          : <div style={s.thumbPh}>{clip.type === 'audio' ? '♫' : '▶'}</div>
      }
      <span style={s.badge}>{TYPE_BADGE[clip.type] ?? ''}</span>
      {!small && clip.type !== 'audio' && clip.type !== 'solid' &&
        <span style={s.durBadge}>{formatDuration(clip.duration)}</span>
      }
    </div>
  )

  const dragProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('text/x-clip-id', clip.id)
      e.dataTransfer.effectAllowed = 'copy'
    },
  }

  const hoverProps = {
    onMouseEnter: () => { setHov(true); onHoverEnter() },
    onMouseLeave: () => { setHov(false); onHoverLeave() },
  }

  if (viewMode === 'list') return (
    <div {...dragProps} {...hoverProps}
      style={{ ...s.listRow, ...(hov ? s.listRowHov : {}) }}
      onDoubleClick={onAdd} onContextMenu={onCtx}
    >
      {thumbnail(true)}
      <span style={s.listName} title={clip.name}>{clip.name}</span>
      <span style={s.listDur}>{formatDuration(clip.duration)}</span>
      {hov && <button style={s.listDel} onClick={e => { e.stopPropagation(); onRemove() }}>×</button>}
    </div>
  )

  return (
    <div {...dragProps} {...hoverProps} style={s.card} onContextMenu={onCtx}>
      {thumbnail(false)}
      <div style={s.cardName} title={clip.name}>{clip.name}</div>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function SidebarItem({ label, count, selected, isFolder, dragOver, editing, editName,
  onClick, onDblClick, onDelete, onDrop, onDragOver, onDragLeave,
  onEditChange, onEditBlur, onEditKey,
}: {
  label: string; count: number; selected: boolean; isFolder: boolean
  dragOver: boolean; editing: boolean; editName: string
  onClick: () => void; onDblClick: () => void; onDelete?: () => void
  onDrop: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void; onDragLeave: (e: React.DragEvent) => void
  onEditChange: (v: string) => void; onEditBlur: () => void; onEditKey: (e: React.KeyboardEvent) => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <div
      style={{ ...s.sideItem, ...(selected ? s.sideItemOn : {}), ...(dragOver ? s.sideItemDrop : {}) }}
      onClick={onClick} onDoubleClick={onDblClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
    >
      <span style={s.sideIcon}>{isFolder ? '▸' : '⊟'}</span>
      {editing ? (
        <input
          style={s.sideInput}
          value={editName} autoFocus
          onFocus={selectOnFocus}
          onChange={e => onEditChange(e.target.value)}
          onBlur={onEditBlur} onKeyDown={onEditKey}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span style={s.sideLabel}>{label}</span>
      )}
      <span style={s.sideCount}>{count}</span>
      {isFolder && onDelete && hov && !editing && (
        <button style={s.sideDel} onClick={e => { e.stopPropagation(); onDelete() }}>×</button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MediaBin() {
  const {
    clips, addClip, removeClip, addTimelineItem, getTimelineDuration, videoTrackCount,
    folders, addFolder, removeFolder, renameFolder, moveClipToFolder,
    setHoverPreviewClip,
  } = useEditorStore()

  const [draggingOver, setDraggingOver]         = useState(false)
  const [importing, setImporting]               = useState(false)
  const [solidColor, setSolidColor]             = useState('#000000')
  const [sidebarOpen, setSidebarOpen]           = useState(true)
  const [selectedFolder, setSelectedFolder]     = useState<string | null>(null) // null = All Media
  const [editingId, setEditingId]               = useState<string | null>(null)
  const [editingName, setEditingName]           = useState('')
  const [folderDragOver, setFolderDragOver]     = useState<string | 'root' | null>(null)
  const [search, setSearch]                     = useState('')
  const [typeFilter, setTypeFilter]             = useState<TypeFilter>('all')
  const [sortMode, setSortMode]                 = useState<SortMode>('name-asc')
  const [viewMode, setViewMode]                 = useState<ViewMode>('grid')
  const [contextMenu, setContextMenu]           = useState<{ clipId: string; x: number; y: number } | null>(null)

  // If selected folder is deleted, go back to All Media
  useEffect(() => {
    if (selectedFolder && !folders.find(f => f.id === selectedFolder)) {
      setSelectedFolder(null)
    }
  }, [folders, selectedFolder])

  function filterClips(list: MediaClip[]) {
    return list.filter(c => {
      const matchType   = typeFilter === 'all' || c.type === typeFilter
      const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase())
      return matchType && matchSearch
    })
  }

  function sortClips(list: MediaClip[]) {
    const importedMs = (clip: MediaClip) => clip.importedAt ? new Date(clip.importedAt).getTime() : 0
    const byName = (a: MediaClip, b: MediaClip) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    const byType = (a: MediaClip, b: MediaClip) => a.type.localeCompare(b.type) || byName(a, b)

    return list
      .map((clip, index) => ({ clip, index }))
      .sort((a, b) => {
        let result = 0
        if (sortMode === 'recent') result = importedMs(b.clip) - importedMs(a.clip)
        else if (sortMode === 'name-asc') result = byName(a.clip, b.clip)
        else if (sortMode === 'name-desc') result = byName(b.clip, a.clip)
        else if (sortMode === 'type') result = byType(a.clip, b.clip)
        else if (sortMode === 'duration-desc') result = b.clip.duration - a.clip.duration || byName(a.clip, b.clip)
        else if (sortMode === 'duration-asc') result = a.clip.duration - b.clip.duration || byName(a.clip, b.clip)
        return result || a.index - b.index
      })
      .map(({ clip }) => clip)
  }

  function sortFolders(list: MediaFolder[]) {
    return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
  }

  // Clips shown in main pane
  const visibleClips = sortClips(filterClips(
    selectedFolder === null
      ? clips.filter(c => !c.folderId)                     // All Media: unassigned clips only
      : clips.filter(c => c.folderId === selectedFolder)   // specific folder
  ))

  async function handleImport() {
    const paths = await window.api.openFiles()
    if (!paths.length) return
    setImporting(true)
    await importAndAddClips(paths, selectedFolder ?? undefined)
    setImporting(false)
  }

  // Drop on main content area → import into current folder
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDraggingOver(false)
    const clipId = e.dataTransfer.getData('text/x-clip-id')
    if (clipId) {
      // Clip dragged within the bin — move to current folder context
      moveClipToFolder(clipId, selectedFolder)
      return
    }
    const paths = Array.from(e.dataTransfer.files).map((f) => (f as any).path as string)
    if (!paths.length) return
    setImporting(true)
    await importAndAddClips(paths, selectedFolder ?? undefined)
    setImporting(false)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!folderDragOver) setDraggingOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDraggingOver(false)
  }

  // Sidebar folder drop
  async function handleSidebarDrop(e: React.DragEvent, folderId: string | null) {
    e.preventDefault()
    e.stopPropagation()
    setFolderDragOver(null)
    setDraggingOver(false)
    const clipId = e.dataTransfer.getData('text/x-clip-id')
    if (clipId) {
      moveClipToFolder(clipId, folderId)
      return
    }
    const paths = Array.from(e.dataTransfer.files).map((f) => (f as any).path as string)
    if (!paths.length) return
    setImporting(true)
    await importAndAddClips(paths, folderId ?? undefined)
    if (folderId) setSelectedFolder(folderId)
    setImporting(false)
  }

  function handleSidebarDragOver(e: React.DragEvent, key: string | 'root') {
    if (!e.dataTransfer.types.includes('text/x-clip-id') && !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    setFolderDragOver(key)
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
      importedAt: new Date().toISOString(),
    })
  }

  function createFolder() {
    const id = nanoid()
    addFolder({ id, name: 'New Folder' })
    setEditingId(id)
    setEditingName('New Folder')
    setSelectedFolder(id)
  }

  function commitRename(id: string) {
    renameFolder(id, editingName.trim() || 'Folder')
    setEditingId(null)
  }

  function openCtx(e: React.MouseEvent, clipId: string) {
    e.preventDefault()
    setContextMenu({ clipId, x: e.clientX, y: e.clientY })
  }

  const isEmpty = clips.length === 0 && folders.length === 0
  const visibleFolders = selectedFolder === null ? sortFolders(folders) : []

  return (
    <div style={s.bin} onClick={() => contextMenu && setContextMenu(null)}>

      {/* ── Top header ── */}
      <div style={s.header}>
        <button style={s.sideToggle} onClick={() => setSidebarOpen(v => !v)} title={sidebarOpen ? 'Hide panel' : 'Show panel'}>
          {sidebarOpen ? '‹' : '›'}
        </button>
        <span style={s.title}>Media</span>
        <div style={s.headerRight}>
          <div style={s.viewToggle}>
            <button style={{ ...s.viewBtn, ...(viewMode === 'grid' ? s.viewBtnOn : {}) }} onClick={() => setViewMode('grid')} title="Grid">⊞</button>
            <button style={{ ...s.viewBtn, ...(viewMode === 'list' ? s.viewBtnOn : {}) }} onClick={() => setViewMode('list')} title="List">☰</button>
          </div>
          <button style={s.headerBtn} onClick={handleImport} disabled={importing}>{importing ? '…' : '+ Import'}</button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div style={s.filterBar}>
        <input style={s.searchInput} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        <div style={s.filterTools}>
          <div style={s.pills}>
            {(['all','video','audio','image','solid'] as TypeFilter[]).map(t => (
              <button key={t} style={{ ...s.pill, ...(typeFilter === t ? s.pillOn : {}) }} onClick={() => setTypeFilter(t)}>
                {t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <select
            style={s.sortSelect}
            value={sortMode}
            onChange={e => setSortMode(e.target.value as SortMode)}
            title="Sort media"
          >
            {SORT_ORDER.map(mode => (
              <option key={mode} value={mode}>{SORT_LABELS[mode]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Solid color ── */}
      <div style={s.solidRow}>
        <input type="color" value={solidColor} onChange={e => setSolidColor(e.target.value)} style={s.solidSwatch} title="Solid color" />
        <span style={s.solidLabel}>{solidColor.toUpperCase()}</span>
        <button style={s.solidBtn} onClick={addSolidColor}>+ Solid</button>
      </div>

      {/* ── Two-pane body ── */}
      <div style={s.body}>

        {/* Sidebar */}
        {sidebarOpen && (
          <div style={s.sidebar}>
            <div style={s.sideScroll}>
              {/* All Media */}
              <SidebarItem
                label="All Media" count={clips.length} selected={selectedFolder === null}
                isFolder={false} dragOver={folderDragOver === 'root'} editing={false} editName=""
                onClick={() => setSelectedFolder(null)} onDblClick={() => {}}
                onDrop={e => handleSidebarDrop(e, null)}
                onDragOver={e => handleSidebarDragOver(e, 'root')}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFolderDragOver(null) }}
                onEditChange={() => {}} onEditBlur={() => {}} onEditKey={() => {}}
              />

              <div style={s.sideDivider} />

              {/* Folders */}
              {sortFolders(folders).map(f => (
                <SidebarItem key={f.id}
                  label={f.name} count={clips.filter(c => c.folderId === f.id).length}
                  selected={selectedFolder === f.id} isFolder dragOver={folderDragOver === f.id}
                  editing={editingId === f.id} editName={editingName}
                  onClick={() => setSelectedFolder(f.id)}
                  onDblClick={() => { setEditingId(f.id); setEditingName(f.name) }}
                  onDelete={() => removeFolder(f.id)}
                  onDrop={e => handleSidebarDrop(e, f.id)}
                  onDragOver={e => handleSidebarDragOver(e, f.id)}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFolderDragOver(null) }}
                  onEditChange={setEditingName}
                  onEditBlur={() => commitRename(f.id)}
                  onEditKey={e => { if (e.key === 'Enter') commitRename(f.id); if (e.key === 'Escape') setEditingId(null) }}
                />
              ))}
            </div>

            <button style={s.sideNewFolder} onClick={createFolder}>+ New Folder</button>
          </div>
        )}

        {/* Main content */}
        <div
          style={{ ...s.main, ...(draggingOver && !folderDragOver ? s.mainDragging : {}) }}
          onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
        >
          {/* Breadcrumb */}
          <div style={s.breadcrumb}>
            {selectedFolder === null
              ? <span style={s.breadCur}>All Media</span>
              : <>
                  <button style={s.breadBack} onClick={() => setSelectedFolder(null)}>All Media</button>
                  <span style={s.breadSep}>›</span>
                  <span style={s.breadCur}>{folders.find(f => f.id === selectedFolder)?.name ?? ''}</span>
                </>
            }
          </div>

          {/* Drop overlay */}
          {draggingOver && !folderDragOver && (
            <div style={s.dropOverlay}>
              <div style={s.dropIcon}>+</div>
              <div style={s.dropText}>Drop to add{selectedFolder ? ' to folder' : ''}</div>
            </div>
          )}

          {importing && <div style={s.importing}>Importing…</div>}

          {!draggingOver && isEmpty && !importing && (
            <div style={s.empty} onClick={handleImport}>
              <div style={s.emptyIcon}>▶</div>
              <div style={s.emptyTxt}>Click to import</div>
              <div style={s.emptySub}>or drag files and folders here</div>
            </div>
          )}

          {!draggingOver && !importing && !isEmpty && visibleFolders.length === 0 && visibleClips.length === 0 && (
            <div style={s.noMatch}>No clips match</div>
          )}

          <div style={viewMode === 'grid' ? s.grid : s.list}>
            {visibleFolders.map(f => (
              <FolderCard key={f.id} folder={f} count={clips.filter(c => c.folderId === f.id).length}
                viewMode={viewMode} dragOver={folderDragOver === f.id}
                onClick={() => setSelectedFolder(f.id)}
                onDrop={e => handleSidebarDrop(e, f.id)}
                onDragOver={e => handleSidebarDragOver(e, f.id)}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFolderDragOver(null) }}
              />
            ))}
            {visibleClips.map(clip => (
              <ClipCard key={clip.id} clip={clip} viewMode={viewMode}
                onAdd={() => addToTimeline(clip)}
                onRemove={() => removeClip(clip.id)}
                onCtx={e => openCtx(e, clip.id)}
                onHoverEnter={() => setHoverPreviewClip(clip)}
                onHoverLeave={() => setHoverPreviewClip(null)} />
            ))}
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (() => {
        const clip = clips.find(c => c.id === contextMenu.clipId)
        if (!clip) return null
        return <ContextMenu
          clip={clip} folders={folders} x={contextMenu.x} y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onAdd={() => { addToTimeline(clip); setContextMenu(null) }}
          onMoveToFolder={fId => { moveClipToFolder(clip.id, fId); setContextMenu(null) }}
          onRemove={() => { removeClip(clip.id); setContextMenu(null) }}
        />
      })()}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  bin:    { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative', userSelect: 'none' },

  // Header
  header:      { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderBottom: '1px solid #222', flexShrink: 0 },
  sideToggle:  { background: 'none', border: 'none', color: '#555', fontSize: 18, cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0 },
  title:       { fontSize: 13, fontWeight: 600, color: '#999', letterSpacing: '0.05em', flex: 1 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 5 },
  viewToggle:  { display: 'flex', background: '#181818', borderRadius: 4, border: '1px solid #2a2a2a', overflow: 'hidden' },
  viewBtn:     { background: 'none', border: 'none', color: '#555', fontSize: 14, cursor: 'pointer', padding: '3px 6px', lineHeight: 1 },
  viewBtnOn:   { background: '#2a2a2a', color: '#bbb' },
  headerBtn:   { background: '#252525', border: 'none', color: '#bbb', padding: '4px 9px', borderRadius: 4, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' },

  // Filter bar
  filterBar:   { display: 'flex', flexDirection: 'column', gap: 5, padding: '7px 10px', borderBottom: '1px solid #1e1e1e', flexShrink: 0 },
  searchInput: { background: '#181818', border: '1px solid #2a2a2a', borderRadius: 4, color: '#ccc', padding: '4px 8px', fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box' },
  filterTools: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
  pills:       { display: 'flex', flexWrap: 'wrap', gap: 3, minWidth: 0 },
  pill:        { background: 'none', border: '1px solid #252525', color: '#555', borderRadius: 3, padding: '2px 6px', fontSize: 10, cursor: 'pointer' },
  pillOn:      { background: '#252525', border: '1px solid #3a3a3a', color: '#bbb' },
  sortSelect:  { background: '#181818', border: '1px solid #2a2a2a', color: '#aaa', borderRadius: 4, padding: '3px 6px', fontSize: 11, outline: 'none', width: '100%' },

  // Solid color
  solidRow:   { display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 },
  solidSwatch:{ width: 20, height: 20, padding: 0, border: '1px solid #3a3a3a', borderRadius: 3, cursor: 'pointer', background: 'none', flexShrink: 0 },
  solidLabel: { fontSize: 10, color: '#4a4a4a', fontFamily: 'monospace', flex: 1 },
  solidBtn:   { background: '#202020', border: 'none', color: '#aaa', padding: '3px 7px', borderRadius: 3, cursor: 'pointer', fontSize: 10 },

  // Body
  body: { display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 },

  // Sidebar
  sidebar:       { width: 130, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #1e1e1e', background: '#131313' },
  sideScroll:    { flex: 1, overflowY: 'auto', padding: '6px 4px' },
  sideItem:      { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 6px', borderRadius: 4, cursor: 'pointer', marginBottom: 1, transition: 'background 0.1s', minWidth: 0 },
  sideItemOn:    { background: '#252525' },
  sideItemDrop:  { background: 'rgba(42,191,90,0.1)', outline: '1px dashed #2abf5a' },
  sideIcon:      { fontSize: 10, color: '#555', flexShrink: 0 },
  sideLabel:     { flex: 1, fontSize: 12, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  sideInput:     { flex: 1, background: '#2a2a2a', border: '1px solid #444', color: '#fff', fontSize: 11, padding: '1px 4px', borderRadius: 2, outline: 'none', minWidth: 0 },
  sideCount:     { fontSize: 10, color: '#444', flexShrink: 0 },
  sideDel:       { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0, flexShrink: 0 },
  sideDivider:   { height: 1, background: '#1e1e1e', margin: '4px 6px' },
  sideNewFolder: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 11, padding: '8px 10px', textAlign: 'left', borderTop: '1px solid #1e1e1e', flexShrink: 0 },

  // Main
  main:         { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', minWidth: 0 },
  mainDragging: { background: 'rgba(42,191,90,0.04)', outline: '2px dashed #2abf5a', outlineOffset: -3 },

  // Breadcrumb
  breadcrumb: { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 },
  breadBack:  { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 11, padding: 0 },
  breadSep:   { color: '#333', fontSize: 11 },
  breadCur:   { fontSize: 11, color: '#777', fontWeight: 600 },

  // Content
  dropOverlay: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, pointerEvents: 'none', zIndex: 10 },
  dropIcon:    { fontSize: 28, color: '#2abf5a', lineHeight: 1 },
  dropText:    { fontSize: 12, color: '#2abf5a', fontWeight: 600 },
  importing:   { textAlign: 'center', color: '#555', fontSize: 12, padding: '16px' },
  empty:       { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '32px 0', cursor: 'pointer' },
  emptyIcon:   { fontSize: 28, color: '#333' },
  emptyTxt:    { fontSize: 12, color: '#555' },
  emptySub:    { fontSize: 11, color: '#333' },
  noMatch:     { textAlign: 'center', color: '#3a3a3a', fontSize: 12, padding: '24px' },

  // Clips scroll area
  grid: { flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexWrap: 'wrap' as const, gap: 8, alignContent: 'flex-start' },
  list: { flex: 1, overflowY: 'auto', padding: '4px 6px', display: 'flex', flexDirection: 'column' as const, gap: 1 },

  // Grid card
  card:     { width: 108, cursor: 'default' },
  cardDrop: { outline: '1px dashed #2abf5a', borderRadius: 4 },
  thumb:    { width: 108, height: 66, background: '#1a1a1a', borderRadius: 4, overflow: 'hidden', position: 'relative' as const },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover' as const, display: 'block' },
  thumbPh:  { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#3a3a3a' },
  badge:    { position: 'absolute' as const, top: 3, left: 3, fontSize: 8, fontWeight: 700, letterSpacing: '0.05em', background: 'rgba(0,0,0,0.6)', color: '#888', padding: '1px 3px', borderRadius: 2 },
  durBadge: { position: 'absolute' as const, bottom: 3, right: 3, fontSize: 9, color: '#ccc', background: 'rgba(0,0,0,0.65)', padding: '1px 3px', borderRadius: 2 },
  cardName: { fontSize: 10, color: '#777', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, paddingLeft: 1 },

  // List row
  listRow:    { display: 'flex', alignItems: 'center', gap: 7, padding: '3px 5px', borderRadius: 3, cursor: 'default' },
  listRowHov: { background: '#1c1c1c' },
  listRowDrop: { background: 'rgba(42,191,90,0.08)', outline: '1px dashed #2abf5a' },
  listThumb:  { width: 40, height: 25, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden', flexShrink: 0, position: 'relative' as const },
  listName:   { flex: 1, fontSize: 11, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, minWidth: 0 },
  listDur:    { fontSize: 10, color: '#4a4a4a', flexShrink: 0 },
  listDel:    { background: 'none', border: 'none', color: '#4a4a4a', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, flexShrink: 0 },

  // Context menu
  ctx:        { position: 'fixed' as const, zIndex: 999, background: '#1c1c1c', border: '1px solid #2e2e2e', borderRadius: 6, padding: '3px 0', minWidth: 190, boxShadow: '0 8px 24px rgba(0,0,0,0.6)' },
  ctxItem:    { display: 'block', width: '100%', background: 'none', border: 'none', color: '#bbb', textAlign: 'left' as const, padding: '6px 13px', fontSize: 12, cursor: 'pointer' },
  ctxItemHov: { background: '#2a2a2a' },
  ctxDanger:  { color: '#e05' },
  ctxDiv:     { height: 1, background: '#252525', margin: '3px 0' },
  ctxLbl:     { fontSize: 10, color: '#4a4a4a', padding: '3px 13px 1px', letterSpacing: '0.06em', textTransform: 'uppercase' as const },
}
