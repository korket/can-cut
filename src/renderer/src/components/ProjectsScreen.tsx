import { useState, useEffect, useRef } from 'react'

interface Props {
  onOpen: (id: string) => void
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7)  return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function focusAndSelect(input: HTMLInputElement | null) {
  input?.focus()
  input?.select()
}

function selectOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.select()
}

export default function ProjectsScreen({ onOpen }: Props) {
  const [projects,    setProjects]    = useState<ProjectMeta[]>([])
  const [creating,    setCreating]    = useState(false)
  const [newName,     setNewName]     = useState('')
  const [renamingId,  setRenamingId]  = useState<string | null>(null)
  const [renameVal,   setRenameVal]   = useState('')
  const [hovered,     setHovered]     = useState<string | null>(null)
  const newInputRef   = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { load() }, [])
  useEffect(() => { if (creating) focusAndSelect(newInputRef.current) }, [creating])
  useEffect(() => { if (renamingId) focusAndSelect(renameInputRef.current) }, [renamingId])

  async function load() {
    const list = await window.api.listProjects()
    setProjects(list)
  }

  async function handleCreate() {
    const name = newName.trim() || 'Untitled Project'
    const proj = await window.api.createProject(name)
    setCreating(false)
    setNewName('')
    onOpen(proj.id)
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await window.api.deleteProject(id)
    setProjects(p => p.filter(x => x.id !== id))
  }

  async function commitRename(id: string) {
    const name = renameVal.trim()
    if (name) {
      await window.api.renameProject(id, name)
      setProjects(p => p.map(x => x.id === id ? { ...x, name } : x))
    }
    setRenamingId(null)
  }

  function startRename(e: React.MouseEvent, proj: ProjectMeta) {
    e.stopPropagation()
    setRenamingId(proj.id)
    setRenameVal(proj.name)
  }

  return (
    <div style={styles.root}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <span style={styles.logo}>✦ Can Cut</span>
      </div>

      <div style={styles.body}>
        <div style={styles.heading}>My Projects</div>

        <div style={styles.grid}>
          {/* New Project card */}
          {creating ? (
            <div style={styles.card}>
              <div style={{ ...styles.thumb, ...styles.thumbNew }}>
                <span style={styles.plusIcon}>+</span>
              </div>
              <input
                ref={newInputRef}
                style={styles.newInput}
                value={newName}
                placeholder="Project name…"
                onFocus={selectOnFocus}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
                onBlur={handleCreate}
              />
            </div>
          ) : (
            <div style={styles.card} onClick={() => setCreating(true)}>
              <div style={{ ...styles.thumb, ...styles.thumbNew }}>
                <span style={styles.plusIcon}>+</span>
              </div>
              <div style={styles.cardLabel}>New Project</div>
            </div>
          )}

          {/* Existing project cards */}
          {projects.map(proj => (
            <div
              key={proj.id}
              style={{ ...styles.card, ...(hovered === proj.id ? styles.cardHovered : {}) }}
              onClick={() => renamingId !== proj.id && onOpen(proj.id)}
              onMouseEnter={() => setHovered(proj.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <div style={styles.thumb}>
                {proj.thumbnail
                  ? <img src={proj.thumbnail} style={styles.thumbImg} />
                  : <div style={styles.thumbPlaceholder}><span style={styles.thumbIcon}>▶</span></div>
                }
                {/* Delete button */}
                {hovered === proj.id && (
                  <button
                    style={styles.deleteBtn}
                    onClick={e => handleDelete(e, proj.id)}
                    title="Delete project"
                  >×</button>
                )}
              </div>

              <div style={styles.cardMeta}>
                {renamingId === proj.id ? (
                  <input
                    ref={renameInputRef}
                    style={styles.renameInput}
                    value={renameVal}
                    onFocus={selectOnFocus}
                    onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(proj.id); if (e.key === 'Escape') setRenamingId(null) }}
                    onBlur={() => commitRename(proj.id)}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <div
                    style={styles.cardLabel}
                    onDoubleClick={e => startRename(e, proj)}
                    title="Double-click to rename"
                  >{proj.name}</div>
                )}
                <div style={styles.cardDate}>{timeAgo(proj.updatedAt)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root:    { display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f0f0f', overflow: 'hidden', WebkitAppRegion: 'drag' as never },
  topBar:  { height: 56, display: 'flex', alignItems: 'center', paddingLeft: 24, borderBottom: '1px solid #1e1e1e', flexShrink: 0 },
  logo:    { fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: 0.5 },
  body:    { flex: 1, overflowY: 'auto', padding: '40px 48px', WebkitAppRegion: 'no-drag' as never },
  heading: { fontSize: 26, fontWeight: 700, color: '#fff', marginBottom: 28 },

  grid:    { display: 'flex', flexWrap: 'wrap', gap: 24 },

  card:    { width: 210, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 },
  cardHovered: { },

  thumb:   { width: 210, height: 118, borderRadius: 9, overflow: 'hidden', background: '#1a1a1a', position: 'relative', border: '1px solid #2a2a2a' },
  thumbNew:{ border: '2px dashed #333', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 0.15s' },
  thumbImg:{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  thumbPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  thumbIcon: { fontSize: 34, color: '#333' },
  plusIcon:  { fontSize: 40, color: '#444', lineHeight: 1 },

  deleteBtn: {
    position: 'absolute', top: 7, right: 7,
    width: 26, height: 26, borderRadius: 13,
    background: 'rgba(0,0,0,0.75)', border: 'none',
    color: '#aaa', fontSize: 18, lineHeight: 1,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },

  cardMeta:  { display: 'flex', flexDirection: 'column', gap: 3 },
  cardLabel: { fontSize: 15, color: '#ddd', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardDate:  { fontSize: 13, color: '#555' },

  newInput:    { background: '#1e1e1e', border: '1px solid #444', color: '#fff', fontSize: 14, padding: '5px 10px', borderRadius: 5, outline: 'none', width: '100%', boxSizing: 'border-box' },
  renameInput: { background: '#1e1e1e', border: '1px solid #444', color: '#fff', fontSize: 14, padding: '3px 8px', borderRadius: 4, outline: 'none', width: '100%', boxSizing: 'border-box' },
}
