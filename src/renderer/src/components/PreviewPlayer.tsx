import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createRenderPlan,
  getRenderPlanAssets,
  getRenderPlanTimelineItems,
  type RenderPlan,
} from '../editor-core/renderPlan'
import { createPreviewEngine, type PreviewEngine } from '../media-engine/previewEngine'
import { getPreviewSourcePath, withPreviewSources } from '../media-engine/previewSource'
import { useEditorStore } from '../store/useEditorStore'
import { useShortcutsStore, matchesShortcut } from '../store/useShortcutsStore'
import type { TextOverlay, TimelineItem, MediaClip, Transform } from '../types'
import { DEFAULT_ANIMATION, DEFAULT_EFFECTS, DEFAULT_TRANSFORM } from '../types'
import { toFileUrl } from '../utils/fileUrl'
import { formatTimecode, snapToFrame, frameDurationMs } from '../utils/frame'
import { nanoid } from '../utils/nanoid'

const PREVIEW_W = 1920
const PREVIEW_H = 1080

function createPreviewPlanFromState(state: {
  clips: MediaClip[]
  timelineItems: TimelineItem[]
  textOverlays: TextOverlay[]
  fps: number
  previewQuality: ReturnType<typeof useEditorStore.getState>['previewQuality']
}): RenderPlan {
  return createRenderPlan({
    resolution: '1920x1080',
    fps: state.fps,
    timelineItems: state.timelineItems,
    clips: withPreviewSources(state.clips, state.previewQuality),
    textOverlays: state.textOverlays,
  })
}


export default function PreviewPlayer() {
  const {
    clips, timelineItems, textOverlays,
    currentTime, setCurrentTime, isPlaying, setIsPlaying,
    fps, selectedId, updateTransform, updateTimelineItem,
    hoverPreviewClip, tool, addTextOverlay, updateTextOverlay, setSelectedId,
    videoTrackCount, titleFontPreview, previewQuality, setPreviewQuality,
  } = useEditorStore()

  const previewEngineRef = useRef<PreviewEngine | null>(null)
  const isPlayingRef = useRef(isPlaying)

  const [transformMode, setTransformMode] = useState(false)
  const [focalMode, setFocalMode] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fsControlsVisible, setFsControlsVisible] = useState(true)
  const [vpWrapSize, setVpWrapSize] = useState({ w: 0, h: 0 })
  const viewportRef     = useRef<HTMLDivElement>(null)
  const viewportWrapRef = useRef<HTMLDivElement>(null)
  const containerRef    = useRef<HTMLDivElement>(null)
  const hideTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)

  const CONTROLS_H = 52

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      const availH  = height - CONTROLS_H
      const naturalH = width * 9 / 16
      if (naturalH <= availH) {
        setVpWrapSize({ w: width, h: naturalH })
      } else {
        setVpWrapSize({ w: availH * 16 / 9, h: availH })
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const previewTextOverlays = useMemo(() => {
    if (!titleFontPreview) return textOverlays
    return textOverlays.map(overlay =>
      overlay.id === titleFontPreview.overlayId
        ? { ...overlay, fontFamily: titleFontPreview.fontFamily }
        : overlay
    )
  }, [textOverlays, titleFontPreview])

  const renderPlan = useMemo(
    () => createPreviewPlanFromState({ clips, timelineItems, textOverlays: previewTextOverlays, fps, previewQuality }),
    [clips, timelineItems, previewTextOverlays, fps, previewQuality]
  )
  const previewTimelineItems = useMemo(() => getRenderPlanTimelineItems(renderPlan), [renderPlan])
  const previewClips = useMemo(() => getRenderPlanAssets(renderPlan), [renderPlan])
  const latestRenderPlanRef = useRef(renderPlan)
  const selectedItem = selectedId ? previewTimelineItems.find(i => i.id === selectedId) ?? null : null
  const selectedClip = selectedItem ? previewClips.find(c => c.id === selectedItem.clipId) ?? null : null
  const selectedOverlay = selectedId ? textOverlays.find(o => o.id === selectedId) ?? null : null
  const visibleSelectedOverlay = selectedOverlay && currentTime >= selectedOverlay.startTime && currentTime < selectedOverlay.endTime
    ? selectedOverlay
    : null
  const selectedHasKB = !!(selectedItem?.kenBurns)
  const hasPreviewContent = previewTimelineItems.length > 0 || textOverlays.length > 0

  // Exit focal mode automatically when selection changes or KB is removed
  useEffect(() => { if (!selectedHasKB) setFocalMode(false) }, [selectedHasKB])

  // Track fullscreen state
  useEffect(() => {
    function onFsChange() {
      const fs = !!document.fullscreenElement
      setIsFullscreen(fs)
      setFsControlsVisible(true)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      if (fs) hideTimerRef.current = setTimeout(() => setFsControlsVisible(false), 3000)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  function onFsMouseMove() {
    if (!isFullscreen) return
    setFsControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setFsControlsVisible(false), 3000)
  }

  function handleFocalPointer(e: React.MouseEvent<HTMLDivElement>) {
    if (!viewportRef.current || !selectedItem?.kenBurns) return
    const r = viewportRef.current.getBoundingClientRect()
    const x = Math.round(Math.max(0, Math.min(100, (e.clientX - r.left) / r.width  * 100)) * 10) / 10
    const y = Math.round(Math.max(0, Math.min(100, (e.clientY - r.top)  / r.height * 100)) * 10) / 10
    updateTimelineItem(selectedItem.id, { kenBurns: { ...selectedItem.kenBurns, focalX: x, focalY: y } })
  }

  function canvasPointFromEvent(e: React.MouseEvent<HTMLDivElement>) {
    if (!viewportRef.current) return null
    const rect = viewportRef.current.getBoundingClientRect()
    return {
      x: Math.round(Math.max(0, Math.min(PREVIEW_W, (e.clientX - rect.left) / rect.width * PREVIEW_W))),
      y: Math.round(Math.max(0, Math.min(PREVIEW_H, (e.clientY - rect.top) / rect.height * PREVIEW_H))),
    }
  }

  function addTextAtPreviewPoint(e: React.MouseEvent<HTMLDivElement>) {
    if (tool !== 'text') return
    if ((e.target as HTMLElement).closest('[data-text-handle]')) return
    const point = canvasPointFromEvent(e)
    if (!point) return
    e.preventDefault()
    const id = nanoid()
    addTextOverlay({
      id,
      text: 'Sample Text',
      fontFamily: 'sans-serif',
      fontSize: 48,
      color: '#ffffff',
      x: point.x,
      y: point.y,
      trackIndex: Math.max(0, videoTrackCount - 1),
      startTime: currentTime,
      endTime: currentTime + 3000,
      bold: false,
      italic: false,
      transform: { ...DEFAULT_TRANSFORM },
      effects: { ...DEFAULT_EFFECTS },
      animation: { ...DEFAULT_ANIMATION },
    })
    setSelectedId(id)
  }

  const duration = renderPlan.durationMs

  const setPreviewCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    previewEngineRef.current?.dispose()
    previewEngineRef.current = null
    if (!canvas) return

    const engine = createPreviewEngine({
      canvas,
      width: PREVIEW_W,
      height: PREVIEW_H,
      onTimeUpdate: (timeMs) => useEditorStore.getState().setCurrentTime(timeMs),
      onEnded: () => {
        const store = useEditorStore.getState()
        store.setIsPlaying(false)
        store.setCurrentTime(0)
      },
    })
    const state = useEditorStore.getState()
    engine.setPlan(latestRenderPlanRef.current)
    engine.seek(state.currentTime)
    previewEngineRef.current = engine
  }, [])

  useEffect(() => {
    latestRenderPlanRef.current = renderPlan
    previewEngineRef.current?.setPlan(renderPlan)
    const state = useEditorStore.getState()
    if (!state.isPlaying) previewEngineRef.current?.seek(state.currentTime)
  }, [renderPlan])

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    if (!isPlayingRef.current) previewEngineRef.current?.seek(currentTime)
  }, [currentTime])

  useEffect(() => {
    if (!isPlaying) {
      previewEngineRef.current?.pause()
      return
    }

    previewEngineRef.current?.play(currentTime)
    return () => previewEngineRef.current?.pause()
  }, [isPlaying])

  // ── Fullscreen shortcut ───────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { shortcuts } = useShortcutsStore.getState()
      const sc = shortcuts.find(s => s.id === 'fullscreen_preview')
      if (!sc || !matchesShortcut(e, sc)) return
      e.preventDefault()
      const wrap = viewportWrapRef.current
      if (!wrap) return
      if (document.fullscreenElement) document.exitFullscreen()
      else wrap.requestFullscreen()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function togglePlay() {
    if (!hasPreviewContent) return
    setIsPlaying(!isPlaying)
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    setIsPlaying(false)
    setCurrentTime(snapToFrame(parseFloat(e.target.value), useEditorStore.getState().fps))
  }

  return (
    <div style={styles.container} ref={containerRef}>
      <div
        style={{
          ...styles.viewportWrap,
          ...(isFullscreen
            ? { flex: 1 }
            : vpWrapSize.w > 0 ? { width: vpWrapSize.w, height: vpWrapSize.h } : { flex: 1 }
          ),
          cursor: isFullscreen && !fsControlsVisible ? 'none' : 'default',
        }}
        ref={viewportWrapRef}
        onMouseMove={onFsMouseMove}
      >
        <div
          style={{ ...styles.viewport, ...(isFullscreen ? { aspectRatio: '16/9', height: '100%', width: 'auto', maxWidth: '100%' } : {}) }}
          ref={viewportRef}
          onMouseDown={addTextAtPreviewPoint}
        >
          {!hasPreviewContent ? (
            <div style={styles.empty}>Drop clips to the timeline to preview</div>
          ) : (
            <>
              <canvas
                ref={setPreviewCanvas}
                width={PREVIEW_W}
                height={PREVIEW_H}
                style={styles.previewCanvas}
              />
              {transformMode && selectedItem && selectedClip && selectedClip.type !== 'audio' && (
                <TransformOverlay item={selectedItem} viewportEl={viewportRef.current} onUpdate={c => updateTransform(selectedItem.id, c)} />
              )}

              {visibleSelectedOverlay && (
                <TextOverlayHandle
                  overlay={visibleSelectedOverlay}
                  viewportEl={viewportRef.current}
                  onUpdate={changes => updateTextOverlay(visibleSelectedOverlay.id, changes)}
                />
              )}

              {focalMode && selectedItem?.kenBurns && (() => {
                const fx = selectedItem.kenBurns.focalX ?? 50
                const fy = selectedItem.kenBurns.focalY ?? 50
                return (
                  <div
                    style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 20 }}
                    onMouseDown={handleFocalPointer}
                    onMouseMove={e => { if (e.buttons === 1) handleFocalPointer(e) }}
                  >
                    {/* Crosshair lines */}
                    <div style={{ position: 'absolute', left: `${fx}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: `${fy}%`, left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }} />
                    {/* Focal dot */}
                    <div style={{
                      position: 'absolute', left: `${fx}%`, top: `${fy}%`,
                      transform: 'translate(-50%, -50%)',
                      width: 14, height: 14, borderRadius: '50%',
                      background: '#4af', border: '2px solid #fff',
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
                      pointerEvents: 'none',
                    }} />
                  </div>
                )
              })()}
            </>
          )}

          {/* Hover preview from media bin */}
          {hoverPreviewClip && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: '#000' }}>
              {hoverPreviewClip.type === 'video' && (
                <video
                  key={hoverPreviewClip.id}
                  src={toFileUrl(getPreviewSourcePath(hoverPreviewClip, previewQuality))}
                  autoPlay muted loop
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              )}
              {hoverPreviewClip.type === 'image' && (
                <img
                  src={toFileUrl(hoverPreviewClip.thumbnail ?? hoverPreviewClip.path)}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              )}
              {hoverPreviewClip.type === 'solid' && (
                <div style={{ width: '100%', height: '100%', background: hoverPreviewClip.color ?? '#000' }} />
              )}
              {hoverPreviewClip.type === 'audio' && (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <span style={{ fontSize: 40, color: '#444' }}>♫</span>
                  <span style={{ fontSize: 12, color: '#555', maxWidth: '80%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hoverPreviewClip.name}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fullscreen overlay controls */}
        {isFullscreen && (
          <div style={{ ...styles.fsControls, opacity: fsControlsVisible ? 1 : 0 }}>
            <div style={styles.fsSeekRow}>
              <span style={styles.fsTime}>{formatTimecode(currentTime, fps)}</span>
              <input
                type="range" min={0} max={duration || 1} step={frameDurationMs(fps)} value={currentTime}
                onChange={handleSeek} style={styles.fsSeekBar}
              />
              <span style={styles.fsTime}>{formatTimecode(duration, fps)}</span>
            </div>
            <div style={styles.fsBtnRow}>
              <button style={styles.fsBtn} onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button
                style={styles.fsBtn}
                onClick={() => { setIsPlaying(false); setCurrentTime(0) }}
                title="Stop"
              >⏹</button>
              <div style={{ flex: 1 }} />
              <button
                style={styles.fsBtn}
                onClick={() => document.exitFullscreen()}
                title="Exit fullscreen (Esc)"
              >⛶</button>
            </div>
          </div>
        )}
      </div>

      <div style={styles.controls}>
        <button style={styles.playBtn} onClick={togglePlay}>{isPlaying ? '⏸' : '▶'}</button>
        <span style={styles.time}>{formatTimecode(currentTime, fps)}</span>
        <input
          type="range" min={0} max={duration || 1} step={frameDurationMs(fps)} value={currentTime}
          onChange={handleSeek} style={styles.seekBar}
        />
        <span style={styles.time}>{formatTimecode(duration, fps)}</span>
        <button
          onClick={() => { setTransformMode(m => !m); setFocalMode(false) }}
          style={{ ...styles.transformToggle, ...(transformMode ? styles.transformToggleOn : {}) }}
          title="Toggle transform handles"
        >⊹</button>
        {selectedHasKB && (
          <button
            onClick={() => { setFocalMode(m => !m); setTransformMode(false) }}
            style={{ ...styles.transformToggle, ...(focalMode ? styles.transformToggleOn : {}), fontSize: 16 }}
            title="Set Ken Burns focal point"
          >◎</button>
        )}
        <select
          style={styles.qualitySelect}
          value={previewQuality}
          onChange={e => setPreviewQuality(e.target.value as typeof previewQuality)}
          title="Preview source quality"
        >
          <option value="auto">Auto proxy</option>
          <option value="proxy-720p">Proxy 720p</option>
          <option value="original">Original</option>
        </select>
      </div>
    </div>
  )
}

// Text/title overlay handle
function TextOverlayHandle({ overlay, viewportEl, onUpdate }: {
  overlay: TextOverlay
  viewportEl: HTMLDivElement | null
  onUpdate: (changes: Partial<TextOverlay>) => void
}) {
  const transform = { ...DEFAULT_TRANSFORM, ...overlay.transform }
  const textLines = overlay.text.split('\n')
  const longestLine = textLines.reduce((max, line) => Math.max(max, line.length), 1)
  const boxWidth = Math.max(80, longestLine * overlay.fontSize * 0.58) * Math.max(0.01, Math.abs(transform.scaleX))
  const boxHeight = Math.max(overlay.fontSize * 1.25, textLines.length * overlay.fontSize * 1.25) * Math.max(0.01, Math.abs(transform.scaleY))
  const displayX = overlay.x + transform.posX / 100 * PREVIEW_W
  const displayY = overlay.y + transform.posY / 100 * PREVIEW_H

  function startMove(e: React.MouseEvent) {
    const viewport = viewportEl?.getBoundingClientRect()
    if (!viewport) return
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const originX = overlay.x
    const originY = overlay.y

    function onMove(ev: MouseEvent) {
      onUpdate({
        x: Math.round(Math.max(0, Math.min(PREVIEW_W, originX + (ev.clientX - startX) / viewport.width * PREVIEW_W))),
        y: Math.round(Math.max(0, Math.min(PREVIEW_H, originY + (ev.clientY - startY) / viewport.height * PREVIEW_H))),
      })
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      data-text-handle
      style={{
        position: 'absolute',
        left: `${displayX / PREVIEW_W * 100}%`,
        top: `${displayY / PREVIEW_H * 100}%`,
        width: `${boxWidth / PREVIEW_W * 100}%`,
        height: `${boxHeight / PREVIEW_H * 100}%`,
        transform: `rotate(${transform.rotation}deg)`,
        transformOrigin: `${transform.anchorX * 100}% ${transform.anchorY * 100}%`,
        minWidth: 28,
        minHeight: 18,
        border: '1.5px solid rgba(139,92,246,0.95)',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(255,255,255,0.18)',
        cursor: 'move',
        zIndex: 22,
        pointerEvents: 'all',
      }}
      onMouseDown={startMove}
      title="Drag title"
    >
      <div style={{ position: 'absolute', top: -18, left: 0, fontSize: 10, color: '#d7c4ff', background: 'rgba(0,0,0,0.7)', padding: '2px 5px', borderRadius: 3, pointerEvents: 'none' }}>TITLE</div>
    </div>
  )
}

// ── Transform overlay ─────────────────────────────────────────────────────────
function TransformOverlay({ item, viewportEl, onUpdate }: {
  item: TimelineItem
  viewportEl: HTMLDivElement | null
  onUpdate: (c: Partial<Transform>) => void
}) {
  const t = { ...DEFAULT_TRANSFORM, ...item.transform }

  function getVp() { return viewportEl?.getBoundingClientRect() ?? null }

  function getPivot() {
    const vp = getVp(); if (!vp) return { x: 0, y: 0 }
    return {
      x: vp.left + (t.anchorX + t.posX / 100) * vp.width,
      y: vp.top  + (t.anchorY + t.posY / 100) * vp.height,
    }
  }

  function drag(e: React.MouseEvent, onMove: (ev: MouseEvent) => void) {
    e.preventDefault(); e.stopPropagation()
    const up = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', up)
  }

  function startMove(e: React.MouseEvent) {
    const vp = getVp(); if (!vp) return
    const startX = e.clientX, startY = e.clientY, p0X = t.posX, p0Y = t.posY
    drag(e, ev => onUpdate({
      posX: p0X + (ev.clientX - startX) / vp.width  * 100,
      posY: p0Y + (ev.clientY - startY) / vp.height * 100,
    }))
  }

  function startScale(e: React.MouseEvent) {
    const pivot = getPivot()
    const d0 = Math.hypot(e.clientX - pivot.x, e.clientY - pivot.y)
    if (d0 < 1) return
    const sx0 = t.scaleX, sy0 = t.scaleY
    drag(e, ev => {
      const f = Math.hypot(ev.clientX - pivot.x, ev.clientY - pivot.y) / d0
      onUpdate({ scaleX: Math.max(0.01, sx0 * f), scaleY: Math.max(0.01, sy0 * f) })
    })
  }

  function startRotate(e: React.MouseEvent) {
    const pivot = getPivot()
    const a0 = Math.atan2(e.clientY - pivot.y, e.clientX - pivot.x), r0 = t.rotation
    drag(e, ev => {
      const a = Math.atan2(ev.clientY - pivot.y, ev.clientX - pivot.x)
      let rot = r0 + (a - a0) * 180 / Math.PI
      if (ev.shiftKey) rot = Math.round(rot / 15) * 15
      onUpdate({ rotation: rot })
    })
  }

  function startAnchor(e: React.MouseEvent) {
    const vp = getVp(); if (!vp) return
    drag(e, ev => onUpdate({
      anchorX: Math.max(0, Math.min(1, (ev.clientX - vp.left) / vp.width  - t.posX / 100)),
      anchorY: Math.max(0, Math.min(1, (ev.clientY - vp.top)  / vp.height - t.posY / 100)),
    }))
  }

  const sx = t.scaleX * (t.flipH ? -1 : 1)
  const sy = t.scaleY * (t.flipV ? -1 : 1)
  const boxStyle: React.CSSProperties = {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    transform: `translate(${t.posX}%, ${t.posY}%) rotate(${t.rotation}deg) rotateX(${t.pitch}deg) rotateY(${t.yaw}deg) scale(${sx}, ${sy})`,
    transformOrigin: `${t.anchorX * 100}% ${t.anchorY * 100}%`,
    transformStyle: 'preserve-3d',
    backfaceVisibility: 'hidden',
  }

  const H = 9
  const corners: { pos: 'tl'|'tr'|'bl'|'br'; cur: string }[] = [
    { pos: 'tl', cur: 'nwse-resize' }, { pos: 'tr', cur: 'nesw-resize' },
    { pos: 'bl', cur: 'nesw-resize' }, { pos: 'br', cur: 'nwse-resize' },
  ]

  return (
    <>
      <div style={boxStyle}>
        <div style={{ position: 'absolute', inset: 0, cursor: 'move', pointerEvents: 'all' }} onMouseDown={startMove} />
        <div style={{ position: 'absolute', inset: 0, border: '1.5px solid rgba(255,255,255,0.85)', pointerEvents: 'none' }} />
        {corners.map(({ pos, cur }) => (
          <div key={pos} onMouseDown={startScale} style={{
            position: 'absolute', pointerEvents: 'all', cursor: cur,
            width: H, height: H, background: '#fff', border: '1px solid rgba(0,0,0,0.4)', borderRadius: 2,
            top: pos[0] === 't' ? -H/2 : undefined, bottom: pos[0] === 'b' ? -H/2 : undefined,
            left: pos[1] === 'l' ? -H/2 : undefined, right: pos[1] === 'r' ? -H/2 : undefined,
          }} />
        ))}
        <div style={{ position: 'absolute', top: -34, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.7)' }} />
          <div onMouseDown={startRotate} style={{ width: 13, height: 13, borderRadius: '50%', background: '#fff', border: '1px solid rgba(0,0,0,0.4)', cursor: 'crosshair', pointerEvents: 'all', marginTop: -1 }} />
        </div>
      </div>
      <div
        onMouseDown={startAnchor}
        title="Drag to move anchor point"
        style={{
          position: 'absolute', cursor: 'crosshair', pointerEvents: 'all', zIndex: 20,
          left: `calc(${(t.anchorX + t.posX / 100) * 100}% - 8px)`,
          top:  `calc(${(t.anchorY + t.posY / 100) * 100}% - 8px)`,
        }}
      >
        <svg width="16" height="16">
          <circle cx="8" cy="8" r="4.5" fill="none" stroke="#fff" strokeWidth="1.5" />
          <line x1="8" y1="1" x2="8" y2="15" stroke="#fff" strokeWidth="1.5" />
          <line x1="1" y1="8" x2="15" y2="8" stroke="#fff" strokeWidth="1.5" />
        </svg>
      </div>
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container:    { display: 'flex', flexDirection: 'column', height: '100%', background: '#111', alignItems: 'center' },
  viewportWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#1a1a1a', position: 'relative', flexShrink: 0 },
  viewport:     { position: 'relative', background: '#000', width: '100%', height: '100%', perspective: '800px', perspectiveOrigin: '50% 50%', transformStyle: 'preserve-3d', overflow: 'hidden' },
  previewCanvas: { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' },
  empty:        { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 14 },
  controls:     { height: 52, width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderTop: '1px solid #2a2a2a', flexShrink: 0 },
  playBtn:      { background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', width: 32 },
  time:         { fontSize: 13, color: '#888', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  seekBar:           { flex: 1, accentColor: '#e63950', cursor: 'pointer', height: 20 },
  transformToggle:   { background: 'none', border: '1px solid #333', color: '#555', fontSize: 18, width: 30, height: 30, borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  transformToggleOn: { borderColor: '#e63950', color: '#e63950', background: 'rgba(230,57,80,0.1)' },
  qualitySelect:     { background: '#181818', border: '1px solid #333', color: '#888', borderRadius: 5, padding: '5px 7px', fontSize: 11, outline: 'none', flexShrink: 0 },

  fsControls: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 20px 16px', background: 'linear-gradient(transparent, rgba(0,0,0,0.85))', transition: 'opacity 0.3s', zIndex: 30, pointerEvents: 'all' },
  fsSeekRow:  { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 },
  fsBtnRow:   { display: 'flex', alignItems: 'center', gap: 8 },
  fsSeekBar:  { flex: 1, accentColor: '#e63950', cursor: 'pointer', height: 4 },
  fsTime:     { fontSize: 14, color: '#ddd', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minWidth: 60, textAlign: 'center' },
  fsBtn:      { background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: '4px 8px', lineHeight: 1, opacity: 0.9 },
}
