import type { MediaClip, TextOverlay, TimelineItem } from '../types'
import { renderCanvasFrame } from './canvasFrameRenderer'
import { disposeCanvasMedia, loadCanvasMedia, type LoadedCanvasMedia } from './mediaElementLoader'
import type { CanvasPreviewRenderer } from './canvasPreviewRenderer'

interface PreviewRenderRequest {
  timeMs: number
  timelineItems: TimelineItem[]
  clips: MediaClip[]
  textOverlays: TextOverlay[]
}

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
    varying vec2 v_texCoord;

    void main() {
      gl_FragColor = texture2D(u_frame, v_texCoord);
    }
  `)

  if (!vertexShader || !fragmentShader) return null

  const program = gl.createProgram()
  if (!program) return null

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

function createBuffer(gl: WebGLRenderingContext, data: Float32Array): WebGLBuffer | null {
  const buffer = gl.createBuffer()
  if (!buffer) return null
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  return buffer
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

  const positionBuffer = createBuffer(gl, new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
  ]))
  const texCoordBuffer = createBuffer(gl, new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ]))
  const texture = gl.createTexture()
  if (!positionBuffer || !texCoordBuffer || !texture) return null

  const positionLoc = gl.getAttribLocation(program, 'a_position')
  const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord')
  const frameLoc = gl.getUniformLocation(program, 'u_frame')

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

  function drawTexture() {
    gl.viewport(0, 0, width, height)
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, backingCanvas)

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.enableVertexAttribArray(positionLoc)
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer)
    gl.enableVertexAttribArray(texCoordLoc)
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0)

    gl.uniform1i(frameLoc, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  function clear() {
    backingCtx.setTransform(1, 0, 0, 1, 0, 0)
    backingCtx.fillStyle = '#000'
    backingCtx.fillRect(0, 0, width, height)
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  function disposeCurrentMedia() {
    if (!media) return
    disposeCanvasMedia(media)
    media = null
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
          await renderCanvasFrame(
            backingCtx,
            width,
            height,
            request.timeMs,
            request.timelineItems,
            request.clips,
            request.textOverlays,
            media,
            { seekTimeoutMs: 90 }
          )
          drawTexture()
        } catch (err) {
          console.error('GPU preview render failed', err)
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
      if (renderRequest) void flushRenderQueue()
    },
    render(timeMs: number, timelineItems: TimelineItem[], clips: MediaClip[], textOverlays: TextOverlay[]) {
      renderRequest = { timeMs, timelineItems, clips, textOverlays }
      if (!media) {
        clear()
        return
      }
      void flushRenderQueue()
    },
    clear,
    dispose() {
      disposed = true
      mediaGeneration++
      renderRequest = null
      disposeCurrentMedia()
      gl.deleteTexture(texture)
      gl.deleteBuffer(positionBuffer)
      gl.deleteBuffer(texCoordBuffer)
      gl.deleteProgram(program)
      clear()
    },
  }
}
