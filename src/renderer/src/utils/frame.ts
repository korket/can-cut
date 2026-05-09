export function snapToFrame(ms: number, fps: number): number {
  if (fps <= 0) return ms
  const dur = 1000 / fps
  return Math.round(ms / dur) * dur
}

export function msToFrames(ms: number, fps: number): number {
  return Math.floor(ms * fps / 1000)
}

export function framesToMs(frames: number, fps: number): number {
  return (frames / fps) * 1000
}

export function frameDurationMs(fps: number): number {
  return 1000 / fps
}

export function formatTimecode(ms: number, fps: number): string {
  const roundedFps = Math.round(fps)
  const totalFrames = Math.floor(ms * fps / 1000)
  const f = totalFrames % roundedFps
  const totalSecs = Math.floor(totalFrames / roundedFps)
  const s = totalSecs % 60
  const m = Math.floor(totalSecs / 60) % 60
  const h = Math.floor(totalSecs / 3600)
  const fw = roundedFps >= 100 ? 3 : 2
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f, fw)}`
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}
