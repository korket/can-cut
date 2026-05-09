import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store/useEditorStore'
import type { TextOverlay } from '../types'

function itemEnd(item: any) { return item.startTime + (item.trimEnd - item.trimStart) }
function srcSec(item: any, t: number) { return (item.trimStart + (t - item.startTime)) / 1000 }
function inRange(item: any, t: number) { return t >= item.startTime && t < itemEnd(item) }

export default function PreviewPlayer() {
  const { clips, timelineItems, textOverlays, currentTime, setCurrentTime, isPlaying, setIsPlaying, getTimelineDuration } = useEditorStore()

  const videoRef   = useRef<HTMLVideoElement>(null)
  const audioEls   = useRef<Map<string, HTMLAudioElement>>(new Map())
  const rafRef     = useRef<number>(0)
  const playRef    = useRef<{ wallTime: number; timelineTime: number } | null>(null)
  const prevAudioIds = useRef<Set<string>>(new Set())

  const [activeItemId, setActiveItemId] = useState<string | null>(null)

  const duration = getTimelineDuration()

  // ── Active video item ──────────────────────────────────────────────────────
  useEffect(() => {
    const item = timelineItems.find(i => {
      const clip = clips.find(c => c.id === i.clipId)
      return clip && clip.type !== 'audio' && inRange(i, currentTime)
    })
    setActiveItemId(item?.id ?? null)
  }, [currentTime, timelineItems])

  // ── Audio element pool ─────────────────────────────────────────────────────
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
    }
    for (const [id, el] of audioEls.current) {
      if (!liveIds.has(id)) {
        el.pause(); el.src = ''
        audioEls.current.delete(id)
      }
    }
  }, [timelineItems, clips])

  // ── Sync video source & position ───────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!activeItemId) { video.pause(); video.src = ''; return }
    const item = timelineItems.find(i => i.id === activeItemId)
    if (!item) return
    const clip = clips.find(c => c.id === item.clipId)
    if (!clip || clip.type !== 'video') return

    const expectedSrc = `file://${clip.path}`
    if (video.src !== expectedSrc) video.src = expectedSrc
    const st = srcSec(item, currentTime)
    if (Math.abs(video.currentTime - st) > 0.1) video.currentTime = st
  }, [activeItemId, currentTime])

  // ── Seek audio when not playing ────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) return
    for (const [id, el] of audioEls.current) {
      const item = timelineItems.find(i => i.id === id)
      if (!item) continue
      const st = srcSec(item, currentTime)
      if (st >= 0 && isFinite(st)) el.currentTime = Math.max(0, st)
    }
  }, [currentTime, isPlaying])

  // ── Playback ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (!isPlaying) {
      video.pause()
      for (const [, el] of audioEls.current) el.pause()
      cancelAnimationFrame(rafRef.current)
      playRef.current = null
      prevAudioIds.current = new Set()
      return
    }

    playRef.current = { wallTime: performance.now(), timelineTime: currentTime }

    // Start video
    const item = timelineItems.find(i => i.id === activeItemId)
    const clip = item ? clips.find(c => c.id === item.clipId) : null
    if (clip?.type === 'video') video.play().catch(() => {})

    // Start audio items currently in range
    const startActiveAudioIds = new Set<string>()
    for (const [id, el] of audioEls.current) {
      const audioItem = timelineItems.find(i => i.id === id)
      if (!audioItem) continue
      if (inRange(audioItem, currentTime)) {
        el.currentTime = Math.max(0, srcSec(audioItem, currentTime))
        el.play().catch(() => {})
        startActiveAudioIds.add(id)
      }
    }
    prevAudioIds.current = startActiveAudioIds

    const tick = () => {
      if (!playRef.current) return
      const elapsed = performance.now() - playRef.current.wallTime
      const newTime = playRef.current.timelineTime + elapsed

      if (newTime >= getTimelineDuration()) {
        setIsPlaying(false)
        setCurrentTime(0)
        return
      }

      // Handle audio items crossing boundaries
      const { timelineItems: items, clips: cs } = useEditorStore.getState()
      const nowActiveIds = new Set<string>()

      for (const [id, el] of audioEls.current) {
        const audioItem = items.find(i => i.id === id)
        if (!audioItem) continue
        const clip = cs.find(c => c.id === audioItem.clipId)
        if (!clip || clip.type !== 'audio') continue

        if (inRange(audioItem, newTime)) {
          nowActiveIds.add(id)
          if (!prevAudioIds.current.has(id)) {
            // Just entered range — seek and play
            el.currentTime = Math.max(0, srcSec(audioItem, newTime))
            el.play().catch(() => {})
          }
        } else if (prevAudioIds.current.has(id)) {
          // Just left range — pause
          el.pause()
        }
      }
      prevAudioIds.current = nowActiveIds

      setCurrentTime(newTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying, activeItemId])

  function togglePlay() {
    if (timelineItems.length === 0) return
    setIsPlaying(!isPlaying)
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    setIsPlaying(false)
    setCurrentTime(parseFloat(e.target.value))
  }

  function formatTime(ms: number) {
    const s = ms / 1000
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    const cs = Math.floor((s % 1) * 100)
    return `${m}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
  }

  const activeTextOverlays = textOverlays.filter(o => currentTime >= o.startTime && currentTime <= o.endTime)
  const activeItem = activeItemId ? timelineItems.find(i => i.id === activeItemId) : null
  const activeClip = activeItem ? clips.find(c => c.id === activeItem.clipId) : null

  return (
    <div style={styles.container}>
      <div style={styles.viewportWrap}>
        <div style={styles.viewport}>
          {timelineItems.length === 0 ? (
            <div style={styles.empty}>Drop clips to the timeline to preview</div>
          ) : (
            <>
              <video
                ref={videoRef}
                style={{ ...styles.media, display: activeClip?.type === 'video' ? 'block' : 'none' }}
              />
              {activeClip?.type === 'image' && (
                <img src={`file://${activeClip.path}`} style={styles.media} alt="" />
              )}
              {activeTextOverlays.map(o => <TextOverlayEl key={o.id} overlay={o} />)}
            </>
          )}
        </div>
      </div>
      <div style={styles.controls}>
        <button style={styles.playBtn} onClick={togglePlay}>{isPlaying ? '⏸' : '▶'}</button>
        <span style={styles.time}>{formatTime(currentTime)}</span>
        <input
          type="range" min={0} max={duration || 1} step={16} value={currentTime}
          onChange={handleSeek} style={styles.seekBar}
        />
        <span style={styles.time}>{formatTime(duration)}</span>
      </div>
    </div>
  )
}

function TextOverlayEl({ overlay }: { overlay: TextOverlay }) {
  return (
    <div style={{
      position: 'absolute', left: overlay.x, top: overlay.y,
      color: overlay.color, fontSize: overlay.fontSize,
      fontWeight: overlay.bold ? 700 : 400, fontStyle: overlay.italic ? 'italic' : 'normal',
      pointerEvents: 'none', textShadow: '0 1px 4px rgba(0,0,0,0.8)',
      whiteSpace: 'pre', userSelect: 'none'
    }}>
      {overlay.text}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container:    { display: 'flex', flexDirection: 'column', height: '100%', background: '#111' },
  viewportWrap: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 12 },
  viewport:     { position: 'relative', background: '#000', aspectRatio: '16/9', maxHeight: '100%', maxWidth: '100%', width: '100%' },
  media:        { width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  empty:        { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 13 },
  controls:     { height: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderTop: '1px solid #2a2a2a', flexShrink: 0 },
  playBtn:      { background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', width: 28 },
  time:         { fontSize: 11, color: '#888', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  seekBar:      { flex: 1, accentColor: '#e63950', cursor: 'pointer' },
}
