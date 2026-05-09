import { useState, useRef, useEffect, useCallback } from 'react'
import TopBar from './components/TopBar'
import MediaBin from './components/MediaBin'
import PreviewPlayer from './components/PreviewPlayer'
import PropertiesPanel from './components/PropertiesPanel'
import Timeline from './components/Timeline'
import ExportModal from './components/ExportModal'
import ShortcutsModal from './components/ShortcutsModal'
import ProjectsScreen from './components/ProjectsScreen'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useEditorStore } from './store/useEditorStore'

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
  zoom: 100, videoTrackCount: 2, audioTrackCount: 2,
}

// ── Editor view ───────────────────────────────────────────────────────────
function Editor({ projectId, projectName, onBack }: { projectId: string; projectName: string; onBack: () => void }) {
  const [showExport,    setShowExport]    = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  const [sidebarWidth,    setSidebarWidth]    = useState(240)
  const [propertiesWidth, setPropertiesWidth] = useState(220)
  const [timelineHeight,  setTimelineHeight]  = useState(260)

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

  // Auto-save on store changes (debounced 1.5 s)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        const thumbnail = (() => {
          const first = state.timelineItems[0]
          if (!first) return null
          const clip = state.clips.find(c => c.id === first.clipId)
          return clip?.thumbnail ?? null
        })()
        const payload = JSON.stringify({
          id: projectId, name: projectName,
          updatedAt: new Date().toISOString(),
          thumbnail,
          clips:           state.clips,
          folders:         state.folders,
          timelineItems:   state.timelineItems,
          textOverlays:    state.textOverlays,
          zoom:            state.zoom,
          videoTrackCount: state.videoTrackCount,
          audioTrackCount: state.audioTrackCount,
        })
        window.api.saveProject(projectId, payload)
      }, 1500)
    })
    return () => { unsub(); if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [projectId, projectName])

  useKeyboardShortcuts(() => setShowExport(true))

  return (
    <div style={styles.root}>
      <TopBar
        onExport={() => setShowExport(true)}
        onShortcuts={() => setShowShortcuts(true)}
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
    </div>
  )
}

// ── Root App ──────────────────────────────────────────────────────────────
export default function App() {
  const [projectId,   setProjectId]   = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [loading,     setLoading]     = useState(false)

  async function openProject(id: string) {
    setLoading(true)
    try {
      const json = await window.api.loadProject(id)
      if (!json) { setLoading(false); return }
      const data = JSON.parse(json)
      useEditorStore.setState({
        clips:           data.clips           ?? [],
        folders:         data.folders         ?? [],
        timelineItems:   data.timelineItems   ?? [],
        textOverlays:    data.textOverlays    ?? [],
        zoom:            data.zoom            ?? 100,
        videoTrackCount: data.videoTrackCount ?? 2,
        audioTrackCount: data.audioTrackCount ?? 2,
        currentTime: 0, isPlaying: false, selectedId: null,
      })
      setProjectName(data.name ?? 'Untitled')
      setProjectId(id)
    } catch {
      setLoading(false)
    }
    setLoading(false)
  }

  function goHome() {
    useEditorStore.setState(EMPTY_STATE)
    setProjectId(null)
    setProjectName('')
  }

  if (loading) {
    return <div style={styles.loading}>Opening project…</div>
  }

  if (!projectId) {
    return <ProjectsScreen onOpen={openProject} />
  }

  return <Editor projectId={projectId} projectName={projectName} onBack={goHome} />
}

const styles: Record<string, React.CSSProperties> = {
  root:    { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#1a1a1a' },
  main:    { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 },
  panel:   { flexShrink: 0, overflow: 'hidden' },
  center:  { flex: 1, overflow: 'hidden', minWidth: 0 },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#555', fontSize: 14, background: '#0f0f0f' },
}
