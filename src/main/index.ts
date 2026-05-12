import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { existsSync, promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import { spawn, ChildProcess } from 'child_process'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import ffprobePath from 'ffprobe-static'

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobePath.path)

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a1a',
      symbolColor: '#ffffff',
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  win.maximize()

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// IPC: open file dialog
ipcMain.handle('dialog:openFiles', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv', 'mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'avif'] },
      { name: 'Video Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv'] },
      { name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'avif'] },
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  return canceled ? [] : filePaths
})

// IPC: get video metadata via ffprobe
ipcMain.handle('ffprobe:getInfo', (_event, filePath: string) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err.message)
      else resolve(data)
    })
  })
})

// IPC: generate thumbnail at a specific time
ipcMain.handle('ffmpeg:thumbnail', (_event, filePath: string, timeMs: number) => {
  return new Promise((resolve, reject) => {
    const tmpDir = app.getPath('temp')
    const outFile = join(tmpDir, `thumb_${Date.now()}.png`)
    const timeSec = timeMs / 1000

    ffmpeg(filePath)
      .seekInput(timeSec)
      .frames(1)
      .output(outFile)
      .on('end', () => resolve(outFile))
      .on('error', (err) => reject(err.message))
      .run()
  })
})

// IPC: export video
// Build per-clip video filter chain; returns filter string + overlay placement
function buildClipFilter(
  inputRef: string, outputLabel: string,
  tr: ExportTransform, ef: ExportEffects,
  SW: number, SH: number, W: number, H: number
): { filter: string; overlayX: number; overlayY: number; hasOpacity: boolean } {

  const cSW = SW > 0 ? SW : W
  const cSH = SH > 0 ? SH : H
  const fitRatio = Math.min(W / cSW, H / cSH)
  const NW = Math.max(2, Math.floor(cSW * fitRatio / 2) * 2)
  const NH = Math.max(2, Math.floor(cSH * fitRatio / 2) * 2)

  // Crop region within the full W×H canvas (matching CSS inset clip-path)
  const cropX = Math.round(tr.cropL / 100 * W)
  const cropY = Math.round(tr.cropT / 100 * H)
  const CW    = Math.max(2, Math.floor(W * (1 - tr.cropL / 100 - tr.cropR / 100) / 2) * 2)
  const CH    = Math.max(2, Math.floor(H * (1 - tr.cropT / 100 - tr.cropB / 100) / 2) * 2)
  const hasCrop = tr.cropL > 0 || tr.cropR > 0 || tr.cropT > 0 || tr.cropB > 0

  const asx = Math.abs(tr.scaleX)
  const asy = Math.abs(tr.scaleY)
  const TW  = Math.max(2, Math.floor(CW * asx / 2) * 2)
  const TH  = Math.max(2, Math.floor(CH * asy / 2) * 2)
  const hasScale = tr.scaleX !== 1 || tr.scaleY !== 1

  const f: string[] = []

  // 1. Scale video to natural fit, letterbox to W×H
  f.push(`scale=${NW}:${NH}`)
  f.push(`pad=${W}:${H}:trunc((ow-iw)/2):trunc((oh-ih)/2)`)

  // 2. Crop (replicates CSS inset clip-path on the full canvas element)
  if (hasCrop) f.push(`crop=${CW}:${CH}:${cropX}:${cropY}`)

  // 3. Scale by transform (scaleX/scaleY)
  if (hasScale || hasCrop) f.push(`scale=${TW}:${TH}`)

  // 4. Flip
  if (tr.flipH) f.push('hflip')
  if (tr.flipV) f.push('vflip')

  // 5. Rotation (around frame centre — accurate when anchorX/Y = 0.5)
  if (tr.rotation !== 0) {
    const rad = (tr.rotation * Math.PI / 180).toFixed(6)
    f.push(`rotate=${rad}:fillcolor=black@0:ow=${TW}:oh=${TH}`)
  }

  // 6. Color effects
  const finalSat = (ef.saturate / 100) * (1 - ef.grayscale / 100)
  if (ef.brightness !== 100 || ef.contrast !== 100 || ef.saturate !== 100 || ef.grayscale !== 0) {
    const b  = (ef.brightness / 100 - 1).toFixed(4)   // −1…1
    const ct = (ef.contrast   / 100).toFixed(4)         // 0…2
    const s  = finalSat.toFixed(4)
    f.push(`eq=brightness=${b}:contrast=${ct}:saturation=${s}`)
  }
  if (ef.hue !== 0) f.push(`hue=h=${ef.hue}`)
  if (ef.sepia > 0) {
    const s = ef.sepia / 100
    f.push([
      `colorchannelmixer`,
      `=${(0.393*s+(1-s)).toFixed(4)}:${(0.769*s).toFixed(4)}:${(0.189*s).toFixed(4)}:0`,
      `:${(0.349*s).toFixed(4)}:${(0.686*s+(1-s)).toFixed(4)}:${(0.168*s).toFixed(4)}:0`,
      `:${(0.272*s).toFixed(4)}:${(0.534*s).toFixed(4)}:${(0.131*s+(1-s)).toFixed(4)}:0`,
    ].join(''))
  }
  if (ef.blur > 0) f.push(`gblur=sigma=${ef.blur}`)

  // 7. Opacity (requires rgba format for overlay alpha blending)
  const hasOpacity = ef.opacity < 100
  if (hasOpacity) f.push(`format=rgba,colorchannelmixer=aa=${(ef.opacity / 100).toFixed(4)}`)

  // Overlay position: mirrors CSS transform-origin + translate + scale
  const overlayX = Math.round(tr.anchorX * W * (1 - asx) + tr.cropL / 100 * W * asx + tr.posX / 100 * W)
  const overlayY = Math.round(tr.anchorY * H * (1 - asy) + tr.cropT / 100 * H * asy + tr.posY / 100 * H)

  return { filter: `${inputRef}${f.join(',')}[${outputLabel}]`, overlayX, overlayY, hasOpacity }
}

ipcMain.handle('ffmpeg:export', async (_event, options: ExportOptions) => {
  const { canceled, filePath: outPath } = await dialog.showSaveDialog({
    defaultPath: 'export.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
  })
  if (canceled || !outPath) return { canceled: true }

  const { clips, textOverlays, resolution, fps, duration: totalMs } = options
  const [W, H] = resolution.split('x').map(Number)
  const totalSec = (totalMs / 1000).toFixed(3)

  // Probe video clips for audio
  type ClipInfo = ClipExportInfo & { origIdx: number; hasAudio: boolean }
  const clipsInfo: ClipInfo[] = await Promise.all(
    clips.map(async (c, origIdx) => {
      if (c.type !== 'video') return { ...c, origIdx, hasAudio: false }
      const hasAudio = await new Promise<boolean>((res) => {
        ffmpeg.ffprobe(c.path, (err, data) => {
          if (err) { res(false); return }
          res((data.streams ?? []).some((s) => s.codec_type === 'audio'))
        })
      })
      return { ...c, origIdx, hasAudio }
    })
  )

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()

    const videoClips = clipsInfo
      .filter((c) => c.type !== 'audio')
      .sort((a, b) => a.trackIndex - b.trackIndex || a.startTime - b.startTime)

    const inputOf = new Map<number, number>()
    let nextInput = 0

    for (const c of videoClips) {
      if (c.type === 'solid') continue
      if (c.type === 'image') {
        cmd.input(c.path).inputOptions(['-loop', '1', '-framerate', String(fps)])
      } else {
        cmd.input(c.path)
      }
      inputOf.set(c.origIdx, nextInput++)
    }

    const audioOnlyClips = clipsInfo.filter((c) => c.type === 'audio')
    for (const c of audioOnlyClips) {
      cmd.input(c.path)
      inputOf.set(c.origIdx, nextInput++)
    }

    // ── Video filter graph ────────────────────────────────────────────────
    const parts: string[] = []

    parts.push(`color=black:s=${W}x${H}:r=${fps}:d=${totalSec}[base]`)
    let baseLabel = 'base'

    for (let vi = 0; vi < videoClips.length; vi++) {
      const c   = videoClips[vi]
      const ss  = (c.startTime / 1000).toFixed(6)
      const es  = ((c.startTime + c.trimEnd - c.trimStart) / 1000).toFixed(6)
      const ts  = (c.trimStart / 1000).toFixed(6)
      const dur = ((c.trimEnd - c.trimStart) / 1000).toFixed(6)
      const vLbl   = `vc${vi}`
      const isLast = vi === videoClips.length - 1
      const outLbl = isLast && textOverlays.length === 0 ? 'vout' : `vb${vi}`

      let overlayX = 0, overlayY = 0, hasOpacity = false

      if (c.type === 'solid') {
        parts.push(`color=c=${c.color ?? '#000000'}:s=${W}x${H}:r=${fps}:d=${dur},setpts=PTS-STARTPTS+${ss}/TB[${vLbl}]`)
      } else {
        const i = inputOf.get(c.origIdx)!
        const src = c.type === 'image'
          ? `[${i}:v]trim=duration=${dur},setpts=PTS-STARTPTS+${ss}/TB,`
          : `[${i}:v]trim=start=${ts}:duration=${dur},setpts=PTS-STARTPTS+${ss}/TB,`

        const { filter, overlayX: ox, overlayY: oy, hasOpacity: hop } = buildClipFilter(
          src, vLbl, c.transform, c.effects, c.clipWidth, c.clipHeight, W, H
        )
        parts.push(filter)
        overlayX = ox; overlayY = oy; hasOpacity = hop
      }

      const ovFmt  = hasOpacity ? ':format=auto' : ''
      parts.push(`[${baseLabel}][${vLbl}]overlay=x=${overlayX}:y=${overlayY}:enable='between(t,${ss},${es})':eof_action=pass${ovFmt}[${outLbl}]`)
      baseLabel = outLbl
    }

    if (videoClips.length === 0) {
      parts.push(`[base]copy[vout]`)
      baseLabel = 'vout'
    }

    for (let t = 0; t < textOverlays.length; t++) {
      const ov     = textOverlays[t]
      const ss     = (ov.startTime / 1000).toFixed(3)
      const es     = (ov.endTime   / 1000).toFixed(3)
      const txt    = ov.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')
      const isLast = t === textOverlays.length - 1
      const outLbl = isLast ? 'vout' : `vtxt${t}`
      parts.push(`[${baseLabel}]drawtext=text='${txt}':fontcolor=${ov.color}:fontsize=${ov.fontSize}:x=${ov.x}:y=${ov.y}:enable='between(t,${ss},${es})'[${outLbl}]`)
      baseLabel = outLbl
    }

    // ── Audio filter graph ────────────────────────────────────────────────
    const audioLabels: string[] = []
    const audioSources = [
      ...clipsInfo.filter((c) => c.type === 'video' && c.hasAudio),
      ...audioOnlyClips,
    ]

    for (let ai = 0; ai < audioSources.length; ai++) {
      const c       = audioSources[ai]
      const i       = inputOf.get(c.origIdx)!
      const ts      = (c.trimStart / 1000).toFixed(6)
      const dur     = ((c.trimEnd - c.trimStart) / 1000).toFixed(6)
      const startMs = Math.round(c.startTime)
      const vol     = ((c.volume ?? 100) / 100).toFixed(3)
      const lbl     = `ao${ai}`
      parts.push(`[${i}:a]atrim=start=${ts}:duration=${dur},asetpts=PTS-STARTPTS,volume=${vol},adelay=delays=${startMs}ms:all=1,apad=whole_dur=${totalSec}[${lbl}]`)
      audioLabels.push(`[${lbl}]`)
    }

    if (audioLabels.length > 0) {
      parts.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest[aout]`)
    }

    cmd
      .complexFilter(parts.join(';'))
      .map('[vout]')
      .videoCodec('libx264')
      .outputOptions(['-crf 23', `-r ${fps}`, '-preset medium', '-pix_fmt yuv420p'])

    if (audioLabels.length > 0) {
      cmd.map('[aout]').audioCodec('aac').audioBitrate('192k')
    }

    cmd
      .output(outPath)
      .on('progress', (progress) => {
        // percent is unreliable with filter_complex; derive from timemark instead
        let pct = 0
        if (progress.timemark) {
          const [hh, mm, ss] = progress.timemark.split(':').map(parseFloat)
          const elapsed = hh * 3600 + mm * 60 + ss
          pct = Math.min(99, Math.round((elapsed / parseFloat(totalSec)) * 100))
        } else if (progress.percent != null && progress.percent > 0) {
          pct = Math.min(99, Math.round(progress.percent))
        }
        BrowserWindow.getAllWindows()[0]?.webContents.send('export:progress', pct)
      })
      .on('end', () => resolve({ success: true, path: outPath }))
      .on('error', (err) => reject(err.message))
      .run()
  })
})

// ── Canvas-based frame export ────────────────────────────────────────────────
interface FrameClip { id: string; path: string; type: string }
interface FrameItem { id: string; clipId: string; trackIndex: number; startTime: number; trimStart: number; trimEnd: number; volume: number }
interface FrameExportSession { proc: ChildProcess; outPath: string; stderrBuf: string[] }
let exportSession: FrameExportSession | null = null

ipcMain.handle('export:frameStart', async (_event, opts: { W: number; H: number; fps: number; totalMs: number; clips: FrameClip[]; timelineItems: FrameItem[] }) => {
  const { canceled, filePath: outPath } = await dialog.showSaveDialog({
    defaultPath: 'export.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
  })
  if (canceled || !outPath) return { canceled: true }

  const { fps, totalMs, clips, timelineItems } = opts
  const totalSec = (totalMs / 1000).toFixed(3)
  const bin = ffmpegPath as string

  // Probe audio for each timeline item
  const audioSources: Array<{ path: string; startTime: number; trimStart: number; trimEnd: number; volume: number }> = []
  for (const item of timelineItems) {
    const clip = clips.find(c => c.id === item.clipId)
    if (!clip || !clip.path) continue
    if (clip.type === 'audio') {
      audioSources.push({ path: clip.path, startTime: item.startTime, trimStart: item.trimStart, trimEnd: item.trimEnd, volume: item.volume })
    } else if (clip.type === 'video') {
      const hasAudio = await new Promise<boolean>(res => {
        ffmpeg.ffprobe(clip.path, (err, data) => {
          if (err) { res(false); return }
          res((data.streams ?? []).some(s => s.codec_type === 'audio'))
        })
      })
      if (hasAudio) audioSources.push({ path: clip.path, startTime: item.startTime, trimStart: item.trimStart, trimEnd: item.trimEnd, volume: item.volume })
    }
  }

  // Build a single ffmpeg command: image2pipe for video + audio inputs → output
  const args: string[] = ['-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0']
  for (const src of audioSources) args.push('-i', src.path)

  if (audioSources.length > 0) {
    const parts: string[] = []
    const audioLabels: string[] = []
    for (let ai = 0; ai < audioSources.length; ai++) {
      const src = audioSources[ai]
      const ts = (src.trimStart / 1000).toFixed(6)
      const dur = ((src.trimEnd - src.trimStart) / 1000).toFixed(6)
      const startMs = Math.round(src.startTime)
      const vol = (src.volume / 100).toFixed(3)
      const lbl = `ao${ai}`
      parts.push(`[${ai + 1}:a]atrim=start=${ts}:duration=${dur},asetpts=PTS-STARTPTS,volume=${vol},adelay=delays=${startMs}ms:all=1,apad=whole_dur=${totalSec}[${lbl}]`)
      audioLabels.push(`[${lbl}]`)
    }
    parts.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest[aout]`)
    args.push('-filter_complex', parts.join(';'))
    args.push('-map', '0:v', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium')
    args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k')
  } else {
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium')
  }
  args.push(outPath)

  const stderrBuf: string[] = []
  const proc = spawn(bin, args)
  proc.stderr?.on('data', (d: Buffer) => stderrBuf.push(d.toString()))

  exportSession = { proc, outPath, stderrBuf }
  return { ok: true }
})

ipcMain.handle('export:frameSend', async (_event, buf: ArrayBuffer) => {
  if (!exportSession) return { error: 'no session' }
  const data = Buffer.from(buf)
  const ok = exportSession.proc.stdin!.write(data)
  if (!ok) await new Promise<void>(res => exportSession!.proc.stdin!.once('drain', res))
  return { ok: true }
})

ipcMain.handle('export:frameFinish', async () => {
  if (!exportSession) return { error: 'no session' }
  const { proc, outPath, stderrBuf } = exportSession
  exportSession = null

  proc.stdin!.end()
  const exitCode = await new Promise<number | null>(res => proc.on('close', res))
  if (exitCode !== 0 && exitCode !== null) {
    const detail = stderrBuf.join('').slice(-2000)
    return { error: `ffmpeg exited with code ${exitCode}: ${detail}` }
  }
  return { success: true, path: outPath }
})

ipcMain.handle('shell:openPath', (_event, p: string) => shell.openPath(p))

// ── Project management ────────────────────────────────────────────────────
function projectsDir() { return join(app.getPath('userData'), 'projects') }
async function ensureProjectsDir() { await fs.mkdir(projectsDir(), { recursive: true }).catch(() => {}) }

ipcMain.handle('project:list', async () => {
  await ensureProjectsDir()
  const files = await fs.readdir(projectsDir()).catch(() => [] as string[])
  const list: any[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(join(projectsDir(), f), 'utf8')
      const d = JSON.parse(raw)
      list.push({ id: d.id, name: d.name, createdAt: d.createdAt, updatedAt: d.updatedAt, thumbnail: d.thumbnail ?? null })
    } catch {}
  }
  return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
})

ipcMain.handle('project:create', async (_event, name: string) => {
  await ensureProjectsDir()
  const id = randomUUID()
  const now = new Date().toISOString()
  const project = { id, name, createdAt: now, updatedAt: now, thumbnail: null,
    clips: [], folders: [], timelineItems: [], textOverlays: [],
    zoom: 100, videoTrackCount: 2, audioTrackCount: 2 }
  await fs.writeFile(join(projectsDir(), `${id}.json`), JSON.stringify(project), 'utf8')
  return { id, name, createdAt: now, updatedAt: now }
})

ipcMain.handle('project:save', async (_event, id: string, data: string) => {
  await ensureProjectsDir()
  await fs.writeFile(join(projectsDir(), `${id}.json`), data, 'utf8')
})

ipcMain.handle('project:load', async (_event, id: string) => {
  try { return await fs.readFile(join(projectsDir(), `${id}.json`), 'utf8') }
  catch { return null }
})

ipcMain.handle('project:delete', async (_event, id: string) => {
  await fs.unlink(join(projectsDir(), `${id}.json`)).catch(() => {})
})

ipcMain.handle('project:rename', async (_event, id: string, name: string) => {
  const p = join(projectsDir(), `${id}.json`)
  try {
    const d = JSON.parse(await fs.readFile(p, 'utf8'))
    d.name = name; d.updatedAt = new Date().toISOString()
    await fs.writeFile(p, JSON.stringify(d), 'utf8')
  } catch {}
})

interface ExportTransform {
  scaleX: number; scaleY: number
  posX: number; posY: number
  rotation: number
  anchorX: number; anchorY: number
  flipH: boolean; flipV: boolean
  cropL: number; cropR: number; cropT: number; cropB: number
}

interface ExportEffects {
  brightness: number; contrast: number; saturate: number
  hue: number; blur: number; opacity: number
  grayscale: number; sepia: number
}

interface ClipExportInfo {
  path: string
  trimStart: number
  trimEnd: number
  startTime: number
  trackIndex: number
  volume: number
  type: 'video' | 'audio' | 'image' | 'solid'
  color?: string
  clipWidth: number
  clipHeight: number
  transform: ExportTransform
  effects: ExportEffects
}

interface TextOverlayExportInfo {
  text: string; color: string; fontSize: number
  x: number; y: number; startTime: number; endTime: number
}

interface ExportOptions {
  clips: ClipExportInfo[]
  textOverlays: TextOverlayExportInfo[]
  resolution: string
  fps: number
  duration: number
}
