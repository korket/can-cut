import { useRef, useCallback, useEffect, useState } from 'react'
import { useEditorStore } from '../store/useEditorStore'
import { importAndAddClips } from '../utils/importClip'
import { nanoid } from '../utils/nanoid'
import { getWaveform } from '../utils/waveform'

const TRACK_HEIGHT = 44
const RULER_HEIGHT = 24
const SECTION_H = 22
const HEADER_W = 72
const SNAP_PX = 8

function formatRulerTime(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`
}

export default function Timeline() {
  const {
    clips, timelineItems, removeTimelineItem, updateTimelineItem,
    currentTime, setCurrentTime, setIsPlaying,
    tool, zoom, setZoom, getTimelineDuration,
    videoTrackCount, audioTrackCount, addVideoTrack, addAudioTrack
  } = useEditorStore()

  const containerRef = useRef<HTMLDivElement>(null)   // tracks scroll area
  const rulerRef     = useRef<HTMLDivElement>(null)   // ruler scroll area (horiz only)
  const headerRef    = useRef<HTMLDivElement>(null)   // header scroll area (vert only)
  const duration = Math.max(getTimelineDuration() + 5000, 30000)
  const pxPerMs = zoom / 1000

  const msToPx = (ms: number) => ms * pxPerMs
  const pxToMs = (px: number) => px / pxPerMs

  const [trackHeights, setTrackHeights] = useState<Record<number, number>>({})
  function getTrackH(idx: number) { return trackHeights[idx] ?? TRACK_HEIGHT }

  const totalTracks = videoTrackCount + audioTrackCount
  let totalHeight = SECTION_H * 2
  for (let i = 0; i < totalTracks; i++) totalHeight += getTrackH(i)

  function isAudioTrack(idx: number) { return idx >= videoTrackCount }
  function clipFitsTrack(clipType: string, idx: number) {
    return isAudioTrack(idx) ? clipType === 'audio' : clipType !== 'audio'
  }

  // Ruler ticks
  const tickInterval = zoom < 50 ? 10000 : zoom < 120 ? 5000 : zoom < 300 ? 2000 : 1000
  const ticks: number[] = []
  for (let t = 0; t <= duration; t += tickInterval) ticks.push(t)

  // ── Snapping ───────────────────────────────────────────────────────────────
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [snapIndicator, setSnapIndicator] = useState<number | null>(null)

  function getSnapPoints(excludeId: string) {
    const pts = [0, currentTime]
    for (const item of timelineItems) {
      if (item.id === excludeId) continue
      pts.push(item.startTime, item.startTime + (item.trimEnd - item.trimStart))
    }
    return pts
  }

  function trySnap(t: number, excludeId: string) {
    if (!snapEnabled) return t
    const threshold = pxToMs(SNAP_PX)
    for (const p of getSnapPoints(excludeId)) {
      if (Math.abs(t - p) <= threshold) { setSnapIndicator(p); return p }
    }
    setSnapIndicator(null)
    return t
  }

  // ── Clip drag ──────────────────────────────────────────────────────────────
  const dragState = useRef<{ id: string; startX: number; origStart: number; origTrack: number } | null>(null)

  function onClipMouseDown(e: React.MouseEvent, itemId: string) {
    e.preventDefault(); e.stopPropagation()
    const item = timelineItems.find(i => i.id === itemId)!
    dragState.current = { id: itemId, startX: e.clientX, origStart: item.startTime, origTrack: item.trackIndex }
  }

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.current) return
    const { id, startX, origStart, origTrack } = dragState.current
    const rawStart = Math.max(0, origStart + pxToMs(e.clientX - startX))
    const snapped = trySnap(rawStart, id)
    const trackEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-track]') as HTMLElement | null
    const candidate = trackEl ? parseInt(trackEl.dataset.track!) : origTrack
    const item = useEditorStore.getState().timelineItems.find(i => i.id === id)
    const clip = item ? useEditorStore.getState().clips.find(c => c.id === item.clipId) : null
    const newTrack = clip && !clipFitsTrack(clip.type, candidate) ? origTrack : candidate
    useEditorStore.getState().moveTimelineItem(id, snapped, newTrack)
  }, [pxPerMs, snapEnabled, timelineItems, currentTime, videoTrackCount])

  const onMouseUp = useCallback(() => { dragState.current = null; setSnapIndicator(null) }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [onMouseMove, onMouseUp])

  // ── Resize ─────────────────────────────────────────────────────────────────
  const resizeState = useRef<{ id: string; edge: 'left' | 'right'; startX: number; origTrimStart: number; origTrimEnd: number; origItemStart: number } | null>(null)

  function onResizeMouseDown(e: React.MouseEvent, itemId: string, edge: 'left' | 'right') {
    e.preventDefault(); e.stopPropagation()
    const item = timelineItems.find(i => i.id === itemId)!
    resizeState.current = { id: itemId, edge, startX: e.clientX, origTrimStart: item.trimStart, origTrimEnd: item.trimEnd, origItemStart: item.startTime }
  }

  const onResizeMove = useCallback((e: MouseEvent) => {
    if (!resizeState.current) return
    const { id, edge, startX, origTrimStart, origTrimEnd, origItemStart } = resizeState.current
    const dx = pxToMs(e.clientX - startX)
    const item = timelineItems.find(i => i.id === id)
    if (!item) return
    const clip = useEditorStore.getState().clips.find(c => c.id === item.clipId)
    if (!clip) return
    if (edge === 'right') {
      const rawEnd = item.startTime + Math.min(clip.duration - item.trimStart, Math.max(200, origTrimEnd - origTrimStart + dx))
      const snappedEnd = trySnap(rawEnd, id)
      updateTimelineItem(id, { trimEnd: Math.min(clip.duration, origTrimStart + Math.max(200, snappedEnd - item.startTime)) })
    } else {
      const rawStart = Math.max(0, origItemStart + dx)
      const snappedStart = trySnap(rawStart, id)
      const delta = snappedStart - origItemStart
      const newTrimStart = Math.max(0, Math.min(origTrimEnd - 200, origTrimStart + delta))
      updateTimelineItem(id, { trimStart: newTrimStart, startTime: Math.max(0, origItemStart + (newTrimStart - origTrimStart)) })
    }
  }, [pxPerMs, timelineItems, snapEnabled, currentTime])

  const onResizeUp = useCallback(() => { resizeState.current = null; setSnapIndicator(null) }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onResizeMove)
    window.addEventListener('mouseup', onResizeUp)
    return () => { window.removeEventListener('mousemove', onResizeMove); window.removeEventListener('mouseup', onResizeUp) }
  }, [onResizeMove, onResizeUp])

  // ── Scrubbing ──────────────────────────────────────────────────────────────
  const scrubbing = useRef(false)

  function startScrub(e: React.MouseEvent) {
    e.preventDefault()
    scrubbing.current = true
    setIsPlaying(false)
    document.body.style.cursor = 'pointer'
    seekToX(e.clientX)
  }

  function seekToX(clientX: number) {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = clientX - rect.left + containerRef.current.scrollLeft
    setCurrentTime(Math.max(0, Math.min(pxToMs(x), getTimelineDuration())))
  }

  const onScrubMove = useCallback((e: MouseEvent) => {
    if (!scrubbing.current) return
    seekToX(e.clientX)
  }, [pxPerMs])

  const onScrubUp = useCallback(() => { scrubbing.current = false; document.body.style.cursor = '' }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onScrubMove)
    window.addEventListener('mouseup', onScrubUp)
    return () => { window.removeEventListener('mousemove', onScrubMove); window.removeEventListener('mouseup', onScrubUp) }
  }, [onScrubMove, onScrubUp])

  // ── Track height resize ────────────────────────────────────────────────────
  const trackResizeState = useRef<{ idx: number; startY: number; startH: number } | null>(null)

  function onTrackResizeDown(e: React.MouseEvent, idx: number) {
    e.preventDefault(); e.stopPropagation()
    trackResizeState.current = { idx, startY: e.clientY, startH: getTrackH(idx) }
  }

  const onTrackResizeMove = useCallback((e: MouseEvent) => {
    if (!trackResizeState.current) return
    const { idx, startY, startH } = trackResizeState.current
    setTrackHeights(prev => ({ ...prev, [idx]: Math.max(24, Math.min(200, startH + (e.clientY - startY))) }))
  }, [])

  const onTrackResizeUp = useCallback(() => { trackResizeState.current = null }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onTrackResizeMove)
    window.addEventListener('mouseup', onTrackResizeUp)
    return () => { window.removeEventListener('mousemove', onTrackResizeMove); window.removeEventListener('mouseup', onTrackResizeUp) }
  }, [onTrackResizeMove, onTrackResizeUp])

  // ── Scroll sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    const tracks = containerRef.current
    const ruler  = rulerRef.current
    const header = headerRef.current
    if (!tracks) return

    function onTracksScroll() {
      if (ruler)  ruler.scrollLeft  = tracks!.scrollLeft
      if (header) header.scrollTop  = tracks!.scrollTop
    }
    tracks.addEventListener('scroll', onTracksScroll)
    return () => tracks.removeEventListener('scroll', onTracksScroll)
  }, [])

  // ── Track drop ─────────────────────────────────────────────────────────────
  const [dragOverTrack, setDragOverTrack] = useState<number | null>(null)

  async function handleTrackDrop(e: React.DragEvent, trackIdx: number) {
    e.preventDefault(); setDragOverTrack(null)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    let dropTime = Math.max(0, pxToMs(e.clientX - rect.left + (containerRef.current?.scrollLeft ?? 0)))
    const { addTimelineItem, clips } = useEditorStore.getState()

    const clipId = e.dataTransfer.getData('text/x-clip-id')
    if (clipId) {
      const clip = clips.find(c => c.id === clipId)
      if (clip && clipFitsTrack(clip.type, trackIdx))
        addTimelineItem({ id: nanoid(), clipId: clip.id, trackIndex: trackIdx, startTime: dropTime, trimStart: 0, trimEnd: clip.duration })
      return
    }

    const paths = Array.from(e.dataTransfer.files).map(f => (f as any).path as string)
    if (!paths.length) return
    const imported = await importAndAddClips(paths)
    for (const clip of imported) {
      if (!clipFitsTrack(clip.type, trackIdx)) continue
      addTimelineItem({ id: nanoid(), clipId: clip.id, trackIndex: trackIdx, startTime: dropTime, trimStart: 0, trimEnd: clip.duration })
      dropTime += clip.duration
    }
  }

  function handleTrackDragOver(e: React.DragEvent, trackIdx: number) {
    const clipType = e.dataTransfer.getData('text/x-clip-type')
    if (clipType && !clipFitsTrack(clipType, trackIdx)) { e.dataTransfer.dropEffect = 'none'; return }
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverTrack(trackIdx)
  }

  function handleTrackDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverTrack(null)
  }

  const playheadLeft = msToPx(currentTime)

  return (
    <div style={styles.wrapper}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={styles.toolbarLabel}>Timeline</span>
        <div style={styles.zoomRow}>
          <button style={styles.zoomBtn} onClick={() => setZoom(zoom - 20)}>−</button>
          <span style={styles.zoomLabel}>{zoom}px/s</span>
          <button style={styles.zoomBtn} onClick={() => setZoom(zoom + 20)}>+</button>
          <button style={{ ...styles.snapBtn, ...(snapEnabled ? styles.snapActive : {}) }} onClick={() => setSnapEnabled(!snapEnabled)}>Snap</button>
        </div>
      </div>

      {/* Body: headers + scrollable content */}
      <div style={styles.body}>

        {/* ── Left header panel ───────────────────────────────────────── */}
        <div style={styles.headerPanel}>
          <div style={styles.rulerSpacer} />
          {/* Scrollable track labels — synced with tracks */}
          <div style={styles.headerScroll} ref={headerRef}>
            <div style={styles.sectionHead}>
              <span style={styles.sectionLabel}>VIDEO</span>
              <button style={styles.addTrackBtn} onClick={addVideoTrack} title="Add video track">+</button>
            </div>
            {Array.from({ length: videoTrackCount }).map((_, i) => {
              const trackIdx = videoTrackCount - 1 - i
              return (
                <div key={trackIdx} style={{ ...styles.trackHeader, height: getTrackH(trackIdx) }}>
                  <span style={styles.trackLabel}>V{trackIdx + 1}</span>
                  <div style={styles.trackResizeHandle} onMouseDown={e => onTrackResizeDown(e, trackIdx)} />
                </div>
              )
            })}
            <div style={{ ...styles.sectionHead, ...styles.sectionHeadAudio }}>
              <span style={{ ...styles.sectionLabel, color: '#2a8abf' }}>AUDIO</span>
              <button style={styles.addTrackBtn} onClick={addAudioTrack} title="Add audio track">+</button>
            </div>
            {Array.from({ length: audioTrackCount }).map((_, i) => {
              const trackIdx = videoTrackCount + i
              return (
                <div key={i} style={{ ...styles.trackHeader, height: getTrackH(trackIdx) }}>
                  <span style={{ ...styles.trackLabel, color: '#2a8abf' }}>A{i + 1}</span>
                  <div style={styles.trackResizeHandle} onMouseDown={e => onTrackResizeDown(e, trackIdx)} />
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Right: ruler (fixed) + tracks (scrollable) ───────────────── */}
        <div style={styles.timelineRight}>

          {/* Ruler — scrolls horizontally in sync, fixed vertically */}
          <div style={styles.rulerContainer} ref={rulerRef}>
            <div style={{ position: 'relative', width: msToPx(duration), height: RULER_HEIGHT }} onMouseDown={startScrub}>
              {ticks.map(t => (
                <div key={t} style={{ ...styles.tick, left: msToPx(t) }}>
                  <div style={styles.tickLine} />
                  <span style={styles.tickLabel}>{formatRulerTime(t)}</span>
                </div>
              ))}
              <div style={{ ...styles.playheadRulerLine, left: playheadLeft }} />
            </div>
          </div>

          {/* Tracks — scrolls both axes */}
          <div style={styles.tracksScroll} ref={containerRef}>
            <div style={{ position: 'relative', width: msToPx(duration), minWidth: '100%' }}>

              {/* Video tracks */}
              <div style={styles.sectionDivider}>
                <span style={styles.sectionDividerLabel}>VIDEO</span>
              </div>
              {Array.from({ length: videoTrackCount }).map((_, i) => {
                const trackIdx = videoTrackCount - 1 - i
                return (
                  <TrackRow key={trackIdx} trackIdx={trackIdx} trackHeight={getTrackH(trackIdx)} clips={clips} timelineItems={timelineItems} msToPx={msToPx}
                    dragOverTrack={dragOverTrack} onClipMouseDown={onClipMouseDown}
                    onResizeMouseDown={onResizeMouseDown} removeTimelineItem={removeTimelineItem}
                    handleTrackDrop={handleTrackDrop} handleTrackDragOver={handleTrackDragOver}
                    handleTrackDragLeave={handleTrackDragLeave} />
                )
              })}

              {/* Audio tracks */}
              <div style={{ ...styles.sectionDivider, ...styles.sectionDividerAudio }}>
                <span style={{ ...styles.sectionDividerLabel, color: '#2a8abf' }}>AUDIO</span>
              </div>
              {Array.from({ length: audioTrackCount }).map((_, i) => (
                <TrackRow key={i} trackIdx={videoTrackCount + i} trackHeight={getTrackH(videoTrackCount + i)} clips={clips} timelineItems={timelineItems} msToPx={msToPx}
                  dragOverTrack={dragOverTrack} onClipMouseDown={onClipMouseDown}
                  onResizeMouseDown={onResizeMouseDown} removeTimelineItem={removeTimelineItem}
                  handleTrackDrop={handleTrackDrop} handleTrackDragOver={handleTrackDragOver}
                  handleTrackDragLeave={handleTrackDragLeave} />
              ))}

              {/* Snap indicator */}
              {snapIndicator !== null && (
                <div style={{ ...styles.snapIndicator, left: msToPx(snapIndicator), height: totalHeight }} />
              )}

              {/* Playhead */}
              <div style={{ ...styles.playheadBar, left: playheadLeft, height: totalHeight }}>
                <div style={styles.playheadLine} />
                <div style={styles.playheadHead} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── WaveformBars ─────────────────────────────────────────────────────────────
function WaveformBars({ path, trimStart, trimEnd, duration }: {
  path: string; trimStart: number; trimEnd: number; duration: number
}) {
  const [waveform, setWaveform] = useState<number[] | null>(null)

  useEffect(() => {
    let active = true
    getWaveform(path).then(w => { if (active) setWaveform(w) }).catch(() => {})
    return () => { active = false }
  }, [path])

  if (!waveform) return null

  const startIdx = Math.floor((trimStart / duration) * waveform.length)
  const endIdx   = Math.ceil((trimEnd   / duration) * waveform.length)
  const slice    = waveform.slice(startIdx, endIdx)
  const n        = slice.length
  const svgH     = 100
  const mid      = svgH / 2
  const d        = slice.map((v, i) => {
    const h = Math.max(2, v * svgH * 0.88)
    return `M${i + 0.5},${mid - h / 2}v${h}`
  }).join(' ')

  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      viewBox={`0 0 ${n} ${svgH}`}
      preserveAspectRatio="none"
    >
      <path d={d} stroke="rgba(90,190,255,0.55)" strokeWidth="1.2" fill="none" />
    </svg>
  )
}

// ── TrackRow ────────────────────────────────────────────────────────────────
interface TrackRowProps {
  trackIdx: number
  trackHeight: number
  clips: any[]
  timelineItems: any[]
  msToPx: (ms: number) => number
  dragOverTrack: number | null
  onClipMouseDown: (e: React.MouseEvent, id: string) => void
  onResizeMouseDown: (e: React.MouseEvent, id: string, edge: 'left' | 'right') => void
  removeTimelineItem: (id: string) => void
  handleTrackDrop: (e: React.DragEvent, idx: number) => void
  handleTrackDragOver: (e: React.DragEvent, idx: number) => void
  handleTrackDragLeave: (e: React.DragEvent) => void
}

function TrackRow({ trackIdx, trackHeight, clips, timelineItems, msToPx, dragOverTrack, onClipMouseDown, onResizeMouseDown, removeTimelineItem, handleTrackDrop, handleTrackDragOver, handleTrackDragLeave }: TrackRowProps) {
  return (
    <div
      data-track={trackIdx}
      style={{ ...styles.track, height: trackHeight, ...(dragOverTrack === trackIdx ? styles.trackDragging : {}) }}
      onDrop={e => handleTrackDrop(e, trackIdx)}
      onDragOver={e => handleTrackDragOver(e, trackIdx)}
      onDragLeave={handleTrackDragLeave}
    >
      {timelineItems.filter(i => i.trackIndex === trackIdx).map(item => {
        const clip = clips.find(c => c.id === item.clipId)
        if (!clip) return null
        const bg = clip.type === 'audio' ? '#152b3d' : clip.type === 'image' ? '#2d1f0e' : '#0f2d1a'
        const border = clip.type === 'audio' ? '#2a7abf' : clip.type === 'image' ? '#bf8a2a' : '#2abf5a'
        return (
          <div
            key={item.id}
            style={{ ...styles.clip, left: msToPx(item.startTime), width: Math.max(msToPx(item.trimEnd - item.trimStart), 4), height: trackHeight - 6, background: bg, borderColor: border }}
            onMouseDown={e => onClipMouseDown(e, item.id)}
          >
            {clip.type === 'audio' && (
              <WaveformBars path={clip.path} trimStart={item.trimStart} trimEnd={item.trimEnd} duration={clip.duration} />
            )}
            <div style={styles.resizeL} onMouseDown={e => onResizeMouseDown(e, item.id, 'left')} />
            <span style={styles.clipLabel} title={clip.name}>{clip.name}</span>
            <div style={styles.resizeR} onMouseDown={e => onResizeMouseDown(e, item.id, 'right')} />
            <button style={styles.clipDel} onMouseDown={e => e.stopPropagation()} onClick={() => removeTimelineItem(item.id)}>×</button>
          </div>
        )
      })}
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  wrapper:      { display: 'flex', flexDirection: 'column', height: '100%', background: '#161616', overflow: 'hidden' },
  toolbar:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 },
  toolbarLabel: { fontSize: 12, color: '#888', fontWeight: 600 },
  zoomRow:      { display: 'flex', alignItems: 'center', gap: 6 },
  zoomBtn:      { background: '#2a2a2a', border: 'none', color: '#ccc', width: 22, height: 22, borderRadius: 4, cursor: 'pointer', fontSize: 14 },
  zoomLabel:    { fontSize: 11, color: '#666', minWidth: 50, textAlign: 'center' },
  snapBtn:      { background: '#2a2a2a', border: '1px solid #444', color: '#888', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11, marginLeft: 4 },
  snapActive:   { borderColor: '#2abf5a', color: '#2abf5a' },

  body:         { display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 },

  // Left header panel
  headerPanel:  { width: HEADER_W, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#111', borderRight: '1px solid #2a2a2a', overflowY: 'hidden' },
  rulerSpacer:  { height: RULER_HEIGHT, flexShrink: 0, borderBottom: '1px solid #2a2a2a' },
  sectionHead:  { height: SECTION_H, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px 0 8px', background: '#0e0e0e', borderBottom: '1px solid #222', flexShrink: 0 },
  sectionHeadAudio: { borderTop: '2px solid #252525' },
  sectionLabel: { fontSize: 9, fontWeight: 700, letterSpacing: 1, color: '#2abf5a' },
  addTrackBtn:  { background: 'none', border: '1px solid #333', color: '#666', width: 16, height: 16, borderRadius: 3, cursor: 'pointer', fontSize: 12, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  trackHeader:       { height: TRACK_HEIGHT, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: '1px solid #1e1e1e', background: '#121212', position: 'relative' },
  trackResizeHandle: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 5, cursor: 'ns-resize', zIndex: 5 },
  trackLabel:   { fontSize: 11, fontWeight: 700, color: '#2abf5a', letterSpacing: 0.5 },

  // Right column and scroll areas
  timelineRight:  { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  rulerContainer: { height: RULER_HEIGHT, flexShrink: 0, background: '#111', borderBottom: '1px solid #2a2a2a', overflowX: 'hidden', overflowY: 'hidden', cursor: 'pointer', userSelect: 'none' },
  tracksScroll:   { flex: 1, overflowX: 'auto', overflowY: 'auto', position: 'relative' },
  headerScroll:   { flex: 1, overflowY: 'hidden', display: 'flex', flexDirection: 'column' },

  // (legacy, unused)
  timelineArea: { flex: 1, overflowX: 'auto', overflowY: 'hidden' },
  ruler:        { height: RULER_HEIGHT, background: '#111', borderBottom: '1px solid #2a2a2a', position: 'relative', cursor: 'pointer', userSelect: 'none' },
  tick:         { position: 'absolute', top: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' },
  tickLine:     { width: 1, height: 8, background: '#3a3a3a' },
  tickLabel:    { fontSize: 10, color: '#555', marginTop: 1, whiteSpace: 'nowrap', userSelect: 'none' },
  sectionDivider:      { height: SECTION_H, background: '#0e0e0e', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', paddingLeft: 8 },
  sectionDividerAudio: { borderTop: '2px solid #252525' },
  sectionDividerLabel: { fontSize: 9, fontWeight: 700, letterSpacing: 1, color: '#2abf5a', opacity: 0.4 },
  track:        { height: TRACK_HEIGHT, borderBottom: '1px solid #1e1e1e', position: 'relative', background: '#181818', transition: 'background 0.1s' },
  trackDragging:{ background: 'rgba(42,191,90,0.07)', outline: '2px dashed #2abf5a', outlineOffset: -2 },
  clip:         { position: 'absolute', top: 3, height: TRACK_HEIGHT - 6, borderRadius: 3, border: '1px solid', overflow: 'hidden', display: 'flex', alignItems: 'center', userSelect: 'none', cursor: 'grab', minWidth: 4 },
  clipLabel:    { fontSize: 11, color: '#ccc', paddingLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, pointerEvents: 'none' },
  clipDel:      { position: 'absolute', top: 1, right: 1, background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '0 2px' },
  resizeL:      { position: 'absolute', left: 0, top: 0, width: 5, height: '100%', cursor: 'ew-resize', background: 'rgba(255,255,255,0.1)', zIndex: 2 },
  resizeR:      { position: 'absolute', right: 0, top: 0, width: 5, height: '100%', cursor: 'ew-resize', background: 'rgba(255,255,255,0.1)', zIndex: 2 },
  playheadRulerLine: { position: 'absolute', top: 0, bottom: 0, width: 2, background: '#e63950', zIndex: 10, pointerEvents: 'none' },
  snapIndicator:{ position: 'absolute', top: 0, width: 1, background: 'rgba(255,220,0,0.8)', zIndex: 9, pointerEvents: 'none' },
  playheadBar:  { position: 'absolute', top: 0, width: 16, marginLeft: -8, background: 'transparent', zIndex: 10, pointerEvents: 'none' },
  playheadLine: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, marginLeft: -1, background: '#e63950', pointerEvents: 'none' },
  playheadHead: { width: 12, height: 12, background: '#e63950', borderRadius: '50%', position: 'absolute', top: -4, left: 2, pointerEvents: 'none' },
}
