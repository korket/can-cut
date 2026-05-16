import { evaluateClipAtTime } from '../editor-core/evaluation'
import { getClipSourceTimeMs, getItemEnd, isItemActiveAt } from '../editor-core/timeline'
import type { CompositeMode, Effects, MediaClip, TextOverlay, TimelineItem, Transform } from '../types'
import { renderCanvasFrame } from './canvasFrameRenderer'
import type { CanvasPreviewRenderer } from './canvasPreviewRenderer'
import {
  activeCanvasVideosReady,
  disposeCanvasMedia,
  loadCanvasMedia,
  pauseCanvasVideos,
  syncCanvasVideoPlayback,
  type LoadedCanvasMedia,
} from './mediaElementLoader'

interface PreviewRenderRequest {
  timeMs: number
  timelineItems: TimelineItem[]
  clips: MediaClip[]
  textOverlays: TextOverlay[]
  playbackActive: boolean
  generation: number
}

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

interface Point {
  x: number
  y: number
}

interface GpuLayerState {
  item: TimelineItem
  clip: MediaClip
  clipTime: number
  transform: Transform
  effects: Effects
  animation: {
    opacity: number
    scale: number
    translateXPct: number
    translateYPct: number
    blurPx: number
  }
}

type TextureSource = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement

const NEAR_ZERO = 0.001

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader

  console.warn('GPU preview shader compile failed', gl.getShaderInfoLog(shader))
  gl.deleteShader(shader)
  return null
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D u_frame;
    uniform bool u_useTexture;
    uniform vec4 u_solidColor;
    uniform float u_opacity;
    uniform float u_brightness;
    uniform float u_contrast;
    uniform float u_saturation;
    varying vec2 v_texCoord;

    void main() {
      vec4 color = u_useTexture ? texture2D(u_frame, v_texCoord) : u_solidColor;
      color.rgb *= u_brightness;
      color.rgb = (color.rgb - 0.5) * u_contrast + 0.5;
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(vec3(luma), color.rgb, u_saturation);
      color.rgb = clamp(color.rgb, 0.0, 1.0);
      color.a *= u_opacity;
      gl_FragColor = color;
    }
  `)

  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader)
    if (fragmentShader) gl.deleteShader(fragmentShader)
    return null
  }

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    return null
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program

  console.warn('GPU preview program link failed', gl.getProgramInfoLog(program))
  gl.deleteProgram(program)
  return null
}

function createBuffer(gl: WebGLRenderingContext): WebGLBuffer | null {
  const buffer = gl.createBuffer()
  if (!buffer) return null
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, 8 * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW)
  return buffer
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function near(value: number, target = 0): boolean {
  return Math.abs(value - target) < NEAR_ZERO
}

function parseHexColor(hex: string | undefined): [number, number, number, number] {
  const normalized = (hex || '#000000').replace('#', '').trim()
  const value = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized.padEnd(6, '0').slice(0, 6)
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return [
    Number.isFinite(r) ? r / 255 : 0,
    Number.isFinite(g) ? g / 255 : 0,
    Number.isFinite(b) ? b / 255 : 0,
    1,
  ]
}

function cropRect(transform: Transform, width: number, height: number): Rect | null {
  const left = clamp(transform.cropL, 0, 100) / 100 * width
  const top = clamp(transform.cropT, 0, 100) / 100 * height
  const right = width - clamp(transform.cropR, 0, 100) / 100 * width
  const bottom = height - clamp(transform.cropB, 0, 100) / 100 * height
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom }
}

function intersectRect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.right, b.right)
  const bottom = Math.min(a.bottom, b.bottom)
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom }
}

function sourceRectForClip(
  clip: MediaClip,
  source: HTMLImageElement | HTMLVideoElement,
  width: number,
  height: number
): Rect | null {
  const sourceWidth = clip.type === 'video'
    ? (source as HTMLVideoElement).videoWidth
    : (source as HTMLImageElement).naturalWidth
  const sourceHeight = clip.type === 'video'
    ? (source as HTMLVideoElement).videoHeight
    : (source as HTMLImageElement).naturalHeight
  if (!sourceWidth || !sourceHeight) return null

  const scale = Math.min(width / sourceWidth, height / sourceHeight)
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  const left = (width - drawWidth) / 2
  const top = (height - drawHeight) / 2
  return { left, top, right: left + drawWidth, bottom: top + drawHeight }
}

function transformPoint(point: Point, width: number, height: number, layer: GpuLayerState): Point {
  const tr = layer.transform
  const ax = tr.anchorX * width
  const ay = tr.anchorY * height
  const scaleX = tr.scaleX * (tr.flipH ? -1 : 1)
  const scaleY = tr.scaleY * (tr.flipV ? -1 : 1)
  const rotation = tr.rotation * Math.PI / 180
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  const localX = (point.x - ax) * scaleX
  const localY = (point.y - ay) * scaleY
  const rotatedX = localX * cos - localY * sin
  const rotatedY = localX * sin + localY * cos
  const worldX = rotatedX + ax + tr.posX / 100 * width
  const worldY = rotatedY + ay + tr.posY / 100 * height

  const animTx = layer.animation.translateXPct / 100 * width
  const animTy = layer.animation.translateYPct / 100 * height

  return {
    x: (worldX - width / 2) * layer.animation.scale + width / 2 + animTx,
    y: (worldY - height / 2) * layer.animation.scale + height / 2 + animTy,
  }
}

function pointToClipSpace(point: Point, width: number, height: number): Point {
  return {
    x: point.x / width * 2 - 1,
    y: 1 - point.y / height * 2,
  }
}

function rectPositions(rect: Rect, width: number, height: number, layer: GpuLayerState): Float32Array {
  const topLeft = pointToClipSpace(transformPoint({ x: rect.left, y: rect.top }, width, height, layer), width, height)
  const topRight = pointToClipSpace(transformPoint({ x: rect.right, y: rect.top }, width, height, layer), width, height)
  const bottomLeft = pointToClipSpace(transformPoint({ x: rect.left, y: rect.bottom }, width, height, layer), width, height)
  const bottomRight = pointToClipSpace(transformPoint({ x: rect.right, y: rect.bottom }, width, height, layer), width, height)

  return new Float32Array([
    topLeft.x, topLeft.y,
    topRight.x, topRight.y,
    bottomLeft.x, bottomLeft.y,
    bottomRight.x, bottomRight.y,
  ])
}

function fullCanvasPositions(): Float32Array {
  return new Float32Array([
    -1,  1,
     1,  1,
    -1, -1,
     1, -1,
  ])
}

function fullTextureCoords(): Float32Array {
  return new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ])
}

function textureCoordsForRect(rect: Rect, sourceRect: Rect): Float32Array {
  const width = sourceRect.right - sourceRect.left
  const height = sourceRect.bottom - sourceRect.top
  const left = (rect.left - sourceRect.left) / width
  const right = (rect.right - sourceRect.left) / width
  const top = (rect.top - sourceRect.top) / height
  const bottom = (rect.bottom - sourceRect.top) / height

  return new Float32Array([
    left, top,
    right, top,
    left, bottom,
    right, bottom,
  ])
}

function solidTextureCoords(): Float32Array {
  return new Float32Array(8)
}

function hasActiveTextOverlay(textOverlays: TextOverlay[], timeMs: number): boolean {
  return textOverlays.some((overlay) => timeMs >= overlay.startTime && timeMs < overlay.endTime)
}

function hasActiveTransition(item: TimelineItem, timeMs: number, timelineItems: TimelineItem[], clips: MediaClip[]): boolean {
  const transition = item.transitionIn
  if (!transition || transition.type === 'cut') return false
  if (timeMs < item.startTime || timeMs >= item.startTime + transition.duration) return false

  const outItem = timelineItems.find((candidate) =>
    candidate.trackIndex === item.trackIndex &&
    candidate.id !== item.id &&
    Math.abs(getItemEnd(candidate) - item.startTime) < 500
  )
  if (!outItem) return false
  const outClip = clips.find((candidate) => candidate.id === outItem.clipId)
  return Boolean(outClip && outClip.type !== 'audio')
}

function isSupportedCompositeMode(mode: CompositeMode | undefined): boolean {
  return !mode || mode === 'normal' || mode === 'add'
}

function isSupportedEffects(effects: Effects): boolean {
  return near(effects.hue) &&
    near(effects.blur) &&
    near(effects.grayscale) &&
    near(effects.sepia) &&
    near(effects.shadowOpacity) &&
    near(effects.backdropBlur) &&
    isSupportedCompositeMode(effects.compositeMode)
}

function isSupportedTransform(transform: Transform): boolean {
  return near(transform.pitch) && near(transform.yaw)
}

function layerStateForItem(item: TimelineItem, clip: MediaClip, timeMs: number): GpuLayerState {
  const clipTime = timeMs - item.startTime
  const evaluated = evaluateClipAtTime(item, clipTime)
  return {
    item,
    clip,
    clipTime,
    transform: evaluated.transform,
    effects: evaluated.effects,
    animation: evaluated.animation,
  }
}

function getActiveGpuLayers(timeMs: number, timelineItems: TimelineItem[], clips: MediaClip[]): GpuLayerState[] {
  return timelineItems
    .filter((item) => isItemActiveAt(item, timeMs))
    .flatMap((item) => {
      const clip = clips.find((candidate) => candidate.id === item.clipId)
      return clip && clip.type !== 'audio' ? [layerStateForItem(item, clip, timeMs)] : []
    })
    .sort((a, b) => a.item.trackIndex - b.item.trackIndex || a.item.startTime - b.item.startTime)
}

function requiresCanvasFallback(
  request: PreviewRenderRequest,
  layers: GpuLayerState[]
): boolean {
  if (hasActiveTextOverlay(request.textOverlays, request.timeMs)) return true

  return layers.some((layer) =>
    hasActiveTransition(layer.item, request.timeMs, request.timelineItems, request.clips) ||
    !isSupportedTransform(layer.transform) ||
    !isSupportedEffects(layer.effects) ||
    !near(layer.animation.blurPx)
  )
}

function waitForVideoFrame(video: HTMLVideoElement, timeSec: number, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const cleanup = () => {
      clearTimeout(timeout)
      video.removeEventListener('seeked', done)
      video.removeEventListener('loadeddata', done)
      video.removeEventListener('canplay', done)
      video.removeEventListener('error', done)
    }
    const done = () => {
      cleanup()
      resolve()
    }
    const timeout = setTimeout(done, timeoutMs)
    video.addEventListener('seeked', done, { once: true })
    video.addEventListener('loadeddata', done, { once: true })
    video.addEventListener('canplay', done, { once: true })
    video.addEventListener('error', done, { once: true })
  })
}

async function seekTo(video: HTMLVideoElement, timeSec: number, timeoutMs = 90): Promise<void> {
  const maxSeekTime = Number.isFinite(video.duration) && video.duration > 0
    ? Math.max(0, video.duration - 0.001)
    : Number.POSITIVE_INFINITY
  const target = Math.max(0, Math.min(timeSec, maxSeekTime))
  if (Math.abs(video.currentTime - target) < 0.001) {
    if (video.readyState >= 2) return
    await waitForVideoFrame(video, target, timeoutMs)
    return
  }

  video.currentTime = target
  await waitForVideoFrame(video, target, timeoutMs)
}

export function createGpuPreviewRenderer(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): CanvasPreviewRenderer | null {
  canvas.width = width
  canvas.height = height

  const gl = canvas.getContext('webgl', { alpha: false, antialias: false })
  if (!gl) return null

  const program = createProgram(gl)
  if (!program) return null

  const positionBuffer = createBuffer(gl)
  const texCoordBuffer = createBuffer(gl)
  const texture = gl.createTexture()
  if (!positionBuffer || !texCoordBuffer || !texture) return null

  const positionLoc = gl.getAttribLocation(program, 'a_position')
  const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord')
  if (positionLoc < 0 || texCoordLoc < 0) return null

  const frameLoc = gl.getUniformLocation(program, 'u_frame')
  const useTextureLoc = gl.getUniformLocation(program, 'u_useTexture')
  const solidColorLoc = gl.getUniformLocation(program, 'u_solidColor')
  const opacityLoc = gl.getUniformLocation(program, 'u_opacity')
  const brightnessLoc = gl.getUniformLocation(program, 'u_brightness')
  const contrastLoc = gl.getUniformLocation(program, 'u_contrast')
  const saturationLoc = gl.getUniformLocation(program, 'u_saturation')

  const backingCanvas = document.createElement('canvas')
  backingCanvas.width = width
  backingCanvas.height = height
  const backingCtx = backingCanvas.getContext('2d', { alpha: false })
  if (!backingCtx) return null

  let disposed = false
  let mediaGeneration = 0
  let media: LoadedCanvasMedia | null = null
  let renderRequest: PreviewRenderRequest | null = null
  let renderRunning = false
  let playbackActive = false
  let playbackTimeMs = 0
  let playbackTimelineItems: TimelineItem[] = []
  let renderGeneration = 0

  function configureTexture(source: TextureSource): boolean {
    try {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
      return true
    } catch (err) {
      console.warn('GPU preview texture upload failed', err)
      return false
    }
  }

  function drawQuad(options: {
    positions: Float32Array
    texCoords: Float32Array
    source?: TextureSource
    color?: [number, number, number, number]
    opacity?: number
    brightness?: number
    contrast?: number
    saturation?: number
    compositeMode?: CompositeMode
  }): boolean {
    const useTexture = Boolean(options.source)
    if (options.source && !configureTexture(options.source)) return false

    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, options.positions, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(positionLoc)
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, options.texCoords, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(texCoordLoc)
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0)

    if (options.compositeMode === 'add') {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    } else {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    }

    gl.uniform1i(frameLoc, 0)
    gl.uniform1i(useTextureLoc, useTexture ? 1 : 0)
    gl.uniform4fv(solidColorLoc, options.color ?? [0, 0, 0, 1])
    gl.uniform1f(opacityLoc, options.opacity ?? 1)
    gl.uniform1f(brightnessLoc, options.brightness ?? 1)
    gl.uniform1f(contrastLoc, options.contrast ?? 1)
    gl.uniform1f(saturationLoc, options.saturation ?? 1)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return true
  }

  function drawBackingTexture() {
    drawQuad({
      positions: fullCanvasPositions(),
      texCoords: fullTextureCoords(),
      source: backingCanvas,
    })
  }

  function clearGl() {
    gl.viewport(0, 0, width, height)
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  function clear() {
    backingCtx.setTransform(1, 0, 0, 1, 0, 0)
    backingCtx.fillStyle = '#000'
    backingCtx.fillRect(0, 0, width, height)
    clearGl()
  }

  function disposeCurrentMedia() {
    if (!media) return
    disposeCanvasMedia(media)
    media = null
  }

  function getLayerSource(layer: GpuLayerState): HTMLImageElement | HTMLVideoElement | null {
    if (!media) return null
    if (layer.clip.type === 'video') return media.videoEls.get(layer.item.id) ?? null
    if (layer.clip.type === 'image') return media.imageEls.get(layer.clip.id) ?? null
    return null
  }

  async function prepareVideoLayers(layers: GpuLayerState[]) {
    if (!media) return
    for (const layer of layers) {
      if (layer.clip.type !== 'video') continue
      const video = media.videoEls.get(layer.item.id)
      if (!video) continue
      const sourceTime = getClipSourceTimeMs(layer.item, layer.item.startTime + layer.clipTime) / 1000
      await seekTo(video, sourceTime)
    }
  }

  function drawGpuLayer(layer: GpuLayerState): boolean {
    const opacity = layer.animation.opacity * clamp(layer.effects.opacity / 100, 0, 1)
    if (opacity <= 0) return true

    const cropped = cropRect(layer.transform, width, height)
    if (!cropped) return true

    if (layer.clip.type === 'solid') {
      return drawQuad({
        positions: rectPositions(cropped, width, height, layer),
        texCoords: solidTextureCoords(),
        color: parseHexColor(layer.clip.color),
        opacity,
        brightness: layer.effects.brightness / 100,
        contrast: layer.effects.contrast / 100,
        saturation: layer.effects.saturate / 100,
        compositeMode: layer.effects.compositeMode,
      })
    }

    const source = getLayerSource(layer)
    if (!source) return true

    const sourceRect = sourceRectForClip(layer.clip, source, width, height)
    if (!sourceRect) return true

    const visibleRect = intersectRect(cropped, sourceRect)
    if (!visibleRect) return true

    return drawQuad({
      positions: rectPositions(visibleRect, width, height, layer),
      texCoords: textureCoordsForRect(visibleRect, sourceRect),
      source,
      opacity,
      brightness: layer.effects.brightness / 100,
      contrast: layer.effects.contrast / 100,
      saturation: layer.effects.saturate / 100,
      compositeMode: layer.effects.compositeMode,
    })
  }

  async function renderGpuFrame(request: PreviewRenderRequest): Promise<boolean> {
    if (!media) return false

    const layers = getActiveGpuLayers(request.timeMs, request.timelineItems, request.clips)
    if (requiresCanvasFallback(request, layers)) return false

    if (request.playbackActive) {
      syncCanvasVideoPlayback(media, request.timeMs, request.timelineItems)
      if (!activeCanvasVideosReady(media, request.timeMs, request.timelineItems)) return true
    } else {
      await prepareVideoLayers(layers)
    }
    if (disposed) return true
    if (request.generation !== renderGeneration) return true


    clear()
    for (const layer of layers) {
      if (!drawGpuLayer(layer)) return false
    }
    return true
  }

  async function renderCanvasFallback(request: PreviewRenderRequest) {
    if (!media) return
    const renderOptions = request.playbackActive
      ? { seekTimeoutMs: 90, realtimeVideoPlayback: true, shouldContinue: () => request.generation === renderGeneration }
      : { seekTimeoutMs: 120, strictSeek: true, prepareVideoBeforeClear: true, shouldContinue: () => request.generation === renderGeneration }

    await renderCanvasFrame(
      backingCtx,
      width,
      height,
      request.timeMs,
      request.timelineItems,
      request.clips,
      request.textOverlays,
      media,
      renderOptions
    )
    clearGl()
    drawBackingTexture()
  }

  async function flushRenderQueue() {
    if (renderRunning) return
    renderRunning = true

    try {
      while (renderRequest && !disposed) {
        const request = renderRequest
        renderRequest = null

        if (!media) {
          clear()
          continue
        }

        try {
          if (request.generation !== renderGeneration) continue
          const renderedWithGpu = await renderGpuFrame(request)
          if (!renderedWithGpu && !disposed) await renderCanvasFallback(request)
        } catch (err) {
          console.error('GPU preview render failed', err)
          if (!disposed) await renderCanvasFallback(request)
        }
      }
    } finally {
      renderRunning = false
      if (renderRequest && !disposed) void flushRenderQueue()
    }
  }

  clear()

  return {
    async loadMedia(timelineItems: TimelineItem[], clips: MediaClip[]) {
      const generation = ++mediaGeneration
      disposeCurrentMedia()
      clear()

      const loadedMedia = await loadCanvasMedia(timelineItems, clips)
      if (disposed || generation !== mediaGeneration) {
        disposeCanvasMedia(loadedMedia)
        return
      }

      media = loadedMedia
      if (playbackActive) syncCanvasVideoPlayback(media, playbackTimeMs, playbackTimelineItems)
      if (renderRequest) void flushRenderQueue()
    },
    render(timeMs: number, timelineItems: TimelineItem[], clips: MediaClip[], textOverlays: TextOverlay[]) {
      if (playbackActive) {
        playbackTimeMs = timeMs
        playbackTimelineItems = timelineItems
      }
      renderRequest = { timeMs, timelineItems, clips, textOverlays, playbackActive, generation: renderGeneration }
      if (!media) {
        clear()
        return
      }
      void flushRenderQueue()
    },
    startPlayback(timeMs: number, timelineItems: TimelineItem[]) {
      renderGeneration++
      playbackActive = true
      playbackTimeMs = timeMs
      playbackTimelineItems = timelineItems
      syncCanvasVideoPlayback(media, timeMs, timelineItems)
    },
    stopPlayback() {
      renderGeneration++
      playbackActive = false
      pauseCanvasVideos(media)
    },
    clear,
    dispose() {
      disposed = true
      playbackActive = false
      renderGeneration++
      mediaGeneration++
      renderRequest = null
      pauseCanvasVideos(media)
      disposeCurrentMedia()
      gl.deleteTexture(texture)
      gl.deleteBuffer(positionBuffer)
      gl.deleteBuffer(texCoordBuffer)
      gl.deleteProgram(program)
      clear()
    },
  }
}
