import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store/useEditorStore'
import { useShortcutsStore, matchesShortcut } from '../store/useShortcutsStore'
import type { TextOverlay, TimelineItem, MediaClip, Transform, Effects, Animation, Transition, KenBurns } from '../types'
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_ANIMATION } from '../types'
import { formatTimecode, snapToFrame, frameDurationMs } from '../utils/frame'
import { applyKeyframesToTransform, applyKeyframesToEffects } from '../utils/keyframes'

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r},${g},${b}`
}

type LayerStyle = { outer: React.CSSProperties; inner: React.CSSProperties }

function buildTransformStyle(t: Transform, e: Effects): LayerStyle {
  const sx = t.scaleX * (t.flipH ? -1 : 1)
  const sy = t.scaleY * (t.flipV ? -1 : 1)

  // Non-shadow filters go on the media element (inside clip-path)
  const innerFilter = [
    e.brightness !== 100 ? `brightness(${e.brightness / 100})` : '',
    e.contrast   !== 100 ? `contrast(${e.contrast / 100})`     : '',
    e.saturate   !== 100 ? `saturate(${e.saturate / 100})`     : '',
    e.hue        !== 0   ? `hue-rotate(${e.hue}deg)`           : '',
    e.blur       !== 0   ? `blur(${e.blur}px)`                 : '',
    e.opacity    !== 100 ? `opacity(${e.opacity / 100})`       : '',
    e.grayscale  !== 0   ? `grayscale(${e.grayscale / 100})`   : '',
    e.sepia      !== 0   ? `sepia(${e.sepia / 100})`           : '',
  ].filter(Boolean).join(' ') || undefined

  // drop-shadow goes on the outer wrapper so it renders outside the clip-path
  const outerFilter = e.shadowOpacity > 0
    ? `drop-shadow(${e.shadowX}px ${e.shadowY}px ${e.shadowBlur}px rgba(${hexToRgb(e.shadowColor ?? '#000000')},${e.shadowOpacity / 100}))`
    : undefined

  return {
    outer: {
      transform: `translate(${t.posX}%, ${t.posY}%) rotate(${t.rotation}deg) rotateX(${t.pitch}deg) rotateY(${t.yaw}deg) scale(${sx}, ${sy})`,
      transformOrigin: `${t.anchorX * 100}% ${t.anchorY * 100}%`,
      transformStyle: 'preserve-3d',
      backfaceVisibility: 'hidden',
      filter: outerFilter,
    },
    inner: {
      clipPath: (t.cropL || t.cropR || t.cropT || t.cropB)
        ? `inset(${t.cropT}% ${t.cropR}% ${t.cropB}% ${t.cropL}%)`
        : undefined,
      filter: innerFilter,
    },
  }
}

function ease(p: number) { return p * p * (3 - 2 * p) }

function buildAnimationStyle(anim: Animation, clipTime: number, clipDuration: number): React.CSSProperties {
  const inP  = anim.inEffect  !== 'none' && clipTime < anim.inDuration
    ? ease(Math.max(0, Math.min(1, clipTime / anim.inDuration))) : 1
  const outP = anim.outEffect !== 'none' && (clipDuration - clipTime) < anim.outDuration
    ? ease(Math.max(0, Math.min(1, (clipDuration - clipTime) / anim.outDuration))) : 1

  const parts: string[] = []
  let opacity = 1
  let blurPx = 0

  switch (anim.inEffect) {
    case 'fade':        opacity *= inP; break
    case 'zoom-in':     parts.push(`scale(${0.3 + 0.7 * inP})`); break
    case 'zoom-out':    parts.push(`scale(${1.7 - 0.7 * inP})`); break
    case 'slide-left':  parts.push(`translateX(${(inP - 1) * 100}%)`); break
    case 'slide-right': parts.push(`translateX(${(1 - inP) * 100}%)`); break
    case 'slide-up':    parts.push(`translateY(${(inP - 1) * 100}%)`); break
    case 'slide-down':  parts.push(`translateY(${(1 - inP) * 100}%)`); break
    case 'blur-in':     blurPx += 20 * (1 - inP); break
  }
  switch (anim.outEffect) {
    case 'fade':        opacity *= outP; break
    case 'zoom-in':     if (outP < 1) parts.push(`scale(${1 + 0.7 * (1 - outP)})`); break
    case 'zoom-out':    if (outP < 1) parts.push(`scale(${outP * 0.7 + 0.3})`); break
    case 'slide-left':  if (outP < 1) parts.push(`translateX(${(outP - 1) * 100}%)`); break
    case 'slide-right': if (outP < 1) parts.push(`translateX(${(1 - outP) * 100}%)`); break
    case 'slide-up':    if (outP < 1) parts.push(`translateY(${(outP - 1) * 100}%)`); break
    case 'slide-down':  if (outP < 1) parts.push(`translateY(${(1 - outP) * 100}%)`); break
    case 'blur-out':    if (outP < 1) blurPx += 20 * (1 - outP); break
  }

  return {
    transform: parts.length ? parts.join(' ') : undefined,
    opacity,
    filter: blurPx > 0 ? `blur(${blurPx.toFixed(1)}px)` : undefined,
  }
}

function applyKenBurns(kb: KenBurns | undefined, clipTime: number, clipDuration: number, t: Transform): Transform {
  if (!kb) return t
  const p = clipDuration > 0 ? Math.max(0, clipTime / clipDuration) : 0
  const scale = kb.startScale + (kb.endScale - kb.startScale) * p
  return {
    ...t,
    scaleX:  t.scaleX * scale,
    scaleY:  t.scaleY * scale,
    posX:    t.posX + kb.startX + (kb.endX - kb.startX) * p,
    posY:    t.posY + kb.startY + (kb.endY - kb.startY) * p,
    anchorX: (kb.focalX ?? 50) / 100,
    anchorY: (kb.focalY ?? 50) / 100,
  }
}

function itemEnd(item: TimelineItem) { return item.startTime + (item.trimEnd - item.trimStart) }
function srcSec(item: TimelineItem, t: number) { return (item.trimStart + (t - item.startTime)) / 1000 }
function inRange(item: TimelineItem, t: number) { return t >= item.startTime && t < itemEnd(item) }

type TransState = {
  outItem: TimelineItem; inItem: TimelineItem
  transition: Transition; progress: number
} | null

function findTransitionState(items: TimelineItem[], itemId: string, t: number): TransState {
  const inItem = items.find(i => i.id === itemId)
  if (!inItem?.transitionIn || inItem.transitionIn.type === 'cut') return null
  const { duration } = inItem.transitionIn as Transition
  if (t < inItem.startTime || t >= inItem.startTime + duration) return null
  const outItem = items.find(i =>
    i.trackIndex === inItem.trackIndex && i.id !== inItem.id &&
    Math.abs(itemEnd(i) - inItem.startTime) < 500
  )
  if (!outItem) return null
  return { outItem, inItem, transition: inItem.transitionIn as Transition, progress: (t - inItem.startTime) / duration }
}

function transitionStyles(tr: Transition, progress: number) {
  const p = progress
  let outStyle: React.CSSProperties = {}
  let inStyle:  React.CSSProperties = {}
  let overlayOpacity = 0

  switch (tr.type) {
    case 'crossfade':
      outStyle = { opacity: 1 - p }; inStyle = { opacity: p }; break
    case 'fade-color':
      outStyle = { opacity: Math.max(0, 1 - p * 2) }
      inStyle  = { opacity: Math.max(0, (p - 0.5) * 2) }
      overlayOpacity = Math.sin(p * Math.PI); break
    case 'wipe-left':  inStyle = { clipPath: `inset(0 ${(1-p)*100}% 0 0)` }; break
    case 'wipe-right': inStyle = { clipPath: `inset(0 0 0 ${(1-p)*100}%)` }; break
    case 'wipe-up':    inStyle = { clipPath: `inset(0 0 ${(1-p)*100}% 0)` }; break
    case 'wipe-down':  inStyle = { clipPath: `inset(${(1-p)*100}% 0 0 0)` }; break
  }
  return { outStyle, inStyle, overlayOpacity }
}

type VideoLayer = {
  item: TimelineItem; clip: MediaClip
  transState: TransState
  outItem: TimelineItem | null; outClip: MediaClip | null
}


export default function PreviewPlayer() {
  const {
    clips, timelineItems, textOverlays,
    currentTime, setCurrentTime, isPlaying, setIsPlaying,
    getTimelineDuration, fps, selectedId, updateTransform, updateTimelineItem,
    hoverPreviewClip,
  } = useEditorStore()

  // Pool: keyed by item.id for active clips, "${item.id}_out" for frozen outgoing clips
  const videoRefs  = useRef(new Map<string, HTMLVideoElement>())
  // Cache of stable ref callbacks so React doesn't remount on every render
  const refCbCache = useRef(new Map<string, (el: HTMLVideoElement | null) => void>())

  function getVidRef(key: string) {
    if (!refCbCache.current.has(key)) {
      refCbCache.current.set(key, el => {
        if (el) videoRefs.current.set(key, el)
        else videoRefs.current.delete(key)
      })
    }
    return refCbCache.current.get(key)!
  }

  const audioEls     = useRef(new Map<string, HTMLAudioElement>())
  const rafRef       = useRef(0)
  const playRef      = useRef<{ wallTime: number; timelineTime: number } | null>(null)
  const prevAudioIds = useRef(new Set<string>())
  const prevVideoIds = useRef(new Set<string>())

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

  const selectedItem = selectedId ? timelineItems.find(i => i.id === selectedId) ?? null : null
  const selectedClip = selectedItem ? clips.find(c => c.id === selectedItem.clipId) ?? null : null
  const selectedHasKB = !!(selectedItem?.kenBurns)

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

  const duration = getTimelineDuration()

  // All active video/image layers at currentTime, sorted bottom→top by trackIndex
  const videoLayers: VideoLayer[] = timelineItems
    .filter(i => {
      const c = clips.find(cl => cl.id === i.clipId)
      return c && c.type !== 'audio' && inRange(i, currentTime)
    })
    .sort((a, b) => a.trackIndex - b.trackIndex)
    .map(item => {
      const clip      = clips.find(c => c.id === item.clipId)!
      const transState = findTransitionState(timelineItems, item.id, currentTime)
      const outItem   = transState ? (timelineItems.find(i => i.id === transState.outItem.id) ?? null) : null
      const outClip   = outItem   ? (clips.find(c => c.id === outItem.clipId) ?? null) : null
      return { item, clip, transState, outItem, outClip }
    })

  // ── Audio pool ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const liveIds = new Set(timelineItems.map(i => i.id))
    for (const item of timelineItems) {
      const clip = clips.find(c => c.id === item.clipId)
      if (!clip || clip.type !== 'audio') continue
      if (!audioEls.current.has(item.id)) {
        const el = new Audio()
        el.src = `file://${clip.path}`
        el.preload = 'auto'
        audioEls.current.set(item.id, el)
      }
      audioEls.current.get(item.id)!.volume = Math.min(1, (item.volume ?? 100) / 100)
    }
    for (const [id, el] of audioEls.current) {
      if (!liveIds.has(id)) { el.pause(); el.src = ''; audioEls.current.delete(id) }
    }
  }, [timelineItems, clips])

  // ── Sync video src + seek while paused ────────────────────────────────────
  useEffect(() => {
    if (isPlaying) return
    for (const item of timelineItems) {
      const clip = clips.find(c => c.id === item.clipId)
      if (!clip || clip.type !== 'video' || !inRange(item, currentTime)) continue
      const el = videoRefs.current.get(item.id)
      if (!el) continue
      const src = `file://${clip.path}`
      if (el.src !== src) el.src = src
      const st = srcSec(item, currentTime)
      if (Math.abs(el.currentTime - st) > 0.08) el.currentTime = Math.max(0, st)
    }
  }, [timelineItems, clips, currentTime, isPlaying])

  // ── Freeze outgoing transition videos ────────────────────────────────────
  const outgoingSignature = videoLayers.map(l => l.outItem?.id ?? '').join(',')
  useEffect(() => {
    for (const { outItem, outClip } of videoLayers) {
      if (!outItem || !outClip || outClip.type !== 'video') continue
      const el = videoRefs.current.get(`${outItem.id}_out`)
      if (!el) continue
      const src = `file://${outClip.path}`
      if (el.src !== src) el.src = src
      const frozenAt = Math.max(0, (outItem.trimEnd - 50) / 1000)
      const doFreeze = () => { el.currentTime = frozenAt; el.pause() }
      if (el.readyState >= 1) doFreeze()
      else el.addEventListener('loadedmetadata', doFreeze, { once: true })
    }
  }, [outgoingSignature]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Video volume sync ────────────────────────────────────────────────────
  useEffect(() => {
    for (const item of timelineItems) {
      videoRefs.current.get(item.id)!?.volume != null &&
        (videoRefs.current.get(item.id)!.volume = Math.min(1, (item.volume ?? 100) / 100))
    }
  }, [timelineItems])

  // ── Audio seek while paused ───────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) return
    for (const [id, el] of audioEls.current) {
      const item = timelineItems.find(i => i.id === id)
      if (!item) continue
      const st = srcSec(item, currentTime)
      if (st >= 0 && isFinite(st)) el.currentTime = Math.max(0, st)
    }
  }, [currentTime, isPlaying])

  // ── Playback ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) {
      for (const [, el] of videoRefs.current) el.pause()
      for (const [, el] of audioEls.current) el.pause()
      cancelAnimationFrame(rafRef.current)
      playRef.current = null
      prevAudioIds.current = new Set()
      prevVideoIds.current = new Set()
      return
    }

    playRef.current = { wallTime: performance.now(), timelineTime: currentTime }

    // Start all currently-active video items
    const startVideoIds = new Set<string>()
    for (const item of timelineItems) {
      const clip = clips.find(c => c.id === item.clipId)
      if (!clip || clip.type !== 'video' || !inRange(item, currentTime)) continue
      const el = videoRefs.current.get(item.id)
      if (!el) continue
      const src = `file://${clip.path}`
      if (el.src !== src) { el.src = src; el.currentTime = srcSec(item, currentTime) }
      el.play().catch(() => {})
      startVideoIds.add(item.id)
    }
    prevVideoIds.current = startVideoIds

    // Start active audio
    const startAudioIds = new Set<string>()
    for (const [id, el] of audioEls.current) {
      const item = timelineItems.find(i => i.id === id)
      if (!item || !inRange(item, currentTime)) continue
      el.currentTime = Math.max(0, srcSec(item, currentTime))
      el.play().catch(() => {})
      startAudioIds.add(id)
    }
    prevAudioIds.current = startAudioIds

    const tick = () => {
      if (!playRef.current) return
      const elapsed = performance.now() - playRef.current.wallTime
      const newTime  = playRef.current.timelineTime + elapsed

      if (newTime >= getTimelineDuration()) {
        setIsPlaying(false); setCurrentTime(0); return
      }

      const { timelineItems: items, clips: cs } = useEditorStore.getState()

      // Multi-video: start/stop video elements as clips enter/leave range
      const nowVideoIds = new Set<string>()
      for (const vItem of items) {
        const c = cs.find(cl => cl.id === vItem.clipId)
        if (!c || c.type !== 'video' || !inRange(vItem, newTime)) continue
        nowVideoIds.add(vItem.id)
        const el = videoRefs.current.get(vItem.id)
        if (!el || prevVideoIds.current.has(vItem.id)) continue
        const src = `file://${c.path}`
        if (el.src !== src) el.src = src
        el.currentTime = srcSec(vItem, newTime)
        el.play().catch(() => {})
      }
      for (const id of prevVideoIds.current) {
        if (!nowVideoIds.has(id)) videoRefs.current.get(id)?.pause()
      }
      prevVideoIds.current = nowVideoIds

      // Audio
      const nowAudioIds = new Set<string>()
      for (const [id, el] of audioEls.current) {
        const aItem = items.find(i => i.id === id)
        if (!aItem || !inRange(aItem, newTime)) {
          if (prevAudioIds.current.has(id)) el.pause()
          continue
        }
        nowAudioIds.add(id)
        if (!prevAudioIds.current.has(id)) {
          el.currentTime = Math.max(0, srcSec(aItem, newTime))
          el.play().catch(() => {})
        }
      }
      prevAudioIds.current = nowAudioIds

      setCurrentTime(newTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
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
    if (timelineItems.length === 0) return
    setIsPlaying(!isPlaying)
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    setIsPlaying(false)
    setCurrentTime(snapToFrame(parseFloat(e.target.value), useEditorStore.getState().fps))
  }

  const activeTextOverlays = textOverlays.filter(o => currentTime >= o.startTime && currentTime <= o.endTime)

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
        <div style={{ ...styles.viewport, ...(isFullscreen ? { aspectRatio: '16/9', height: '100%', width: 'auto', maxWidth: '100%' } : {}) }} ref={viewportRef}>
          {timelineItems.length === 0 ? (
            <div style={styles.empty}>Drop clips to the timeline to preview</div>
          ) : (
            <>
              {/* Render all active layers bottom→top */}
              {videoLayers.map(({ item, clip, transState, outItem, outClip }) => {
                const clipTime    = Math.max(0, currentTime - item.startTime)
                const kfTracks   = item.keyframeTracks ?? []
                const baseT      = { ...DEFAULT_TRANSFORM, ...item.transform }
                const baseE      = { ...DEFAULT_EFFECTS,   ...item.effects   }
                const kfT        = kfTracks.length > 0 ? applyKeyframesToTransform(kfTracks, baseT, clipTime) : baseT
                const kfE        = kfTracks.length > 0 ? applyKeyframesToEffects(kfTracks, baseE, clipTime)   : baseE
                const clipDur    = item.trimEnd - item.trimStart
                const kbT        = applyKenBurns(item.kenBurns, clipTime, clipDur, kfT)
                const itemStyle  = buildTransformStyle(kbT, kfE)
                const animStyle  = buildAnimationStyle({ ...DEFAULT_ANIMATION, ...item.animation }, clipTime, clipDur)

                const outItemStyle: LayerStyle = (() => {
                  if (!outItem || !transState) return { outer: {}, inner: {} }
                  const outBase = { ...DEFAULT_TRANSFORM, ...outItem.transform }
                  const outEff  = { ...DEFAULT_EFFECTS,   ...outItem.effects   }
                  const outDur  = outItem.trimEnd - outItem.trimStart
                  const outKfT  = outItem.keyframeTracks?.length
                    ? applyKeyframesToTransform(outItem.keyframeTracks, outBase, outDur) : outBase
                  const extTime = outDur + transState.progress * transState.transition.duration
                  return buildTransformStyle(applyKenBurns(outItem.kenBurns, extTime, outDur, outKfT), outEff)
                })()

                const { outStyle, inStyle, overlayOpacity } = transState
                  ? transitionStyles(transState.transition, transState.progress)
                  : { outStyle: {}, inStyle: {}, overlayOpacity: 0 }
                const { opacity: outOpacity, ...outWrapperStyle } = outStyle
                const { opacity: inOpacity, ...inWrapperStyle } = inStyle

                const animTransform = typeof animStyle.transform === 'string' ? animStyle.transform : ''
                const animFilter = typeof animStyle.filter === 'string' ? animStyle.filter : ''
                const animOpacity = typeof animStyle.opacity === 'number' ? animStyle.opacity : 1
                const transitionOpacity = typeof inOpacity === 'number' ? inOpacity : 1
                const itemOuterStyle: React.CSSProperties = {
                  ...itemStyle.outer,
                  transform: [animTransform, itemStyle.outer.transform].filter(Boolean).join(' '),
                  opacity: animOpacity * transitionOpacity,
                  filter: [animFilter, itemStyle.outer.filter].filter(Boolean).join(' ') || undefined,
                }
                const outOuterStyle: React.CSSProperties = {
                  ...outItemStyle.outer,
                  opacity: typeof outOpacity === 'number' ? outOpacity : undefined,
                }

                const backdropBlur     = kfE.backdropBlur     ?? 0
                const backdropBlurFade = kfE.backdropBlurFade ?? 600
                const bgOpacity        = backdropBlur > 0 && backdropBlurFade > 0
                  ? Math.min(clipTime / backdropBlurFade, (clipDur - clipTime) / backdropBlurFade, 1)
                  : backdropBlur > 0 ? 1 : 0

                return (
                  <div key={item.id} style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d' }}>
                    {/* Backdrop blur — blurs everything painted behind this layer */}
                    {backdropBlur > 0 && (
                      <div style={{
                        position: 'absolute', inset: 0, zIndex: 0,
                        backdropFilter: `blur(${backdropBlur}px)`,
                        WebkitBackdropFilter: `blur(${backdropBlur}px)`,
                        opacity: bgOpacity,
                        pointerEvents: 'none',
                      }} />
                    )}

                    {/* Outgoing (frozen) clip */}
                    {transState && outItem && outClip && (
                      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', ...outWrapperStyle }}>
                        <div style={{ position: 'absolute', inset: 0, ...outOuterStyle }}>
                          {outClip.type === 'video'
                            ? <video ref={getVidRef(`${outItem.id}_out`)} style={{ ...styles.media, ...outItemStyle.inner }} playsInline />
                            : outClip.type === 'solid'
                              ? <div style={{ ...styles.media, ...outItemStyle.inner, background: outClip.color ?? '#000' }} />
                              : <img src={`file://${outClip.path}`} style={{ ...styles.media, ...outItemStyle.inner }} alt="" />
                          }
                        </div>
                      </div>
                    )}

                    {/* Incoming / current clip */}
                    <div style={{ ...styles.animWrapper, ...inWrapperStyle }}>
                      <div style={{ position: 'absolute', inset: 0, ...itemOuterStyle }}>
                        {clip.type === 'video'
                          ? <video ref={getVidRef(item.id)} style={{ ...styles.media, ...itemStyle.inner }} playsInline />
                          : clip.type === 'solid'
                            ? <div style={{ ...styles.media, ...itemStyle.inner, background: clip.color ?? '#000' }} />
                            : <img src={`file://${clip.path}`} style={{ ...styles.media, ...itemStyle.inner }} alt="" />
                        }
                      </div>
                    </div>

                    {/* Fade-to-color overlay */}
                    {transState?.transition.type === 'fade-color' && overlayOpacity > 0 && (
                      <div style={{ position: 'absolute', inset: 0, background: transState.transition.color, opacity: overlayOpacity, pointerEvents: 'none' }} />
                    )}
                  </div>
                )
              })}

              {activeTextOverlays.map(o => <TextOverlayEl key={o.id} overlay={o} />)}

              {transformMode && selectedItem && selectedClip && selectedClip.type !== 'audio' && (
                <TransformOverlay item={selectedItem} viewportEl={viewportRef.current} onUpdate={c => updateTransform(selectedItem.id, c)} />
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
                  src={`file://${hoverPreviewClip.path}`}
                  autoPlay muted loop
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              )}
              {hoverPreviewClip.type === 'image' && (
                <img
                  src={hoverPreviewClip.thumbnail ?? `file://${hoverPreviewClip.path}`}
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
      </div>
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

function TextOverlayEl({ overlay }: { overlay: TextOverlay }) {
  return (
    <div style={{
      position: 'absolute', left: overlay.x, top: overlay.y,
      color: overlay.color, fontSize: overlay.fontSize,
      fontWeight: overlay.bold ? 700 : 400, fontStyle: overlay.italic ? 'italic' : 'normal',
      pointerEvents: 'none', textShadow: '0 1px 4px rgba(0,0,0,0.8)',
      whiteSpace: 'pre', userSelect: 'none',
    }}>
      {overlay.text}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container:    { display: 'flex', flexDirection: 'column', height: '100%', background: '#111', alignItems: 'center' },
  viewportWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#1a1a1a', position: 'relative', flexShrink: 0 },
  viewport:     { position: 'relative', background: '#000', width: '100%', height: '100%', perspective: '800px', perspectiveOrigin: '50% 50%', transformStyle: 'preserve-3d', overflow: 'hidden' },
  animWrapper:  { position: 'absolute', inset: 0, transformStyle: 'preserve-3d' },
  media:        { width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  empty:        { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 14 },
  controls:     { height: 52, width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderTop: '1px solid #2a2a2a', flexShrink: 0 },
  playBtn:      { background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', width: 32 },
  time:         { fontSize: 13, color: '#888', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  seekBar:           { flex: 1, accentColor: '#e63950', cursor: 'pointer', height: 20 },
  transformToggle:   { background: 'none', border: '1px solid #333', color: '#555', fontSize: 18, width: 30, height: 30, borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  transformToggleOn: { borderColor: '#e63950', color: '#e63950', background: 'rgba(230,57,80,0.1)' },

  fsControls: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 20px 16px', background: 'linear-gradient(transparent, rgba(0,0,0,0.85))', transition: 'opacity 0.3s', zIndex: 30, pointerEvents: 'all' },
  fsSeekRow:  { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 },
  fsBtnRow:   { display: 'flex', alignItems: 'center', gap: 8 },
  fsSeekBar:  { flex: 1, accentColor: '#e63950', cursor: 'pointer', height: 4 },
  fsTime:     { fontSize: 14, color: '#ddd', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minWidth: 60, textAlign: 'center' },
  fsBtn:      { background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: '4px 8px', lineHeight: 1, opacity: 0.9 },
}
