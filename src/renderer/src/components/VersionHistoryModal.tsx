import { useEffect, useMemo, useState } from 'react'

interface Props {
  projectId: string
  projectName: string
  onClose: () => void
  getCurrentProjectData: () => string
  onRestoreProjectData: (data: string) => Promise<void>
  onOpenProject: (id: string) => Promise<void>
}

function selectOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.select()
}

type VersionTab = 'manual' | 'auto'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function versionSummary(version: ProjectVersionMeta) {
  const parts = [
    `${version.clipCount} clips`,
    `${version.timelineItemCount} timeline items`,
    `${version.textOverlayCount} titles`,
  ]
  return parts.join(' | ')
}

export default function VersionHistoryModal({
  projectId,
  projectName,
  onClose,
  getCurrentProjectData,
  onRestoreProjectData,
  onOpenProject,
}: Props) {
  const [versions, setVersions] = useState<ProjectVersionMeta[]>([])
  const [tab, setTab] = useState<VersionTab>('manual')
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const filteredVersions = useMemo(
    () => versions.filter((version) => version.kind === tab),
    [versions, tab]
  )

  useEffect(() => {
    let canceled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const list = await window.api.listProjectVersions(projectId)
        if (!canceled) setVersions(list)
      } catch {
        if (!canceled) setError('Could not load versions')
      } finally {
        if (!canceled) setLoading(false)
      }
    }

    load()
    return () => { canceled = true }
  }, [projectId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function handleSaveVersion() {
    if (saving) return
    const name = label.trim() || `Version ${formatDate(new Date().toISOString())}`

    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const version = await window.api.createProjectVersion(projectId, getCurrentProjectData(), {
        label: name,
        kind: 'manual',
      })
      setVersions((current) => [version, ...current])
      setLabel('')
      setTab('manual')
      setStatus('Version saved')
    } catch {
      setError('Could not save version')
    } finally {
      setSaving(false)
    }
  }

  async function handleRestore(version: ProjectVersionMeta) {
    if (busyId) return
    const confirmed = window.confirm(`Restore "${version.label}"? Your current edit will be saved as a version first.`)
    if (!confirmed) return

    setBusyId(version.id)
    setError(null)
    setStatus(null)
    try {
      const currentData = getCurrentProjectData()
      const backup = await window.api.createProjectVersion(projectId, currentData, {
        label: `Before restoring ${version.label}`,
        kind: 'manual',
      })
      const data = await window.api.loadProjectVersion(projectId, version.id)
      if (!data) throw new Error('Version not found')

      await onRestoreProjectData(data)
      setVersions((current) => [backup, ...current])
      onClose()
    } catch {
      setError('Could not restore version')
    } finally {
      setBusyId(null)
    }
  }

  async function handleCopy(version: ProjectVersionMeta) {
    if (busyId) return

    setBusyId(version.id)
    setError(null)
    setStatus(null)
    try {
      const currentData = getCurrentProjectData()
      await window.api.saveProjectRecovery(projectId, currentData)
      await window.api.saveProject(projectId, currentData)

      const name = `${projectName} - ${version.label}`.slice(0, 120)
      const project = await window.api.duplicateProjectVersion(projectId, version.id, name)
      onClose()
      await onOpenProject(project.id)
    } catch {
      setError('Could not create project copy')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(version: ProjectVersionMeta) {
    if (busyId) return
    const confirmed = window.confirm(`Delete "${version.label}"?`)
    if (!confirmed) return

    setBusyId(version.id)
    setError(null)
    setStatus(null)
    try {
      await window.api.deleteProjectVersion(projectId, version.id)
      setVersions((current) => current.filter((candidate) => candidate.id !== version.id))
    } catch {
      setError('Could not delete version')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.headerText}>
            <span style={styles.title}>Versions</span>
            <span style={styles.subtitle}>{projectName}</span>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>Close</button>
        </div>

        <div style={styles.saveRow}>
          <input
            style={styles.input}
            value={label}
            placeholder="Version name"
            onFocus={selectOnFocus}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveVersion()
            }}
          />
          <button style={styles.primaryBtn} onClick={handleSaveVersion} disabled={saving}>
            {saving ? 'Saving' : 'Save Version'}
          </button>
        </div>

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tabBtn, ...(tab === 'manual' ? styles.tabBtnActive : null) }}
            onClick={() => setTab('manual')}
          >
            Named
          </button>
          <button
            style={{ ...styles.tabBtn, ...(tab === 'auto' ? styles.tabBtnActive : null) }}
            onClick={() => setTab('auto')}
          >
            Autosaves
          </button>
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {status && <div style={styles.status}>{status}</div>}

        <div style={styles.list}>
          {loading && <div style={styles.empty}>Loading versions...</div>}
          {!loading && filteredVersions.length === 0 && (
            <div style={styles.empty}>{tab === 'manual' ? 'No named versions yet' : 'No autosaves yet'}</div>
          )}

          {!loading && filteredVersions.map((version) => (
            <div key={version.id} style={styles.row}>
              <div style={styles.thumb}>
                {version.thumbnail
                  ? <img src={version.thumbnail} style={styles.thumbImg} />
                  : <div style={styles.thumbPlaceholder}>T</div>
                }
              </div>
              <div style={styles.rowMain}>
                <div style={styles.rowTitle}>{version.label}</div>
                <div style={styles.rowMeta}>{formatDate(version.createdAt)} | {versionSummary(version)}</div>
              </div>
              <div style={styles.actions}>
                <button style={styles.actionBtn} onClick={() => handleRestore(version)} disabled={busyId === version.id}>
                  Restore
                </button>
                <button style={styles.actionBtn} onClick={() => handleCopy(version)} disabled={busyId === version.id}>
                  Copy
                </button>
                <button style={styles.deleteBtn} onClick={() => handleDelete(version)} disabled={busyId === version.id}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { width: 720, maxWidth: 'calc(100vw - 40px)', maxHeight: '84vh', background: '#1e1e1e', border: '1px solid #333', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 },
  headerText: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  title: { fontSize: 18, fontWeight: 700, color: '#fff' },
  subtitle: { fontSize: 12, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  closeBtn: { background: '#2a2a2a', border: '1px solid #444', color: '#ccc', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  saveRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '16px 22px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 },
  input: { minWidth: 0, background: '#151515', border: '1px solid #3a3a3a', color: '#fff', padding: '9px 11px', borderRadius: 6, outline: 'none', fontSize: 14 },
  primaryBtn: { background: '#e63950', border: 'none', color: '#fff', padding: '9px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  tabs: { display: 'flex', gap: 8, padding: '12px 22px 0', flexShrink: 0 },
  tabBtn: { background: '#262626', border: '1px solid #3a3a3a', color: '#aaa', padding: '7px 13px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  tabBtnActive: { background: '#363636', color: '#fff', borderColor: '#555' },
  error: { margin: '12px 22px 0', background: '#2a1717', border: '1px solid #4a2525', color: '#ff9a9a', padding: 9, borderRadius: 6, fontSize: 12, flexShrink: 0 },
  status: { margin: '12px 22px 0', background: '#18261c', border: '1px solid #294832', color: '#9ed6aa', padding: 9, borderRadius: 6, fontSize: 12, flexShrink: 0 },
  list: { overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 9, minHeight: 220 },
  empty: { color: '#777', fontSize: 13, padding: 18, textAlign: 'center', border: '1px solid #303030', borderRadius: 7, background: '#181818' },
  row: { display: 'grid', gridTemplateColumns: '92px 1fr auto', gap: 13, alignItems: 'center', background: '#242424', border: '1px solid #333', borderRadius: 7, padding: 10 },
  thumb: { width: 92, height: 52, borderRadius: 5, overflow: 'hidden', background: '#141414', border: '1px solid #333' },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  thumbPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 18, fontWeight: 700 },
  rowMain: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  rowTitle: { color: '#fff', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowMeta: { color: '#888', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  actions: { display: 'flex', gap: 7, alignItems: 'center' },
  actionBtn: { background: '#2d2d2d', border: '1px solid #444', color: '#ddd', padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  deleteBtn: { background: '#2a1d1d', border: '1px solid #4a3333', color: '#e7a1a1', padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
}
