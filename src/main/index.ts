import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { existsSync, promises as fs } from 'fs'
import { randomUUID } from 'crypto'
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
ipcMain.handle('ffmpeg:export', async (_event, options: ExportOptions) => {
  const { canceled, filePath: outPath } = await dialog.showSaveDialog({
    defaultPath: 'export.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
  })
  if (canceled || !outPath) return { canceled: true }

  return new Promise((resolve, reject) => {
    const { clips, textOverlays, resolution, fps } = options
    const [width, height] = resolution.split('x').map(Number)

    let filterComplex = ''
    const scaledStreams: string[] = []

    const cmd = ffmpeg()

    for (let i = 0; i < clips.length; i++) {
      const c = clips[i]
      if (c.type === 'image') {
        const durSec = ((c.trimEnd - c.trimStart) / 1000).toFixed(3)
        cmd.input(c.path).inputOptions(['-loop', '1', '-framerate', String(fps), '-t', durSec])
        filterComplex += `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setpts=PTS-STARTPTS[v${i}];`
      } else {
        cmd.input(c.path)
        const start = (c.trimStart / 1000).toFixed(3)
        const duration = ((c.trimEnd - c.trimStart) / 1000).toFixed(3)
        filterComplex += `[${i}:v]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2[v${i}];`
      }
      scaledStreams.push(`[v${i}]`)
    }

    // Concat
    filterComplex += `${scaledStreams.join('')}concat=n=${clips.length}:v=1:a=0[vout]`

    // Text overlays
    let finalStream = '[vout]'
    for (let t = 0; t < textOverlays.length; t++) {
      const ov = textOverlays[t]
      const startSec = (ov.startTime / 1000).toFixed(2)
      const endSec = (ov.endTime / 1000).toFixed(2)
      const escaped = ov.text.replace(/'/g, "\\'").replace(/:/g, '\\:')
      const nextStream = t === textOverlays.length - 1 ? '[finalout]' : `[vtxt${t}]`
      filterComplex += `;${finalStream}drawtext=text='${escaped}':fontcolor=${ov.color}:fontsize=${ov.fontSize}:x=${ov.x}:y=${ov.y}:enable='between(t,${startSec},${endSec})'${nextStream}`
      finalStream = `[vtxt${t}]`
    }
    const mapStream = textOverlays.length > 0 ? '[finalout]' : '[vout]'

    cmd
      .complexFilter(filterComplex)
      .map(mapStream)
      .videoCodec('libx264')
      .outputOptions(['-crf 23', `-r ${fps}`, '-preset medium', '-pix_fmt yuv420p'])
      .output(outPath)
      .on('progress', (progress) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('export:progress', progress.percent ?? 0)
      })
      .on('end', () => resolve({ success: true, path: outPath }))
      .on('error', (err) => reject(err.message))
      .run()
  })
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

interface ClipExportInfo {
  path: string
  trimStart: number
  trimEnd: number
  type: 'video' | 'audio' | 'image'
}

interface TextOverlayExportInfo {
  text: string
  color: string
  fontSize: number
  x: number
  y: number
  startTime: number
  endTime: number
}

interface ExportOptions {
  clips: ClipExportInfo[]
  textOverlays: TextOverlayExportInfo[]
  resolution: string
  fps: number
}
