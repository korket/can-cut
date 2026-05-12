import type { TimelineItem, MediaClip, TextOverlay, Transform, Effects, KenBurns, Animation } from '../types'
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_ANIMATION } from '../types'
import { applyKeyframesToTransform, applyKeyframesToEffects } from './keyframes'

// ── Helpers ────────────────────────────────────────────────────────────────

function ease(p: number) { return p * p * (3 - 2 * p) }

function itemEnd(item: TimelineItem) { return item.startTime + (item.trimEnd - item.trimStart) }

function inRange(item: TimelineItem, t: number) { return t >= item.startTime && t < itemEnd(item) }

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function applyKenBurns(kb: KenBurns, clipTime: number, clipDur: number, tr: Transform): Transform {
  const p = clipDur > 0 ? Math.max(0, clipTime / clipDur) : 0
  const scale = kb.startScale + (kb.endScale - kb.startScale) * p
  return {
    ...tr,
    scaleX: tr.scaleX * scale,
    scaleY: tr.scaleY * scale,
    posX: tr.posX + kb.startX + (kb.endX - kb.startX) * p,
    posY: tr.posY + kb.startY + (kb.endY - kb.startY) * p,
    anchorX: (kb.focalX ?? 50) / 100,
    anchorY: (kb.focalY ?? 50) / 100,
  }
}

function effectsFilter(ef: Effects): string {
  return [
    ef.brightness !== 100 ? `brightness(${ef.brightness / 100})` : '',
    ef.contrast   !== 100 ? `contrast(${ef.contrast / 100})`     : '',
    ef.saturate   !== 100 ? `saturate(${ef.saturate / 100})`     : '',
    ef.hue        !== 0   ? `hue-rotate(${ef.hue}deg)`           : '',
    ef.blur       !== 0   ? `blur(${ef.blur}px)`                 : '',
    ef.opacity    !== 100 ? `opacity(${ef.opacity / 100})`       : '',
    ef.grayscale  !== 0   ? `grayscale(${ef.grayscale / 100})`   : '',
    ef.sepia      !== 0   ? `sepia(${ef.sepia / 100})`           : '',
  ].filter(Boolean).join(' ')
}

async function seekTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const target = Math.max(0, timeSec)
  if (Math.abs(video.currentTime - target) < 0.001) return
  video.currentTime = target
  await new Promise<void>(res => video.addEventListener('seeked', () => res(), { once: true }))
}

function drawMedia(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  W: number, H: number,
  clip: MediaClip, media: HTMLVideoElement | HTMLImageElement | null
) {
  if (clip.type === 'solid') {
    ctx.fillStyle = clip.color ?? '#000'
    ctx.fillRect(0, 0, W, H)
    return
  }
  if (!media) return
  const srcW = clip.type === 'video' ? (media as HTMLVideoElement).videoWidth  : (media as HTMLImageElement).naturalWidth
  const srcH = clip.type === 'video' ? (media as HTMLVideoElement).videoHeight : (media as HTMLImageElement).naturalHeight
  if (!srcW || !srcH) return
  const s = Math.min(W / srcW, H / srcH)
  ctx.drawImage(media as CanvasImageSource, (W - srcW * s) / 2, (H - srcH * s) / 2, srcW * s, srcH * s)
}

// Draws clip content (transforms + crop + effects + media) onto any 2D context,
// centred at its natural W×H coordinate space. No animation outer transform applied here.
function drawClipContent(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  W: number, H: number,
  tr: Transform, ef: Effects, animBlur: number,
  clip: MediaClip,
  videoEls: Map<string, HTMLVideoElement>, imageEls: Map<string, HTMLImageElement>,
  itemId: string
) {
  if (has3DRotation(tr)) {
    const plane = createClipPlane(W, H, tr, ef, animBlur, clip, videoEls, imageEls, itemId)
    drawProjectedPlane(ctx, plane, W, H, tr)
    return
  }

  const fs = effectsFilter(ef)
  const blurPart = animBlur > 0 ? `blur(${animBlur.toFixed(1)}px)` : ''
  const combinedFilter = [blurPart, fs].filter(Boolean).join(' ')
  if (combinedFilter) ctx.filter = combinedFilter

  const ax = tr.anchorX * W
  const ay = tr.anchorY * H
  ctx.translate(ax + tr.posX / 100 * W, ay + tr.posY / 100 * H)
  ctx.rotate(tr.rotation * Math.PI / 180)
  ctx.scale(tr.scaleX * (tr.flipH ? -1 : 1), tr.scaleY * (tr.flipV ? -1 : 1))
  ctx.translate(-ax, -ay)

  if (tr.cropL > 0 || tr.cropR > 0 || tr.cropT > 0 || tr.cropB > 0) {
    ctx.beginPath()
    ctx.rect(
      tr.cropL / 100 * W, tr.cropT / 100 * H,
      W * (1 - tr.cropL / 100 - tr.cropR / 100),
      H * (1 - tr.cropT / 100 - tr.cropB / 100)
    )
    ctx.clip()
  }

  const media = clip.type === 'video' ? (videoEls.get(itemId) ?? null)
              : clip.type === 'image' ? (imageEls.get(clip.id) ?? null)
              : null
  drawMedia(ctx, W, H, clip, media)
}

type DrawCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Point2D = { x: number; y: number }

function has3DRotation(tr: Transform): boolean {
  return Math.abs(tr.pitch) > 0.001 || Math.abs(tr.yaw) > 0.001
}

function project3DPoint(x: number, y: number, W: number, H: number, tr: Transform): Point2D {
  const ax = tr.anchorX * W
  const ay = tr.anchorY * H
  const sx = tr.scaleX * (tr.flipH ? -1 : 1)
  const sy = tr.scaleY * (tr.flipV ? -1 : 1)

  let px = (x - ax) * sx
  let py = (y - ay) * sy
  let pz = 0

  const yaw = tr.yaw * Math.PI / 180
  const cy = Math.cos(yaw)
  const syaw = Math.sin(yaw)
  const yx = px * cy + pz * syaw
  const yz = -px * syaw + pz * cy
  px = yx
  pz = yz

  const pitch = tr.pitch * Math.PI / 180
  const cx = Math.cos(pitch)
  const sxp = Math.sin(pitch)
  const xy = py * cx - pz * sxp
  const xz = py * sxp + pz * cx
  py = xy
  pz = xz

  const rot = tr.rotation * Math.PI / 180
  const cr = Math.cos(rot)
  const sr = Math.sin(rot)
  const rx = px * cr - py * sr
  const ry = px * sr + py * cr

  const worldX = rx + ax + tr.posX / 100 * W
  const worldY = ry + ay + tr.posY / 100 * H
  const perspective = 800
  const originX = W / 2
  const originY = H / 2
  const projection = perspective / Math.max(1, perspective - pz)

  return {
    x: originX + (worldX - originX) * projection,
    y: originY + (worldY - originY) * projection,
  }
}

function drawAffineTriangle(
  ctx: DrawCtx,
  image: CanvasImageSource,
  sx0: number, sy0: number,
  sx1: number, sy1: number,
  sx2: number, sy2: number,
  d0: Point2D, d1: Point2D, d2: Point2D
) {
  const denom = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1)
  if (Math.abs(denom) < 0.0001) return

  const a = (d0.x * (sy1 - sy2) + d1.x * (sy2 - sy0) + d2.x * (sy0 - sy1)) / denom
  const b = (d0.y * (sy1 - sy2) + d1.y * (sy2 - sy0) + d2.y * (sy0 - sy1)) / denom
  const c = (d0.x * (sx2 - sx1) + d1.x * (sx0 - sx2) + d2.x * (sx1 - sx0)) / denom
  const d = (d0.y * (sx2 - sx1) + d1.y * (sx0 - sx2) + d2.y * (sx1 - sx0)) / denom
  const e = (d0.x * (sx1 * sy2 - sx2 * sy1) + d1.x * (sx2 * sy0 - sx0 * sy2) + d2.x * (sx0 * sy1 - sx1 * sy0)) / denom
  const f = (d0.y * (sx1 * sy2 - sx2 * sy1) + d1.y * (sx2 * sy0 - sx0 * sy2) + d2.y * (sx0 * sy1 - sx1 * sy0)) / denom

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(d0.x, d0.y)
  ctx.lineTo(d1.x, d1.y)
  ctx.lineTo(d2.x, d2.y)
  ctx.closePath()
  ctx.clip()
  ctx.transform(a, b, c, d, e, f)
  ctx.drawImage(image, 0, 0)
  ctx.restore()
}

function drawProjectedPlane(ctx: DrawCtx, image: CanvasImageSource, W: number, H: number, tr: Transform) {
  const maxAngle = Math.max(Math.abs(tr.pitch), Math.abs(tr.yaw))
  const steps = Math.max(6, Math.min(24, Math.ceil(maxAngle / 5)))
  const grid: Point2D[][] = []

  for (let row = 0; row <= steps; row++) {
    grid[row] = []
    const y = H * row / steps
    for (let col = 0; col <= steps; col++) {
      const x = W * col / steps
      grid[row][col] = project3DPoint(x, y, W, H, tr)
    }
  }

  for (let row = 0; row < steps; row++) {
    const sy0 = H * row / steps
    const sy1 = H * (row + 1) / steps
    for (let col = 0; col < steps; col++) {
      const sx0 = W * col / steps
      const sx1 = W * (col + 1) / steps
      const p00 = grid[row][col]
      const p10 = grid[row][col + 1]
      const p01 = grid[row + 1][col]
      const p11 = grid[row + 1][col + 1]

      drawAffineTriangle(ctx, image, sx0, sy0, sx1, sy0, sx1, sy1, p00, p10, p11)
      drawAffineTriangle(ctx, image, sx0, sy0, sx1, sy1, sx0, sy1, p00, p11, p01)
    }
  }
}

function createClipPlane(
  W: number, H: number,
  tr: Transform, ef: Effects, animBlur: number,
  clip: MediaClip,
  videoEls: Map<string, HTMLVideoElement>, imageEls: Map<string, HTMLImageElement>,
  itemId: string
): OffscreenCanvas {
  const off = new OffscreenCanvas(W, H)
  const offCtx = off.getContext('2d')!
  const fs = effectsFilter(ef)
  const blurPart = animBlur > 0 ? `blur(${animBlur.toFixed(1)}px)` : ''
  const combinedFilter = [blurPart, fs].filter(Boolean).join(' ')
  if (combinedFilter) offCtx.filter = combinedFilter

  if (tr.cropL > 0 || tr.cropR > 0 || tr.cropT > 0 || tr.cropB > 0) {
    offCtx.beginPath()
    offCtx.rect(
      tr.cropL / 100 * W, tr.cropT / 100 * H,
      W * (1 - tr.cropL / 100 - tr.cropR / 100),
      H * (1 - tr.cropT / 100 - tr.cropB / 100)
    )
    offCtx.clip()
  }

  const media = clip.type === 'video' ? (videoEls.get(itemId) ?? null)
              : clip.type === 'image' ? (imageEls.get(clip.id) ?? null)
              : null
  drawMedia(offCtx, W, H, clip, media)
  return off
}

// Draws one timeline item (with animation outer transform + optional shadow) onto ctx.
async function drawLayer(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  item: TimelineItem, clip: MediaClip,
  clipTime: number,
  videoEls: Map<string, HTMLVideoElement>, imageEls: Map<string, HTMLImageElement>,
  extraOpacity = 1,
  wipeClipPath?: { left?: number; right?: number; top?: number; bottom?: number }
) {
  const clipDur = item.trimEnd - item.trimStart
  const srcTime = (item.trimStart + clipTime) / 1000

  if (clip.type === 'video') {
    const v = videoEls.get(item.id)
    if (v) await seekTo(v, srcTime)
  }

  // Keyframes
  const kfTracks = item.keyframeTracks ?? []
  let tr: Transform = { ...DEFAULT_TRANSFORM, ...item.transform }
  let ef: Effects  = { ...DEFAULT_EFFECTS,   ...item.effects  }
  if (kfTracks.length > 0) {
    tr = applyKeyframesToTransform(kfTracks, tr, clipTime)
    ef = applyKeyframesToEffects(kfTracks, ef, clipTime)
  }
  if (item.kenBurns) tr = applyKenBurns(item.kenBurns, clipTime, clipDur, tr)

  // Backdrop blur: blur whatever is already on the canvas (lower layers) behind this clip
  const backdropBlur     = ef.backdropBlur     ?? 0
  const backdropBlurFade = ef.backdropBlurFade ?? 600
  if (backdropBlur > 0) {
    const bgOpacity = backdropBlurFade > 0
      ? Math.min(clipTime / backdropBlurFade, (clipDur - clipTime) / backdropBlurFade, 1)
      : 1
    if (bgOpacity > 0) {
      const off = new OffscreenCanvas(W, H)
      off.getContext('2d')!.drawImage(ctx.canvas, 0, 0)
      ctx.save()
      ctx.filter = `blur(${backdropBlur}px)`
      ctx.globalAlpha = bgOpacity
      ctx.drawImage(off, 0, 0)
      ctx.restore()
    }
  }

  // Animation outer
  const anim: Animation = { ...DEFAULT_ANIMATION, ...item.animation }
  let animOpacity = 1, animScale = 1, animTx = 0, animTy = 0, animBlur = 0

  const inP  = anim.inEffect  !== 'none' && clipTime < anim.inDuration
    ? ease(Math.max(0, Math.min(1, clipTime / anim.inDuration))) : 1
  const outP = anim.outEffect !== 'none' && (clipDur - clipTime) < anim.outDuration
    ? ease(Math.max(0, Math.min(1, (clipDur - clipTime) / anim.outDuration))) : 1

  switch (anim.inEffect) {
    case 'fade':        animOpacity *= inP; break
    case 'zoom-in':     animScale = 0.3 + 0.7 * inP; break
    case 'zoom-out':    animScale = 1.7 - 0.7 * inP; break
    case 'slide-left':  animTx = (inP - 1) * W; break
    case 'slide-right': animTx = (1 - inP) * W; break
    case 'slide-up':    animTy = (inP - 1) * H; break
    case 'slide-down':  animTy = (1 - inP) * H; break
    case 'blur-in':     animBlur += 20 * (1 - inP); break
  }
  switch (anim.outEffect) {
    case 'fade':        animOpacity *= outP; break
    case 'zoom-in':     if (outP < 1) animScale *= 1 + 0.7 * (1 - outP); break
    case 'zoom-out':    if (outP < 1) animScale *= outP * 0.7 + 0.3; break
    case 'slide-left':  if (outP < 1) animTx = (outP - 1) * W; break
    case 'slide-right': if (outP < 1) animTx = (1 - outP) * W; break
    case 'slide-up':    if (outP < 1) animTy = (outP - 1) * H; break
    case 'slide-down':  if (outP < 1) animTy = (1 - outP) * H; break
    case 'blur-out':    if (outP < 1) animBlur += 20 * (1 - outP); break
  }

  const totalOpacity = animOpacity * extraOpacity
  const hasShadow = ef.shadowOpacity > 0

  if (hasShadow) {
    // Render clip content to offscreen so shadow extends outside the crop clip-path
    const off = new OffscreenCanvas(W, H)
    const offCtx = off.getContext('2d')!
    offCtx.save()
    drawClipContent(offCtx, W, H, tr, ef, animBlur, clip, videoEls, imageEls, item.id)
    offCtx.restore()

    ctx.save()
    ctx.translate(W / 2 + animTx, H / 2 + animTy)
    ctx.scale(animScale, animScale)
    ctx.translate(-W / 2, -H / 2)
    ctx.globalAlpha = totalOpacity
    if (wipeClipPath) applyWipeClip(ctx, W, H, wipeClipPath)
    ctx.shadowColor    = hexToRgba(ef.shadowColor ?? '#000000', ef.shadowOpacity / 100)
    ctx.shadowBlur     = ef.shadowBlur
    ctx.shadowOffsetX  = ef.shadowX
    ctx.shadowOffsetY  = ef.shadowY
    ctx.drawImage(off, 0, 0)
    ctx.restore()
  } else {
    ctx.save()
    ctx.translate(W / 2 + animTx, H / 2 + animTy)
    ctx.scale(animScale, animScale)
    ctx.translate(-W / 2, -H / 2)
    ctx.globalAlpha = totalOpacity
    if (wipeClipPath) applyWipeClip(ctx, W, H, wipeClipPath)
    drawClipContent(ctx, W, H, tr, ef, animBlur, clip, videoEls, imageEls, item.id)
    ctx.restore()
  }
}

function applyWipeClip(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  wipe: { left?: number; right?: number; top?: number; bottom?: number }
) {
  ctx.beginPath()
  const x = (wipe.left ?? 0) * W
  const y = (wipe.top  ?? 0) * H
  const w = W - x - (wipe.right  ?? 0) * W
  const h = H - y - (wipe.bottom ?? 0) * H
  ctx.rect(x, y, w, h)
  ctx.clip()
}

// ── Per-frame render ──────────────────────────────────────────────────────

async function renderFrame(
  ctx: CanvasRenderingContext2D, W: number, H: number, timeMs: number,
  timelineItems: TimelineItem[], clips: MediaClip[], textOverlays: TextOverlay[],
  videoEls: Map<string, HTMLVideoElement>, imageEls: Map<string, HTMLImageElement>
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.filter = 'none'
  ctx.globalAlpha = 1
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const layers = timelineItems
    .filter(item => {
      const c = clips.find(cl => cl.id === item.clipId)
      return c && c.type !== 'audio' && inRange(item, timeMs)
    })
    .sort((a, b) => a.trackIndex - b.trackIndex)

  for (const item of layers) {
    const clip = clips.find(c => c.id === item.clipId)!
    const clipTime = timeMs - item.startTime
    const clipDur  = item.trimEnd - item.trimStart

    // ── Transition: find outgoing item and render it first ──────────────────
    const trans = item.transitionIn
    if (trans && trans.type !== 'cut' && clipTime < trans.duration) {
      const progress = clipTime / trans.duration
      const outItem  = timelineItems.find(i =>
        i.trackIndex === item.trackIndex && i.id !== item.id &&
        Math.abs(itemEnd(i) - item.startTime) < 500
      )
      const outClip = outItem ? clips.find(c => c.id === outItem.clipId) : null

      if (outItem && outClip && outClip.type !== 'audio') {
        const outClipTime = outItem.trimEnd - outItem.trimStart  // frozen at last frame

        switch (trans.type) {
          case 'crossfade':
            await drawLayer(ctx, W, H, outItem, outClip, outClipTime, videoEls, imageEls, 1 - progress)
            await drawLayer(ctx, W, H, item,    clip,    clipTime,    videoEls, imageEls, progress)
            break

          case 'fade-color': {
            const outAlpha = Math.max(0, 1 - progress * 2)
            const inAlpha  = Math.max(0, (progress - 0.5) * 2)
            const overlayA = Math.sin(progress * Math.PI)
            await drawLayer(ctx, W, H, outItem, outClip, outClipTime, videoEls, imageEls, outAlpha)
            if (overlayA > 0) {
              ctx.save()
              ctx.globalAlpha = overlayA
              ctx.fillStyle = trans.color
              ctx.fillRect(0, 0, W, H)
              ctx.restore()
            }
            await drawLayer(ctx, W, H, item, clip, clipTime, videoEls, imageEls, inAlpha)
            break
          }

          case 'wipe-left':
            await drawLayer(ctx, W, H, outItem, outClip, outClipTime, videoEls, imageEls, 1)
            await drawLayer(ctx, W, H, item, clip, clipTime, videoEls, imageEls, 1,
              { right: 1 - progress })
            break

          case 'wipe-right':
            await drawLayer(ctx, W, H, outItem, outClip, outClipTime, videoEls, imageEls, 1)
            await drawLayer(ctx, W, H, item, clip, clipTime, videoEls, imageEls, 1,
              { left: 1 - progress })
            break

          case 'wipe-up':
            await drawLayer(ctx, W, H, outItem, outClip, outClipTime, videoEls, imageEls, 1)
            await drawLayer(ctx, W, H, item, clip, clipTime, videoEls, imageEls, 1,
              { bottom: 1 - progress })
            break

          case 'wipe-down':
            await drawLayer(ctx, W, H, outItem, outClip, outClipTime, videoEls, imageEls, 1)
            await drawLayer(ctx, W, H, item, clip, clipTime, videoEls, imageEls, 1,
              { top: 1 - progress })
            break
        }
        continue
      }
    }

    await drawLayer(ctx, W, H, item, clip, clipTime, videoEls, imageEls)
  }

  // ── Text overlays ─────────────────────────────────────────────────────────
  for (const ov of textOverlays) {
    if (timeMs >= ov.startTime && timeMs < ov.endTime) {
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.filter = 'none'
      ctx.globalAlpha = 1
      ctx.font = [
        ov.italic ? 'italic' : '',
        ov.bold   ? 'bold'   : '',
        `${ov.fontSize}px`,
        ov.fontFamily || 'sans-serif',
      ].filter(Boolean).join(' ')
      ctx.textBaseline = 'top'
      ctx.fillStyle = ov.color
      // Mirror preview's textShadow: '0 1px 4px rgba(0,0,0,0.8)'
      ctx.shadowColor   = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur    = 4
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 1
      ctx.fillText(ov.text, ov.x, ov.y)
      ctx.restore()
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface ExportRenderOptions {
  resolution: string
  fps: number
  duration: number
  timelineItems: TimelineItem[]
  clips: MediaClip[]
  textOverlays: TextOverlay[]
}

export async function renderAndExport(
  opts: ExportRenderOptions,
  onProgress: (pct: number) => void
): Promise<{ success?: boolean; path?: string; error?: string; canceled?: boolean }> {

  const [W, H] = opts.resolution.split('x').map(Number)
  const { fps, duration: totalMs, timelineItems, clips, textOverlays } = opts
  const frameMs = 1000 / fps
  const frameCount = Math.ceil(totalMs / 1000 * fps)

  // Pre-load all media elements
  const videoEls = new Map<string, HTMLVideoElement>()
  const imageEls = new Map<string, HTMLImageElement>()

  const loads: Promise<void>[] = []
  for (const item of timelineItems) {
    const clip = clips.find(c => c.id === item.clipId)
    if (!clip) continue
    if (clip.type === 'video' && !videoEls.has(item.id)) {
      const v = document.createElement('video')
      v.src = `file://${clip.path}`; v.preload = 'auto'; v.muted = true
      loads.push(new Promise<void>(res => {
        v.addEventListener('loadedmetadata', () => res(), { once: true })
        v.addEventListener('error', () => res(), { once: true })
        v.load()
      }))
      videoEls.set(item.id, v)
    } else if (clip.type === 'image' && !imageEls.has(clip.id)) {
      const img = new Image()
      img.src = `file://${clip.path}`
      loads.push(new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res() }))
      imageEls.set(clip.id, img)
    }
  }
  await Promise.all(loads)

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const startResult = await window.api.startFrameExport({
    W, H, fps, totalMs,
    clips: clips.map(c => ({ id: c.id, path: c.path ?? '', type: c.type, width: c.width, height: c.height })),
    timelineItems: timelineItems.map(i => ({
      id: i.id, clipId: i.clipId, trackIndex: i.trackIndex,
      startTime: i.startTime, trimStart: i.trimStart, trimEnd: i.trimEnd,
      volume: i.volume ?? 100,
    })),
  })
  if (startResult?.canceled) return { canceled: true }
  if (startResult?.error)    return { error: startResult.error }

  try {
    for (let f = 0; f < frameCount; f++) {
      await renderFrame(ctx, W, H, f * frameMs, timelineItems, clips, textOverlays, videoEls, imageEls)

      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', 0.92)
      )
      await window.api.sendExportFrame(await blob.arrayBuffer())
      onProgress(Math.round((f + 1) / frameCount * 85))
    }

    onProgress(90)
    const result = await window.api.finishFrameExport()
    onProgress(100)
    return result

  } catch (err: unknown) {
    await window.api.finishFrameExport().catch(() => {})
    return { error: String(err) }
  } finally {
    videoEls.forEach(v => { v.src = ''; v.load() })
  }
}
