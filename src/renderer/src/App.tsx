import { useState, useRef, useEffect, useCallback } from 'react'
import TopBar from './components/TopBar'
import MediaBin from './components/MediaBin'
import PreviewPlayer from './components/PreviewPlayer'
import PropertiesPanel from './components/PropertiesPanel'
import Timeline from './components/Timeline'
import ExportModal from './components/ExportModal'
import ShortcutsModal from './components/ShortcutsModal'
import ProjectsScreen from './components/ProjectsScreen'
import VersionHistoryModal from './components/VersionHistoryModal'
import { createProjectDocument, readEditorStateFromProjectData, stripTransientClipState } from './editor-core/document'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useEditorStore } from './store/useEditorStore'
import { useHistoryStore } from './store/useHistoryStore'
import { enqueueVideoProxyForClip } from './media-engine/proxyJobs'

const AUTOSAVE_DELAY_MS = 1500
const AUTO_VERSION_INTERVAL_MS = 60_000

type EditorStateSnapshot = ReturnType<typeof useEditorStore.getState>

function createProjectContentKey(state: EditorStateSnapshot) {
  return JSON.stringify({
    clips: state.clips.map(stripTransientClipState),
    folders: state.folders,
    timelineItems: state.timelineItems,
    textOverlays: state.textOverlays,
    zoom: state.zoom,
    fps: state.fps,
    videoTrackCount: state.videoTrackCount,
    audioTrackCount: state.audioTrackCount,
  })
}

function getProjectDocumentTime(json: string | null | undefined) {
  if (!json) return 0
  try {
    const data = JSON.parse(json)
    const value = typeof data?.updatedAt === 'string' ? data.updatedAt : data?.createdAt
    return value ? new Date(value).getTime() : 0
  } catch {
    return 0
  }
}

// ── Resizer handle ─────────────────────────────────────────────────────────
function Resizer({ direction, onMouseDown }: { direction: 'h' | 'v'; onMouseDown: (e: React.MouseEvent) => void }) {
  const [hovered, setHovered] = useState(false)
  const base: React.CSSProperties = { flexShrink: 0, zIndex: 10, transition: 'background 0.12s', background: hovered ? '#4a4a4a' : '#2a2a2a' }
  const style: React.CSSProperties = direction === 'h'
    ? { ...base, width: 4, cursor: 'ew-resize', height: '100%' }
    : { ...base, height: 4, cursor: 'ns-resize', width: '100%' }
  return <div style={style} onMouseDown={onMouseDown} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} />
}

// ── Empty store state (for resetting between projects) ────────────────────
const EMPTY_STATE = {
  clips: [], folders: [], timelineItems: [], textOverlays: [],
  currentTime: 0, isPlaying: false, selectedId: null, tool: 'select' as const,
  zoom: 100, videoTrackCount: 2, audioTrackCount: 2, fps: 30,
}

// ── Editor view ───────────────────────────────────────────────────────────
function Editor({ projectId, projectName, projectCreatedAt, onBack, onOpenProject }: {
  projectId: string
  projectName: string
  projectCreatedAt?: string
  onBack: () => void
  onOpenProject: (id: string) => Promise<void>
}) {
  const [showExport,    setShowExport]    = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showVersions,  setShowVersions]  = useState(false)
  const clips = useEditorStore(state => state.clips)
  const queuedProxyClipIds = useRef(new Set<string>())

  const [sidebarWidth,    setSidebarWidth]    = useState(() => Number(localStorage.getItem('layout:sidebarWidth'))    || 240)
  const [propertiesWidth, setPropertiesWidth] = useState(() => Number(localStorage.getItem('layout:propertiesWidth')) || 220)
  const [timelineHeight,  setTimelineHeight]  = useState(() => Number(localStorage.getItem('layout:timelineHeight'))  || 260)

  useEffect(() => { localStorage.setItem('layout:sidebarWidth',    String(sidebarWidth))    }, [sidebarWidth])
  useEffect(() => { localStorage.setItem('layout:propertiesWidth', String(propertiesWidth)) }, [propertiesWidth])
  useEffect(() => { localStorage.setItem('layout:timelineHeight',  String(timelineHeight))  }, [timelineHeight])

  const resizing = useRef<{ type: string; startPos: number; startSize: number } | null>(null)

  function startResize(type: string, e: React.MouseEvent) {
    e.preventDefault()
    const startPos  = type === 'timeline' ? e.clientY : e.clientX
    const startSize = type === 'sidebar' ? sidebarWidth : type === 'properties' ? propertiesWidth : timelineHeight
    resizing.current = { type, startPos, startSize }
  }

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!resizing.current) return
    const { type, startPos, startSize } = resizing.current
    const delta = type === 'timeline' ? e.clientY - startPos : e.clientX - startPos
    if (type === 'sidebar')         setSidebarWidth(   Math.max(140, Math.min(600, startSize + delta)))
    else if (type === 'properties') setPropertiesWidth(Math.max(140, Math.min(500, startSize - delta)))
    else if (type === 'timeline')   setTimelineHeight( Math.max(80,  Math.min(700, startSize - delta)))
  }, [])

  const onMouseUp = useCallback(() => { resizing.current = null }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [onMouseMove, onMouseUp])

  const getCurrentProjectData = useCallback((updatedAt = new Date().toISOString()) => {
    const state = useEditorStore.getState()
    return JSON.stringify(createProjectDocument({
      id: projectId, name: projectName,
      createdAt: projectCreatedAt,
      updatedAt,
      clips:           state.clips.map(stripTransientClipState),
      folders:         state.folders,
      timelineItems:   state.timelineItems,
      textOverlays:    state.textOverlays,
      zoom:            state.zoom,
      fps:             state.fps,
      videoTrackCount: state.videoTrackCount,
      audioTrackCount: state.audioTrackCount,
    }))
  }, [projectId, projectName, projectCreatedAt])

  const suppressAutosave = useRef(false)
  const lastContentKey = useRef('')
  const lastAutoVersionAt = useRef(0)

  // Auto-save meaningful document changes, with recovery and periodic history snapshots.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    lastContentKey.current = createProjectContentKey(useEditorStore.getState())

    const unsub = useEditorStore.subscribe((state) => {
      const contentKey = createProjectContentKey(state)
      const suppressing = suppressAutosave.current
      if (suppressing) suppressAutosave.current = false

      if (contentKey === lastContentKey.current) return
      lastContentKey.current = contentKey

      if (suppressing) return

      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        const payload = getCurrentProjectData()
        try {
          await window.api.saveProjectRecovery(projectId, payload)
          await window.api.saveProject(projectId, payload)

          const now = Date.now()
          if (now - lastAutoVersionAt.current >= AUTO_VERSION_INTERVAL_MS) {
            lastAutoVersionAt.current = now
            await window.api.createProjectVersion(projectId, payload, { label: 'Autosave', kind: 'auto' })
          }
        } catch (error) {
          console.error('Autosave failed', error)
        }
      }, AUTOSAVE_DELAY_MS)
    })
    return () => { unsub(); if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [projectId, getCurrentProjectData])

  const restoreProjectData = useCallback(async (json: string) => {
    const data = readEditorStateFromProjectData(JSON.parse(json))
    suppressAutosave.current = true
    useEditorStore.setState({
      clips:           data.clips           ?? [],
      folders:         data.folders         ?? [],
      timelineItems:   data.timelineItems   ?? [],
      textOverlays:    data.textOverlays    ?? [],
      zoom:            data.zoom            ?? 100,
      fps:             data.fps             ?? 30,
      videoTrackCount: data.videoTrackCount ?? 2,
      audioTrackCount: data.audioTrackCount ?? 2,
      currentTime: 0, isPlaying: false, selectedId: null,
    })
    useHistoryStore.getState().clear()
    const payload = getCurrentProjectData()
    lastContentKey.current = createProjectContentKey(useEditorStore.getState())
    await window.api.saveProjectRecovery(projectId, payload)
    await window.api.saveProject(projectId, payload)
  }, [getCurrentProjectData, projectId])

  useKeyboardShortcuts(() => setShowExport(true))

  useEffect(() => {
    for (const clip of clips) {
      if (clip.type !== 'video') continue
      if (clip.proxy?.status === 'ready' || clip.proxy?.status === 'generating') continue
      if (queuedProxyClipIds.current.has(clip.id)) continue

      queuedProxyClipIds.current.add(clip.id)
      enqueueVideoProxyForClip(clip)
    }
  }, [clips])

  return (
    <div style={styles.root}>
      <TopBar
        onExport={() => setShowExport(true)}
        onShortcuts={() => setShowShortcuts(true)}
        onVersions={() => setShowVersions(true)}
        onBack={onBack}
        projectName={projectName}
      />
      <div style={styles.main}>
        <div style={{ ...styles.panel, width: sidebarWidth }}><MediaBin /></div>
        <Resizer direction="h" onMouseDown={e => startResize('sidebar', e)} />
        <div style={styles.center}><PreviewPlayer /></div>
        <Resizer direction="h" onMouseDown={e => startResize('properties', e)} />
        <div style={{ ...styles.panel, width: propertiesWidth }}><PropertiesPanel /></div>
      </div>
      <Resizer direction="v" onMouseDown={e => startResize('timeline', e)} />
      <div style={{ ...styles.panel, height: timelineHeight }}><Timeline /></div>

      {showExport    && <ExportModal    onClose={() => setShowExport(false)} />}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {showVersions  && (
        <VersionHistoryModal
          projectId={projectId}
          projectName={projectName}
          onClose={() => setShowVersions(false)}
          getCurrentProjectData={getCurrentProjectData}
          onRestoreProjectData={restoreProjectData}
          onOpenProject={onOpenProject}
        />
      )}
    </div>
  )
}

// ── Root App ──────────────────────────────────────────────────────────────
export default function App() {
  const [projectId,        setProjectId]        = useState<string | null>(null)
  const [projectName,      setProjectName]      = useState('')
  const [projectCreatedAt, setProjectCreatedAt] = useState<string | undefined>()
  const [loading,          setLoading]          = useState(false)

  async function openProject(id: string) {
    setLoading(true)
    try {
      let json = await window.api.loadProject(id)
      if (!json) { setLoading(false); return }
      const recovery = await window.api.loadProjectRecovery(id)
      if (recovery?.data && getProjectDocumentTime(recovery.data) > getProjectDocumentTime(json) + 1000) {
        const restoreRecovery = window.confirm('A newer autosave recovery exists for this project. Restore it?')
        if (restoreRecovery) {
          json = recovery.data
          await window.api.saveProject(id, json)
        }
      }

      const data = readEditorStateFromProjectData(JSON.parse(json))
      useEditorStore.setState({
        clips:           data.clips           ?? [],
        folders:         data.folders         ?? [],
        timelineItems:   data.timelineItems   ?? [],
        textOverlays:    data.textOverlays    ?? [],
        zoom:            data.zoom            ?? 100,
        fps:             data.fps             ?? 30,
        videoTrackCount: data.videoTrackCount ?? 2,
        audioTrackCount: data.audioTrackCount ?? 2,
        currentTime: 0, isPlaying: false, selectedId: null,
      })
      setProjectName(data.name ?? 'Untitled')
      setProjectCreatedAt(data.createdAt)
      setProjectId(id)
      useHistoryStore.getState().clear()
    } catch {
      setLoading(false)
    }
    setLoading(false)
  }

  function goHome() {
    useEditorStore.setState(EMPTY_STATE)
    useHistoryStore.getState().clear()
    setProjectId(null)
    setProjectName('')
    setProjectCreatedAt(undefined)
  }

  if (loading) {
    return <div style={styles.loading}>Opening project…</div>
  }

  if (!projectId) {
    return <ProjectsScreen onOpen={openProject} />
  }

  return <Editor projectId={projectId} projectName={projectName} projectCreatedAt={projectCreatedAt} onBack={goHome} onOpenProject={openProject} />
}

const styles: Record<string, React.CSSProperties> = {
  root:    { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#1a1a1a' },
  main:    { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 },
  panel:   { flexShrink: 0, overflow: 'hidden' },
  center:  { flex: 1, overflow: 'hidden', minWidth: 0 },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#555', fontSize: 14, background: '#0f0f0f' },
}
