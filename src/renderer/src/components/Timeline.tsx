import { useRef, useCallback, useEffect, useLayoutEffect, useState, Fragment } from 'react'
import { useEditorStore } from '../store/useEditorStore'
import { useShortcutsStore } from '../store/useShortcutsStore'
import type { TextOverlay, TransitionType } from '../types'
import { DEFAULT_TRANSITION, DEFAULT_KEN_BURNS } from '../types'
import { importAndAddClips } from '../utils/importClip'
import { nanoid } from '../utils/nanoid'
import { getWaveform, selectWaveformLevel, type WaveformData, type WaveformLevel } from '../utils/waveform'
import { snapToFrame, frameDurationMs } from '../utils/frame'
import { allKeyframeTimes } from '../utils/keyframes'

const TRANSITION_TYPES: Array<{ type: TransitionType | 'cut'; label: string }> = [
  { type: 'cut',        label: 'Cut'       },
  { type: 'crossfade',  label: 'Crossfade' },
  { type: 'fade-color', label: 'Fade ◻'   },
  { type: 'wipe-left',  label: '← Wipe'   },
  { type: 'wipe-right', label: 'Wipe →'   },
  { type: 'wipe-up',    label: '↑ Wipe'   },
  { type: 'wipe-down',  label: '↓ Wipe'   },
]

const TRACK_HEIGHT = 44
const RULER_HEIGHT = 24
const SECTION_H = 22
const HEADER_W = 72
const SNAP_PX = 8
const PLAYHEAD_SCROLL_MARGIN_PX = 72

function formatRulerTime(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`
}

export default function Timeline() {
  const {
    clips, timelineItems, textOverlays, removeTimelineItem, updateTimelineItem, updateTransition,
    updateTextOverlay, removeTextOverlay,
    currentTime, setCurrentTime, setIsPlaying,
    tool, zoom, setZoom, getTimelineDuration,
    videoTrackCount, audioTrackCount, addVideoTrack, addAudioTrack,
    selectedId, setSelectedId, fps,
  } = useEditorStore()

  const [transitionPopup, setTransitionPopup] = useState<{ itemId: string; rect: DOMRect } | null>(null)

  function openTransitionPopup(itemId: string, rect: DOMRect) {
    setTransitionPopup({ itemId, rect })
  }

  const containerRef    = useRef<HTMLDivElement>(null)   // tracks scroll area
  const rulerRef        = useRef<HTMLDivElement>(null)   // ruler scroll area (horiz only)
  const headerRef       = useRef<HTMLDivElement>(null)   // header scroll area (vert only)
  const wrapperRef      = useRef<HTMLDivElement>(null)   // outermost timeline div
  const pendingScrollRef = useRef<number | null>(null)   // scroll target after zoom render

  // Apply any pending scroll correction after the zoom-triggered render so
  // the content has already resized before we set scrollLeft.
  useLayoutEffect(() => {
    if (pendingScrollRef.current !== null && containerRef.current) {
      containerRef.current.scrollLeft = pendingScrollRef.current
      pendingScrollRef.current = null
    }
  })

  // Zoom anchored to the playhead: keep currentTime at the same screen X.
  function applyZoom(newZ: number) {
    const { zoom: oldZ, setZoom, currentTime } = useEditorStore.getState()
    const clamped = Math.max(10, Math.min(2000, newZ))
    if (containerRef.current) {
      pendingScrollRef.current = containerRef.current.scrollLeft + currentTime * (clamped - oldZ) / 1000
    }
    setZoom(clamped)
  }
  const duration = Math.max(getTimelineDuration() + 5000, 30000)
  const pxPerMs = zoom / 1000

  const msToPx = (ms: number) => ms * pxPerMs
  const pxToMs = (px: number) => px / pxPerMs

  const [trayOpen, setTrayOpen] = useState(true)

  const [trackHeights, setTrackHeights] = useState<Record<number, number>>(() => {
    try { return JSON.parse(localStorage.getItem('layout:trackHeights') ?? '{}') } catch { return {} }
  })
  function getTrackH(idx: number) { return trackHeights[idx] ?? TRACK_HEIGHT }
  useEffect(() => { localStorage.setItem('layout:trackHeights', JSON.stringify(trackHeights)) }, [trackHeights])

  const totalTracks = videoTrackCount + audioTrackCount
  let totalHeight = SECTION_H * 2
  for (let i = 0; i < totalTracks; i++) totalHeight += getTrackH(i)

  function isAudioTrack(idx: number) { return idx >= videoTrackCount }
  function clipFitsTrack(clipType: string, idx: number) {
    return isAudioTrack(idx) ? clipType === 'audio' : clipType !== 'audio'
  }
  function textFitsTrack(idx: number) { return idx >= 0 && idx < videoTrackCount }

  // Ruler ticks — second-level major ticks + frame-level minor ticks when zoomed in
  const tickInterval = zoom < 50 ? 10000 : zoom < 120 ? 5000 : zoom < 300 ? 2000 : 1000
  const ticks: number[] = []
  for (let t = 0; t <= duration; t += tickInterval) ticks.push(t)

  const framePx = zoom / fps                     // px per frame
  const showFrameTicks = framePx >= 6            // only when frames are visible
  const frameTicks: number[] = []
  if (showFrameTicks) {
    const fDur = frameDurationMs(fps)
    const maxFrameTicks = Math.ceil(duration / fDur)
    if (maxFrameTicks <= 4000) {
      for (let f = 0; f * fDur <= duration; f++) frameTicks.push(f * fDur)
    }
  }

  // ── Snapping ───────────────────────────────────────────────────────────────
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [snapIndicator, setSnapIndicator] = useState<number | null>(null)

  function getSnapPoints(excludeId: string) {
    const pts = [0, currentTime]
    for (const item of timelineItems) {
      if (item.id === excludeId) continue
      pts.push(item.startTime, item.startTime + (item.trimEnd - item.trimStart))
    }
    for (const overlay of textOverlays) {
      if (overlay.id === excludeId) continue
      pts.push(overlay.startTime, overlay.endTime)
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
    const { timelineItems: items, addTimelineItem } = useEditorStore.getState()
    const item = items.find(i => i.id === itemId)!
    let dragId = itemId
    if (e.altKey) {
      const newId = nanoid()
      addTimelineItem({ ...item, id: newId })
      dragId = newId
      setSelectedId(newId)
      document.body.style.cursor = 'copy'
    } else {
      setSelectedId(itemId)
    }
    dragState.current = { id: dragId, startX: e.clientX, origStart: item.startTime, origTrack: item.trackIndex }
  }

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.current) return
    const { id, startX, origStart, origTrack } = dragState.current
    const { fps: curFps } = useEditorStore.getState()
    const rawStart = snapToFrame(Math.max(0, origStart + pxToMs(e.clientX - startX)), curFps)
    const snapped = trySnap(rawStart, id)
    const trackEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-track]') as HTMLElement | null
    const candidate = trackEl ? parseInt(trackEl.dataset.track!) : origTrack
    const item = useEditorStore.getState().timelineItems.find(i => i.id === id)
    const clip = item ? useEditorStore.getState().clips.find(c => c.id === item.clipId) : null
    const newTrack = clip && !clipFitsTrack(clip.type, candidate) ? origTrack : candidate
    useEditorStore.getState().moveTimelineItem(id, snapped, newTrack)
  }, [pxPerMs, snapEnabled, timelineItems, currentTime, videoTrackCount])

  const onMouseUp = useCallback(() => { dragState.current = null; setSnapIndicator(null); document.body.style.cursor = '' }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [onMouseMove, onMouseUp])

  // ── Resize ─────────────────────────────────────────────────────────────────
  const resizeState = useRef<{
    id: string; edge: 'left' | 'right'; startX: number
    origTrimStart: number; origTrimEnd: number; origItemStart: number
    adjId: string | null; adjClipId: string | null
    origAdjTrimStart: number; origAdjTrimEnd: number; origAdjItemStart: number
  } | null>(null)

  function onResizeMouseDown(e: React.MouseEvent, itemId: string, edge: 'left' | 'right') {
    e.preventDefault(); e.stopPropagation()
    const { timelineItems: items } = useEditorStore.getState()
    const item = items.find(i => i.id === itemId)!
    const itemEnd = item.startTime + (item.trimEnd - item.trimStart)

    // Find the immediately adjacent clip to link with
    const adj = items.find(i => {
      if (i.id === itemId || i.trackIndex !== item.trackIndex) return false
      if (edge === 'right') return Math.abs(i.startTime - itemEnd) < 50
      return Math.abs((i.startTime + (i.trimEnd - i.trimStart)) - item.startTime) < 50
    }) ?? null

    resizeState.current = {
      id: itemId, edge, startX: e.clientX,
      origTrimStart: item.trimStart, origTrimEnd: item.trimEnd, origItemStart: item.startTime,
      adjId: adj?.id ?? null, adjClipId: adj?.clipId ?? null,
      origAdjTrimStart: adj?.trimStart ?? 0, origAdjTrimEnd: adj?.trimEnd ?? 0, origAdjItemStart: adj?.startTime ?? 0,
    }
  }

  const onResizeMove = useCallback((e: MouseEvent) => {
    if (!resizeState.current) return
    const { id, edge, startX, origTrimStart, origTrimEnd, origItemStart,
            adjId, adjClipId, origAdjTrimStart, origAdjTrimEnd, origAdjItemStart } = resizeState.current
    const { fps: curFps, clips: allClips } = useEditorStore.getState()
    const minDur = frameDurationMs(curFps)
    const dx = pxToMs(e.clientX - startX)
    const item = timelineItems.find(i => i.id === id)
    if (!item) return
    const clip = allClips.find(c => c.id === item.clipId)
    if (!clip) return

    if (edge === 'right') {
      // Desired new timeline end for this clip
      let newEnd = item.startTime + Math.min(
        clip.duration - origTrimStart,
        Math.max(minDur, origTrimEnd - origTrimStart + dx),
      )
      // Clamp: adjacent clip's trimStart must stay in [0, origAdjTrimEnd - minDur]
      if (adjId) {
        newEnd = Math.min(newEnd, origAdjItemStart + (origAdjTrimEnd - minDur - origAdjTrimStart))
        newEnd = Math.max(newEnd, origAdjItemStart - origAdjTrimStart) // adj trimStart >= 0
      }
      const snappedEnd = trySnap(snapToFrame(newEnd, curFps), id)
      updateTimelineItem(id, { trimEnd: origTrimStart + Math.max(minDur, snappedEnd - item.startTime) })
      if (adjId) {
        updateTimelineItem(adjId, {
          startTime: snappedEnd,
          trimStart: origAdjTrimStart + (snappedEnd - origAdjItemStart),
        })
      }
    } else {
      const adjClip = adjClipId ? allClips.find(c => c.id === adjClipId) : null
      // Desired new timeline start for this clip
      let newStart = origItemStart + dx
      // Clamp: adjacent clip's trimEnd must stay in [origAdjTrimStart + minDur, adjClip.duration]
      if (adjId) {
        newStart = Math.max(newStart, origAdjItemStart + minDur) // adj keeps ≥1 frame
        if (adjClip) newStart = Math.min(newStart, origAdjItemStart + (adjClip.duration - origAdjTrimStart))
      }
      newStart = Math.max(0, newStart)
      const snappedStart = trySnap(snapToFrame(newStart, curFps), id)
      const delta = snappedStart - origItemStart
      const newTrimStart = Math.max(0, Math.min(origTrimEnd - minDur, origTrimStart + delta))
      const actualStart = origItemStart + (newTrimStart - origTrimStart)
      updateTimelineItem(id, { trimStart: newTrimStart, startTime: actualStart })
      if (adjId) {
        updateTimelineItem(adjId, { trimEnd: origAdjTrimStart + (actualStart - origAdjItemStart) })
      }
    }
  }, [pxPerMs, timelineItems, snapEnabled, currentTime])

  const onResizeUp = useCallback(() => { resizeState.current = null; setSnapIndicator(null) }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onResizeMove)
    window.addEventListener('mouseup', onResizeUp)
    return () => { window.removeEventListener('mousemove', onResizeMove); window.removeEventListener('mouseup', onResizeUp) }
  }, [onResizeMove, onResizeUp])

  const textDragState = useRef<{ id: string; startX: number; origStart: number; origEnd: number; origTrack: number } | null>(null)
  const textResizeState = useRef<{ id: string; edge: 'left' | 'right'; startX: number; origStart: number; origEnd: number } | null>(null)

  function onTextMouseDown(e: React.MouseEvent, overlayId: string) {
    e.preventDefault(); e.stopPropagation()
    const overlay = useEditorStore.getState().textOverlays.find(o => o.id === overlayId)
    if (!overlay) return
    setSelectedId(overlayId)
    textDragState.current = {
      id: overlayId,
      startX: e.clientX,
      origStart: overlay.startTime,
      origEnd: overlay.endTime,
      origTrack: overlay.trackIndex,
    }
  }

  function onTextResizeMouseDown(e: React.MouseEvent, overlayId: string, edge: 'left' | 'right') {
    e.preventDefault(); e.stopPropagation()
    const overlay = useEditorStore.getState().textOverlays.find(o => o.id === overlayId)
    if (!overlay) return
    setSelectedId(overlayId)
    textResizeState.current = {
      id: overlayId,
      edge,
      startX: e.clientX,
      origStart: overlay.startTime,
      origEnd: overlay.endTime,
    }
  }

  const onTextMove = useCallback((e: MouseEvent) => {
    if (!textDragState.current) return
    const { id, startX, origStart, origEnd, origTrack } = textDragState.current
    const { fps: curFps } = useEditorStore.getState()
    const durationMs = Math.max(frameDurationMs(curFps), origEnd - origStart)
    const rawStart = snapToFrame(Math.max(0, origStart + pxToMs(e.clientX - startX)), curFps)
    const snappedStart = trySnap(rawStart, id)
    const trackEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-track]') as HTMLElement | null
    const candidate = trackEl ? parseInt(trackEl.dataset.track!) : origTrack
    const newTrack = textFitsTrack(candidate) ? candidate : origTrack

    updateTextOverlay(id, {
      startTime: snappedStart,
      endTime: snappedStart + durationMs,
      trackIndex: newTrack,
    })
  }, [pxPerMs, snapEnabled, currentTime, videoTrackCount, textOverlays])

  const onTextResizeMove = useCallback((e: MouseEvent) => {
    if (!textResizeState.current) return
    const { id, edge, startX, origStart, origEnd } = textResizeState.current
    const { fps: curFps } = useEditorStore.getState()
    const minDur = frameDurationMs(curFps)
    const dx = pxToMs(e.clientX - startX)

    if (edge === 'left') {
      const rawStart = snapToFrame(Math.max(0, Math.min(origEnd - minDur, origStart + dx)), curFps)
      const snappedStart = Math.min(origEnd - minDur, trySnap(rawStart, id))
      updateTextOverlay(id, { startTime: snappedStart })
    } else {
      const rawEnd = snapToFrame(Math.max(origStart + minDur, origEnd + dx), curFps)
      const snappedEnd = Math.max(origStart + minDur, trySnap(rawEnd, id))
      updateTextOverlay(id, { endTime: snappedEnd })
    }
  }, [pxPerMs, snapEnabled, currentTime])

  const onTextUp = useCallback(() => {
    textDragState.current = null
    textResizeState.current = null
    setSnapIndicator(null)
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onTextMove)
    window.addEventListener('mousemove', onTextResizeMove)
    window.addEventListener('mouseup', onTextUp)
    return () => {
      window.removeEventListener('mousemove', onTextMove)
      window.removeEventListener('mousemove', onTextResizeMove)
      window.removeEventListener('mouseup', onTextUp)
    }
  }, [onTextMove, onTextResizeMove, onTextUp])

  // ── Scrubbing ──────────────────────────────────────────────────────────────
  const scrubbing = useRef(false)
  const pendingScrubX = useRef<number | null>(null)
  const scrubRaf = useRef<number | null>(null)

  function startScrub(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    scrubbing.current = true
    setIsPlaying(false)
    document.body.style.cursor = 'ew-resize'
    seekToX(e.clientX)
  }

  function seekToX(clientX: number) {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = clientX - rect.left + containerRef.current.scrollLeft
    const raw = Math.max(0, Math.min(pxToMs(x), getTimelineDuration()))

    const { timelineItems: items, textOverlays: overlays, fps: currentFps } = useEditorStore.getState()
    let snapped = raw
    if (snapEnabled) {
      const threshMs = pxToMs(SNAP_PX)
      let bestDist = threshMs
      for (const item of items) {
        const end = item.startTime + (item.trimEnd - item.trimStart)
        for (const pt of [0, item.startTime, end]) {
          const d = Math.abs(pt - raw)
          if (d < bestDist) { bestDist = d; snapped = pt }
        }
      }
      for (const overlay of overlays) {
        for (const pt of [overlay.startTime, overlay.endTime]) {
          const d = Math.abs(pt - raw)
          if (d < bestDist) { bestDist = d; snapped = pt }
        }
      }
    }
    setCurrentTime(snapToFrame(snapped, currentFps))
  }

  function flushScheduledScrub() {
    scrubRaf.current = null
    const clientX = pendingScrubX.current
    pendingScrubX.current = null
    if (clientX == null || !scrubbing.current) return
    seekToX(clientX)
  }

  function scheduleSeekToX(clientX: number) {
    pendingScrubX.current = clientX
    if (scrubRaf.current != null) return
    scrubRaf.current = requestAnimationFrame(flushScheduledScrub)
  }

  const onScrubMove = useCallback((e: MouseEvent) => {
    if (!scrubbing.current) return
    const container = containerRef.current
    if (container) {
      const rect = container.getBoundingClientRect()
      const zone = 80
      if (e.clientX < rect.left + zone) {
        const speed = Math.ceil((zone - (e.clientX - rect.left)) / 2)
        container.scrollLeft = Math.max(0, container.scrollLeft - speed)
      } else if (e.clientX > rect.right - zone) {
        const speed = Math.ceil((e.clientX - (rect.right - zone)) / 2)
        container.scrollLeft += speed
      }
    }
    scheduleSeekToX(e.clientX)
  }, [pxPerMs, snapEnabled])

  const onScrubUp = useCallback(() => {
    const finalX = pendingScrubX.current
    if (scrubRaf.current != null) {
      cancelAnimationFrame(scrubRaf.current)
      scrubRaf.current = null
    }
    pendingScrubX.current = null
    if (scrubbing.current && finalX != null) seekToX(finalX)
    scrubbing.current = false
    document.body.style.cursor = ''
  }, [pxPerMs, snapEnabled])

  useEffect(() => {
    window.addEventListener('mousemove', onScrubMove)
    window.addEventListener('mouseup', onScrubUp)
    return () => {
      window.removeEventListener('mousemove', onScrubMove)
      window.removeEventListener('mouseup', onScrubUp)
      if (scrubRaf.current != null) cancelAnimationFrame(scrubRaf.current)
    }
  }, [onScrubMove, onScrubUp])

  const keepPlayheadInView = useCallback(() => {
    const tracks = containerRef.current
    if (!tracks) return

    const x = msToPx(useEditorStore.getState().currentTime)
    const left = tracks.scrollLeft
    const right = left + tracks.clientWidth
    const margin = Math.min(PLAYHEAD_SCROLL_MARGIN_PX, Math.max(16, tracks.clientWidth / 4))

    if (x < left + margin) {
      tracks.scrollLeft = Math.max(0, x - margin)
    } else if (x > right - margin) {
      tracks.scrollLeft = Math.max(0, x - tracks.clientWidth + margin)
    }
  }, [pxPerMs])

  useEffect(() => {
    keepPlayheadInView()
  }, [currentTime, zoom, keepPlayheadInView])

  // ── Scroll / zoom via wheel ────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      const { shortcuts } = useShortcutsStore.getState()
      const panSc  = shortcuts.find(s => s.id === 'scroll_timeline')
      const zoomSc = shortcuts.find(s => s.id === 'zoom_scroll')
      const matches = (sc: typeof panSc) =>
        sc && e.ctrlKey === sc.ctrl && e.shiftKey === sc.shift && e.altKey === sc.alt
      if (matches(panSc)) {
        e.preventDefault()
        const tracks = containerRef.current
        if (tracks) tracks.scrollLeft += e.deltaY
      } else if (matches(zoomSc)) {
        e.preventDefault()
        applyZoom(useEditorStore.getState().zoom + (e.deltaY < 0 ? 20 : -20))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

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
    let dropTime = snapToFrame(Math.max(0, pxToMs(e.clientX - rect.left + (containerRef.current?.scrollLeft ?? 0))), useEditorStore.getState().fps)
    const { addTimelineItem, clips, defaultTransformEnabled, defaultTransform } = useEditorStore.getState()

    function defTransform(clipType: string) {
      return defaultTransformEnabled && clipType !== 'audio' ? { transform: { ...defaultTransform } } : {}
    }

    function defKenBurns(clipType: string) {
      return clipType === 'image' ? { kenBurns: { ...DEFAULT_KEN_BURNS } } : {}
    }

    function defaultTrimEnd(clip: { type: string; duration: number }) {
      return clip.type === 'image' || clip.type === 'solid' ? Math.min(5000, clip.duration) : clip.duration
    }

    const clipId = e.dataTransfer.getData('text/x-clip-id')
    if (clipId) {
      const clip = clips.find(c => c.id === clipId)
      if (clip && clipFitsTrack(clip.type, trackIdx))
        addTimelineItem({ id: nanoid(), clipId: clip.id, trackIndex: trackIdx, startTime: dropTime, trimStart: 0, trimEnd: defaultTrimEnd(clip), ...defTransform(clip.type), ...defKenBurns(clip.type) })
      return
    }

    const paths = Array.from(e.dataTransfer.files).map(f => (f as any).path as string)
    if (!paths.length) return
    const imported = await importAndAddClips(paths)
    for (const clip of imported) {
      if (!clipFitsTrack(clip.type, trackIdx)) continue
      const trimEnd = defaultTrimEnd(clip)
      addTimelineItem({ id: nanoid(), clipId: clip.id, trackIndex: trackIdx, startTime: dropTime, trimStart: 0, trimEnd, ...defTransform(clip.type), ...defKenBurns(clip.type) })
      dropTime += trimEnd
    }
  }

  function handleTrackDragOver(e: React.DragEvent, trackIdx: number) {
    if (e.dataTransfer.types.includes('transition-type')) { e.dataTransfer.dropEffect = 'none'; return }
    const clipType = e.dataTransfer.getData('text/x-clip-type')
    if (clipType && !clipFitsTrack(clipType, trackIdx)) { e.dataTransfer.dropEffect = 'none'; return }
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverTrack(trackIdx)
  }

  function handleTrackDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverTrack(null)
  }

  const playheadLeft = msToPx(currentTime)

  return (
    <div style={styles.wrapper} ref={wrapperRef}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={styles.toolbarLabel}>Timeline</span>
        <div style={styles.zoomRow}>
          <button style={styles.zoomBtn} onClick={() => applyZoom(zoom - 20)}>−</button>
          <span style={styles.zoomLabel}>{zoom}px/s</span>
          <button style={styles.zoomBtn} onClick={() => applyZoom(zoom + 20)}>+</button>
          <button style={{ ...styles.snapBtn, ...(snapEnabled ? styles.snapActive : {}) }} onClick={() => setSnapEnabled(!snapEnabled)}>Snap</button>
        </div>

        {/* Transitions strip — inline in toolbar */}
        <div style={styles.trayInline}>
          <div style={styles.trayDivider} />
          <button style={styles.trayToggle} onClick={() => setTrayOpen(v => !v)} title={trayOpen ? 'Hide transitions' : 'Show transitions'}>
            Transitions {trayOpen ? '▾' : '▸'}
          </button>
          {trayOpen && TRANSITION_TYPES.map(({ type, label }) => (
            <div
              key={type}
              draggable
              onDragStart={e => { e.dataTransfer.setData('transition-type', type); e.dataTransfer.effectAllowed = 'copy' }}
              style={styles.trayChip}
            >{label}</div>
          ))}
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
              {/* Frame-level ticks */}
              {frameTicks.map(t => (
                <div key={t} style={{ position: 'absolute', left: msToPx(t), top: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: 1, height: framePx >= 18 ? 5 : 3, background: '#383838' }} />
                  {framePx >= 22 && <span style={{ fontSize: 8, color: '#3a3a3a', marginTop: 1, userSelect: 'none', whiteSpace: 'nowrap' }}>{Math.round(t * fps / 1000)}</span>}
                </div>
              ))}
              {/* Second-level major ticks */}
              {ticks.map(t => (
                <div key={t} style={{ ...styles.tick, left: msToPx(t) }}>
                  <div style={styles.tickLine} />
                  <span style={styles.tickLabel}>{formatRulerTime(t)}</span>
                </div>
              ))}
              <div style={{ ...styles.playheadRuler, left: playheadLeft - 1 }} onMouseDown={startScrub}>
                <div style={styles.playheadRulerHit} />
                <div style={styles.playheadRulerHandle} />
              </div>
            </div>
          </div>

          {/* Tracks — scrolls both axes */}
          <div style={styles.tracksScroll} ref={containerRef}>
            <div style={{ position: 'relative', width: msToPx(duration), minWidth: '100%' }} onMouseDown={startScrub}>

              {/* Video tracks */}
              <div style={styles.sectionDivider}>
                <span style={styles.sectionDividerLabel}>VIDEO</span>
              </div>
              {Array.from({ length: videoTrackCount }).map((_, i) => {
                const trackIdx = videoTrackCount - 1 - i
                return (
                  <TrackRow key={trackIdx} trackIdx={trackIdx} trackHeight={getTrackH(trackIdx)} clips={clips} timelineItems={timelineItems} textOverlays={textOverlays} msToPx={msToPx}
                    dragOverTrack={dragOverTrack} selectedId={selectedId} setSelectedId={setSelectedId} onClipMouseDown={onClipMouseDown}
                    onResizeMouseDown={onResizeMouseDown} removeTimelineItem={removeTimelineItem}
                    onTextMouseDown={onTextMouseDown} onTextResizeMouseDown={onTextResizeMouseDown} removeTextOverlay={removeTextOverlay}
                    handleTrackDrop={handleTrackDrop} handleTrackDragOver={handleTrackDragOver}
                    handleTrackDragLeave={handleTrackDragLeave}
                    updateTransition={updateTransition} onTransitionChipClick={openTransitionPopup} videoTrackCount={videoTrackCount} />
                )
              })}

              {/* Audio tracks */}
              <div style={{ ...styles.sectionDivider, ...styles.sectionDividerAudio }}>
                <span style={{ ...styles.sectionDividerLabel, color: '#2a8abf' }}>AUDIO</span>
              </div>
              {Array.from({ length: audioTrackCount }).map((_, i) => (
                <TrackRow key={i} trackIdx={videoTrackCount + i} trackHeight={getTrackH(videoTrackCount + i)} clips={clips} timelineItems={timelineItems} textOverlays={textOverlays} msToPx={msToPx}
                  dragOverTrack={dragOverTrack} selectedId={selectedId} setSelectedId={setSelectedId} onClipMouseDown={onClipMouseDown}
                  onResizeMouseDown={onResizeMouseDown} removeTimelineItem={removeTimelineItem}
                  onTextMouseDown={onTextMouseDown} onTextResizeMouseDown={onTextResizeMouseDown} removeTextOverlay={removeTextOverlay}
                  handleTrackDrop={handleTrackDrop} handleTrackDragOver={handleTrackDragOver}
                  handleTrackDragLeave={handleTrackDragLeave}
                  updateTransition={updateTransition} onTransitionChipClick={openTransitionPopup} videoTrackCount={videoTrackCount} />
              ))}

              {/* Snap indicator */}
              {snapIndicator !== null && (
                <div style={{ ...styles.snapIndicator, left: msToPx(snapIndicator), height: totalHeight }} />
              )}

              {/* Playhead */}
              <div style={{ ...styles.playheadTrackHit, left: playheadLeft - 7, height: totalHeight }} onMouseDown={startScrub} />
              <div style={{ ...styles.playheadTrackLine, left: playheadLeft - 1, height: totalHeight }} />
            </div>
          </div>
        </div>
      </div>

      {transitionPopup && (
        <TransitionPopup
          itemId={transitionPopup.itemId}
          rect={transitionPopup.rect}
          onClose={() => setTransitionPopup(null)}
        />
      )}
    </div>
  )
}

// ── TransitionPopup ───────────────────────────────────────────────────────────
function TransitionPopup({ itemId, rect, onClose }: { itemId: string; rect: DOMRect; onClose: () => void }) {
  const { timelineItems, updateTransition } = useEditorStore()
  const item = timelineItems.find(i => i.id === itemId)
  if (!item) return null
  const tr = { ...DEFAULT_TRANSITION, ...item.transitionIn }
  const activeType = item.transitionIn ? item.transitionIn.type : 'cut'

  const left = Math.min(rect.left - 60, window.innerWidth - 220)
  const top  = rect.bottom + 6

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={onClose} />
      <div style={{ position: 'fixed', left, top, width: 204, background: '#1e1e1e', border: '1px solid #444', borderRadius: 8, padding: '10px 12px', zIndex: 1000, boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {TRANSITION_TYPES.map(({ type, label }) => {
            const active = type === activeType
            return (
              <button key={type}
                style={{ padding: '3px 8px', fontSize: 11, background: active ? '#2d1560' : '#2a2a2a', border: `1px solid ${active ? '#7040e0' : '#3a3a3a'}`, color: active ? '#c0a0ff' : '#888', borderRadius: 4, cursor: 'pointer' }}
                onClick={() => type === 'cut' ? updateTransition(itemId, null) : updateTransition(itemId, { type: type as TransitionType })}
              >{label}</button>
            )
          })}
        </div>
        {activeType !== 'cut' && (
          <>
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 4 }}>
                <span>Duration</span><span>{(tr.duration / 1000).toFixed(1)}s</span>
              </div>
              <input type="range" min={100} max={3000} step={100} value={tr.duration}
                onChange={e => updateTransition(itemId, { duration: Number(e.target.value) })}
                style={{ width: '100%' }} />
            </div>
            {tr.type === 'fade-color' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#888' }}>Color</span>
                <input type="color" value={tr.color} onChange={e => updateTransition(itemId, { color: e.target.value })}
                  style={{ width: 32, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ── WaveformBars ─────────────────────────────────────────────────────────────
function WaveformBars({ path, trimStart, trimEnd, volume, kind }: {
  path: string; trimStart: number; trimEnd: number; volume: number; kind: 'audio' | 'video'
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [waveform, setWaveform] = useState<WaveformData | null>(null)

  useEffect(() => {
    let active = true
    setWaveform(null)
    getWaveform(path).then(w => { if (active) setWaveform(w) }).catch(() => {})
    return () => { active = false }
  }, [path])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const dpr = window.devicePixelRatio || 1
    canvas.width  = Math.round(rect.width  * dpr)
    canvas.height = Math.round(rect.height * dpr)
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height

    ctx.clearRect(0, 0, W, H)

    const colors = kind === 'audio'
      ? {
          peak: 'rgba(88, 184, 255, 0.30)',
          rms: 'rgba(178, 225, 255, 0.86)',
          center: 'rgba(142, 209, 255, 0.24)',
        }
      : {
          peak: 'rgba(132, 226, 170, 0.20)',
          rms: 'rgba(184, 245, 203, 0.62)',
          center: 'rgba(162, 230, 185, 0.18)',
        }

    if (!waveform) {
      drawWaveformCenterLines(ctx, H, W, 1, colors.center)
      return
    }

    const visibleDurationMs = Math.max(1, trimEnd - trimStart)
    const level = selectWaveformLevel(waveform, visibleDurationMs, W)
    if (!level || level.length === 0 || level.channels.length === 0) {
      drawWaveformCenterLines(ctx, H, W, 1, colors.center)
      return
    }

    const laneCount = level.channels.length > 1 && H >= 28 * dpr ? 2 : 1
    const laneGap = laneCount > 1 ? Math.max(1, Math.round(2 * dpr)) : 0
    const laneHeight = (H - laneGap * (laneCount - 1)) / laneCount
    const startIndex = Math.max(0, Math.floor((trimStart / 1000) * level.pointsPerSecond))
    const endIndex = Math.max(startIndex + 1, Math.ceil((trimEnd / 1000) * level.pointsPerSecond))
    const span = Math.max(1, endIndex - startIndex)
    const volScale = volume <= 0 ? 0.18 : Math.max(0.28, Math.min(2, volume / 100))

    drawWaveformCenterLines(ctx, H, W, laneCount, colors.center)

    for (let x = 0; x < W; x++) {
      const lo = startIndex + Math.floor((x / W) * span)
      const hi = startIndex + Math.ceil(((x + 1) / W) * span)

      for (let lane = 0; lane < laneCount; lane++) {
        const laneTop = lane * (laneHeight + laneGap)
        const mid = laneTop + laneHeight / 2
        const half = Math.max(1, laneHeight / 2 - 1)
        const sourceChannels = laneCount === 1 ? level.channels : [level.channels[lane]]
        const sample = readWaveformRange(sourceChannels, lo, hi, level)

        const topPeak = Math.min(half, sample.positive * half * 0.96 * volScale)
        const bottomPeak = Math.min(half, Math.abs(sample.negative) * half * 0.96 * volScale)
        ctx.fillStyle = colors.peak
        if (topPeak > 0) ctx.fillRect(x, mid - topPeak, 1, topPeak)
        if (bottomPeak > 0) ctx.fillRect(x, mid, 1, bottomPeak)

        const rmsHeight = Math.min(half, sample.rms * half * 0.96 * volScale)
        if (rmsHeight > 0) {
          ctx.fillStyle = colors.rms
          ctx.fillRect(x, mid - Math.max(0.5, rmsHeight), 1, Math.max(1, rmsHeight * 2))
        }
      }
    }
  }, [waveform, trimStart, trimEnd, volume, kind])

  useEffect(() => { draw() }, [draw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const obs = new ResizeObserver(draw)
    obs.observe(canvas)
    return () => obs.disconnect()
  }, [draw])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none', zIndex: 1 }}
    />
  )
}

function drawWaveformCenterLines(
  ctx: CanvasRenderingContext2D,
  height: number,
  width: number,
  laneCount: number,
  color: string,
) {
  const laneGap = laneCount > 1 ? Math.max(1, Math.round(2 * (window.devicePixelRatio || 1))) : 0
  const laneHeight = (height - laneGap * (laneCount - 1)) / laneCount
  ctx.fillStyle = color
  for (let lane = 0; lane < laneCount; lane++) {
    const mid = lane * (laneHeight + laneGap) + laneHeight / 2
    ctx.fillRect(0, Math.round(mid), width, 1)
  }
}

function readWaveformRange(channels: WaveformLevel['channels'], lo: number, hi: number, level: WaveformLevel) {
  const end = Math.min(Math.max(hi, lo + 1), level.length)
  const start = Math.max(0, Math.min(lo, end - 1))
  let positive = 0
  let negative = 0
  let rmsSq = 0
  let count = 0

  for (const channel of channels) {
    if (!channel) continue
    for (let i = start; i < end; i++) {
      positive = Math.max(positive, channel.positive[i] ?? 0)
      negative = Math.min(negative, channel.negative[i] ?? 0)
      const rms = channel.rms[i] ?? 0
      rmsSq += rms * rms
      count++
    }
  }

  return {
    positive,
    negative,
    rms: count > 0 ? Math.sqrt(rmsSq / count) : 0,
  }
}

// ── TrackRow ────────────────────────────────────────────────────────────────
function textOverlayTrackIndex(overlay: TextOverlay, videoTrackCount: number): number {
  if (!Number.isFinite(overlay.trackIndex)) return Math.max(0, videoTrackCount - 1)
  return Math.max(0, Math.min(videoTrackCount - 1, overlay.trackIndex))
}

interface TrackRowProps {
  trackIdx: number
  trackHeight: number
  clips: any[]
  timelineItems: any[]
  textOverlays: TextOverlay[]
  msToPx: (ms: number) => number
  dragOverTrack: number | null
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  onClipMouseDown: (e: React.MouseEvent, id: string) => void
  onResizeMouseDown: (e: React.MouseEvent, id: string, edge: 'left' | 'right') => void
  removeTimelineItem: (id: string) => void
  onTextMouseDown: (e: React.MouseEvent, id: string) => void
  onTextResizeMouseDown: (e: React.MouseEvent, id: string, edge: 'left' | 'right') => void
  removeTextOverlay: (id: string) => void
  handleTrackDrop: (e: React.DragEvent, idx: number) => void
  handleTrackDragOver: (e: React.DragEvent, idx: number) => void
  handleTrackDragLeave: (e: React.DragEvent) => void
  updateTransition: (id: string, changes: any) => void
  onTransitionChipClick: (itemId: string, rect: DOMRect) => void
  videoTrackCount: number
}

function TrackRow({ trackIdx, trackHeight, clips, timelineItems, textOverlays, msToPx, dragOverTrack, selectedId, setSelectedId, onClipMouseDown, onResizeMouseDown, removeTimelineItem, onTextMouseDown, onTextResizeMouseDown, removeTextOverlay, handleTrackDrop, handleTrackDragOver, handleTrackDragLeave, updateTransition, onTransitionChipClick, videoTrackCount }: TrackRowProps) {
  return (
    <div
      data-track={trackIdx}
      style={{ ...styles.track, height: trackHeight, ...(dragOverTrack === trackIdx ? styles.trackDragging : {}) }}
      onDrop={e => handleTrackDrop(e, trackIdx)}
      onDragOver={e => handleTrackDragOver(e, trackIdx)}
      onDragLeave={handleTrackDragLeave}
      onMouseDown={() => setSelectedId(null)}
    >
      {timelineItems.filter(i => i.trackIndex === trackIdx).map(item => {
        const clip = clips.find(c => c.id === item.clipId)
        if (!clip) return null
        const bg = clip.type === 'audio' ? '#152b3d' : clip.type === 'image' ? '#2d1f0e' : clip.type === 'solid' ? '#1a1a2e' : '#0f2d1a'
        const border = clip.type === 'audio' ? '#2a7abf' : clip.type === 'image' ? '#bf8a2a' : clip.type === 'solid' ? '#5555aa' : '#2abf5a'
        const isSelected = selectedId === item.id

        // Detect adjacent previous clip for transition chip (video/image only)
        const prevItem = clip.type !== 'audio' ? timelineItems.find(i =>
          i.trackIndex === trackIdx && i.id !== item.id &&
          Math.abs((i.startTime + (i.trimEnd - i.trimStart)) - item.startTime) < 500
        ) : null
        const hasTr = !!item.transitionIn && item.transitionIn.type !== 'cut'

        const leftClipW  = prevItem ? msToPx(prevItem.trimEnd - prevItem.trimStart) : Infinity
        const rightClipW = msToPx(item.trimEnd - item.trimStart)
        const chipSize = Math.round(Math.max(4, Math.min(22, trackHeight * 0.5, Math.min(leftClipW, rightClipW) * 0.6)))

        return (
          <Fragment key={item.id}>
            {/* Transition chip — sits at the junction between two adjacent clips */}
            {prevItem && (
              <div
                style={{
                  position: 'absolute', zIndex: 6,
                  left: msToPx(item.startTime) - chipSize / 2,
                  top: '50%', transform: 'translateY(-50%)',
                  width: chipSize, height: chipSize,
                  background: hasTr ? '#2d1560' : '#1a1a1a',
                  border: `1px solid ${hasTr ? '#7040e0' : '#333'}`,
                  borderRadius: Math.round(chipSize * 0.18), cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onTransitionChipClick(item.id, (e.currentTarget as HTMLElement).getBoundingClientRect()) }}
                onDragOver={e => { if (e.dataTransfer.types.includes('transition-type')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
                onDrop={e => {
                  e.preventDefault(); e.stopPropagation()
                  const type = e.dataTransfer.getData('transition-type') as TransitionType
                  if (type) updateTransition(item.id, { type, duration: item.transitionIn?.duration ?? DEFAULT_TRANSITION.duration, color: item.transitionIn?.color ?? DEFAULT_TRANSITION.color })
                }}
                title={hasTr ? item.transitionIn!.type : 'Drag a transition here or click to set'}
              >
                <span style={{ fontSize: Math.round(chipSize * 0.41), color: hasTr ? '#a080ff' : '#444', pointerEvents: 'none', lineHeight: 1 }}>
                  {hasTr ? '◈' : '+'}
                </span>
              </div>
            )}

            <div
              style={{ ...styles.clip, left: msToPx(item.startTime), width: Math.max(msToPx(item.trimEnd - item.trimStart), 4), height: trackHeight - 6, background: bg, borderColor: border, outline: isSelected ? '2px solid #fff' : 'none', outlineOffset: -1 }}
              onMouseDown={e => onClipMouseDown(e, item.id)}
            >
              {(clip.type === 'audio' || clip.type === 'video') && (
                <WaveformBars path={clip.path} trimStart={item.trimStart} trimEnd={item.trimEnd} volume={item.volume ?? 100} kind={clip.type} />
              )}
              <div style={styles.resizeL} onMouseDown={e => onResizeMouseDown(e, item.id, 'left')} />
              <span style={styles.clipLabel} title={clip.name}>{clip.name}</span>
              <div style={styles.resizeR} onMouseDown={e => onResizeMouseDown(e, item.id, 'right')} />
              <button style={styles.clipDel} onMouseDown={e => e.stopPropagation()} onClick={() => removeTimelineItem(item.id)}>×</button>

              {/* Keyframe indicator bar + diamonds */}
              {item.keyframeTracks && item.keyframeTracks.length > 0 && (() => {
                const clipDur = item.trimEnd - item.trimStart
                const times = allKeyframeTimes(item.keyframeTracks)
                return (
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 10, pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'rgba(255,204,0,0.35)' }} />
                    {isSelected && times.map(t => (
                      <div
                        key={t}
                        style={{
                          position: 'absolute',
                          left: `${Math.min(100, (t / clipDur) * 100)}%`,
                          top: '50%',
                          transform: 'translate(-50%, -50%) rotate(45deg)',
                          width: 7, height: 7,
                          background: '#ffcc00',
                          boxShadow: '0 0 3px rgba(0,0,0,0.6)',
                          cursor: 'pointer',
                          pointerEvents: 'all',
                        }}
                        onMouseDown={ev => {
                          ev.stopPropagation()
                          useEditorStore.getState().setCurrentTime(item.startTime + t)
                        }}
                      />
                    ))}
                  </div>
                )
              })()}
            </div>
          </Fragment>
        )
      })}
      {trackIdx < videoTrackCount && textOverlays
        .filter(overlay => textOverlayTrackIndex(overlay, videoTrackCount) === trackIdx)
        .map(overlay => {
          const width = Math.max(msToPx(overlay.endTime - overlay.startTime), 18)
          const isSelected = selectedId === overlay.id
          return (
            <div
              key={overlay.id}
              style={{
                ...styles.clip,
                ...styles.textClip,
                left: msToPx(overlay.startTime),
                width,
                height: trackHeight - 6,
                outline: isSelected ? '2px solid #fff' : 'none',
                outlineOffset: -1,
              }}
              onMouseDown={e => onTextMouseDown(e, overlay.id)}
              title={overlay.text}
            >
              <div style={styles.resizeL} onMouseDown={e => onTextResizeMouseDown(e, overlay.id, 'left')} />
              <span style={styles.textClipIcon}>T</span>
              <span style={styles.clipLabel}>{overlay.text || 'Text'}</span>
              <div style={styles.resizeR} onMouseDown={e => onTextResizeMouseDown(e, overlay.id, 'right')} />
              <button style={styles.clipDel} onMouseDown={e => e.stopPropagation()} onClick={() => removeTextOverlay(overlay.id)}>×</button>
              {overlay.keyframeTracks && overlay.keyframeTracks.length > 0 && (() => {
                const clipDur = Math.max(1, overlay.endTime - overlay.startTime)
                const times = allKeyframeTimes(overlay.keyframeTracks)
                return (
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 10, pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'rgba(255,204,0,0.35)' }} />
                    {isSelected && times.map(t => (
                      <div
                        key={t}
                        style={{
                          position: 'absolute',
                          left: `${Math.min(100, (t / clipDur) * 100)}%`,
                          top: '50%',
                          transform: 'translate(-50%, -50%) rotate(45deg)',
                          width: 7, height: 7,
                          background: '#ffcc00',
                          boxShadow: '0 0 3px rgba(0,0,0,0.6)',
                          cursor: 'pointer',
                          pointerEvents: 'all',
                        }}
                        onMouseDown={ev => {
                          ev.stopPropagation()
                          useEditorStore.getState().setCurrentTime(overlay.startTime + t)
                        }}
                      />
                    ))}
                  </div>
                )
              })()}
            </div>
          )
        })}
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  wrapper:      { display: 'flex', flexDirection: 'column', height: '100%', background: '#161616', overflow: 'hidden' },
  toolbar:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 },
  toolbarLabel: { fontSize: 13, color: '#888', fontWeight: 600 },
  zoomRow:      { display: 'flex', alignItems: 'center', gap: 7 },
  zoomBtn:      { background: '#2a2a2a', border: 'none', color: '#ccc', width: 26, height: 26, borderRadius: 5, cursor: 'pointer', fontSize: 16 },
  zoomLabel:    { fontSize: 12, color: '#666', minWidth: 58, textAlign: 'center' },
  snapBtn:      { background: '#2a2a2a', border: '1px solid #444', color: '#888', padding: '3px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12, marginLeft: 5 },
  snapActive:   { borderColor: '#2abf5a', color: '#2abf5a' },

  body:         { display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 },

  // Left header panel
  headerPanel:  { width: HEADER_W, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#111', borderRight: '1px solid #2a2a2a', overflowY: 'hidden' },
  rulerSpacer:  { height: RULER_HEIGHT, flexShrink: 0, borderBottom: '1px solid #2a2a2a' },
  sectionHead:  { height: SECTION_H, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px 0 8px', background: '#0e0e0e', borderBottom: '1px solid #222', flexShrink: 0 },
  sectionHeadAudio: { borderTop: '2px solid #252525' },
  sectionLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#2abf5a' },
  addTrackBtn:  { background: 'none', border: '1px solid #333', color: '#666', width: 20, height: 20, borderRadius: 4, cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  trackHeader:       { height: TRACK_HEIGHT, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: '1px solid #1e1e1e', background: '#121212', position: 'relative' },
  trackResizeHandle: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 5, cursor: 'ns-resize', zIndex: 5 },
  trackLabel:   { fontSize: 13, fontWeight: 700, color: '#2abf5a', letterSpacing: 0.5 },

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
  tickLabel:    { fontSize: 11, color: '#555', marginTop: 1, whiteSpace: 'nowrap', userSelect: 'none' },
  playheadRuler: { position: 'absolute', top: 0, height: RULER_HEIGHT, width: 2, background: '#e63950', zIndex: 12, cursor: 'ew-resize' },
  playheadRulerHit: { position: 'absolute', top: 0, bottom: 0, left: -7, width: 16 },
  playheadRulerHandle: { position: 'absolute', bottom: 0, left: -5, width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '10px solid #e63950', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.7))' },
  playheadTrackHit: { position: 'absolute', top: 0, width: 14, zIndex: 13, cursor: 'ew-resize', background: 'transparent' },
  playheadTrackLine: { position: 'absolute', top: 0, width: 2, background: '#e63950', zIndex: 12, pointerEvents: 'none', boxShadow: '0 0 0 1px rgba(0,0,0,0.35)' },
  sectionDivider:      { height: SECTION_H, background: '#0e0e0e', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', paddingLeft: 10 },
  sectionDividerAudio: { borderTop: '2px solid #252525' },
  sectionDividerLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#2abf5a', opacity: 0.4 },
  track:        { height: TRACK_HEIGHT, borderBottom: '1px solid #1e1e1e', position: 'relative', background: '#181818', transition: 'background 0.1s' },
  trackDragging:{ background: 'rgba(42,191,90,0.07)', outline: '2px dashed #2abf5a', outlineOffset: -2 },
  clip:         { position: 'absolute', top: 3, height: TRACK_HEIGHT - 6, borderRadius: 4, border: '1px solid', overflow: 'hidden', display: 'flex', alignItems: 'center', userSelect: 'none', cursor: 'grab', minWidth: 4 },
  textClip:     { background: '#26143c', borderColor: '#8b5cf6', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)' },
  textClipIcon: { position: 'relative', zIndex: 2, width: 22, color: '#d7c4ff', fontSize: 13, fontWeight: 800, textAlign: 'center', textShadow: '0 1px 3px rgba(0,0,0,0.8)', flexShrink: 0 },
  clipLabel:    { fontSize: 12, color: '#fff', paddingLeft: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, pointerEvents: 'none', position: 'relative', zIndex: 2, textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.8)' },
  clipDel:      { position: 'absolute', top: 1, right: 1, background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', zIndex: 4 },
  resizeL:      { position: 'absolute', left: 0, top: 0, width: 5, height: '100%', cursor: 'ew-resize', background: 'rgba(255,255,255,0.1)', zIndex: 3 },
  resizeR:      { position: 'absolute', right: 0, top: 0, width: 5, height: '100%', cursor: 'ew-resize', background: 'rgba(255,255,255,0.1)', zIndex: 3 },
  snapIndicator:{ position: 'absolute', top: 0, width: 1, background: 'rgba(255,220,0,0.8)', zIndex: 9, pointerEvents: 'none' },

  trayInline:  { display: 'flex', alignItems: 'center', gap: 4, flex: 1, overflow: 'hidden' },
  trayDivider: { width: 1, height: 18, background: '#2a2a2a', flexShrink: 0, marginLeft: 6, marginRight: 6 },
  trayToggle:  { background: 'none', border: 'none', color: '#555', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap', padding: '2px 4px', userSelect: 'none' },
  trayChip:    { padding: '2px 7px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, cursor: 'grab', fontSize: 11, color: '#999', whiteSpace: 'nowrap', userSelect: 'none', flexShrink: 0 },
}
