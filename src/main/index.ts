import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { extname, join } from 'path'
import { createExportEngine } from './exportEngine'
import { registerExportIpc } from './export/ipc'
import {
  createExportJobService,
  type ExportJobService,
} from './export/jobService'
import { createProjectStore, registerProjectIpc } from './projects'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

let mainWindow: BrowserWindow | null = null
let exportWorkerWindow: BrowserWindow | null = null
let exportWorkerReady: Promise<boolean> | null = null
let appIsQuitting = false

app.on('before-quit', () => {
  appIsQuitting = true
})

function loadRendererWindow(win: BrowserWindow, query?: Record<string, string>): Promise<void> {
  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    return win.loadURL(url.toString())
  }

  return win.loadFile(join(__dirname, '../renderer/index.html'), query ? { query } : undefined)
}

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
      height: 36,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  mainWindow = win
  win.maximize()
  win.on('closed', () => {
    mainWindow = null
    if (process.platform !== 'darwin') {
      appIsQuitting = true
      exportWorkerWindow?.destroy()
      app.quit()
    }
  })

  void loadRendererWindow(win)
}

async function createExportWorkerWindow(): Promise<void> {
  if (exportWorkerWindow && !exportWorkerWindow.isDestroyed()) return

  const win = new BrowserWindow({
    width: 640,
    height: 360,
    show: false,
    backgroundColor: '#000000',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  exportWorkerWindow = win
  let workerGoneHandled = false
  const handleWorkerGone = (reason: string) => {
    if (workerGoneHandled) return
    workerGoneHandled = true
    if (exportWorkerWindow === win) exportWorkerWindow = null
    exportWorkerReady = null

    if (appIsQuitting) return

    exportJobs?.handleExportRendererGone(reason)
    void ensureExportWorkerWindow()
  }

  win.on('closed', () => {
    handleWorkerGone('closed')
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    handleWorkerGone(details.reason)
    if (!win.isDestroyed()) win.destroy()
  })

  try {
    await loadRendererWindow(win, { exportWorker: '1' })
  } catch (err: unknown) {
    handleWorkerGone(`failed to load: ${String(err)}`)
    if (!win.isDestroyed()) win.destroy()
    throw err
  }
}

function ensureExportWorkerWindow(): Promise<boolean> {
  if (exportWorkerWindow && !exportWorkerWindow.isDestroyed()) return Promise.resolve(true)
  if (exportWorkerReady) return exportWorkerReady

  exportWorkerReady = createExportWorkerWindow()
    .then(() => true)
    .catch((err: unknown) => {
      exportJobs?.handleExportRendererGone(`failed to start: ${String(err)}`)
      return false
    })
    .finally(() => {
      exportWorkerReady = null
    })

  return exportWorkerReady
}

function sendToRenderers(channel: string, payload: unknown): number {
  const windows = BrowserWindow.getAllWindows()
  let sent = 0
  for (const win of windows) {
    if (win === exportWorkerWindow) continue
    win.webContents.send(channel, payload)
    sent++
  }
  return sent
}

function sendToExportRenderer(channel: string, payload: unknown): boolean {
  if (!exportWorkerWindow || exportWorkerWindow.isDestroyed()) return false
  exportWorkerWindow.webContents.send(channel, payload)
  return true
}

let exportJobs: ExportJobService | null = null

function chooseExportOutputPath(): Promise<string | null> {
  const options = {
    defaultPath: 'export.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  }

  const dialogPromise = mainWindow && !mainWindow.isDestroyed()
    ? dialog.showSaveDialog(mainWindow, options)
    : dialog.showSaveDialog(options)

  return dialogPromise.then(({ canceled, filePath }) => {
    if (canceled || !filePath) return null
    return extname(filePath) ? filePath : `${filePath}.mp4`
  })
}

const exportEngine = createExportEngine({
  chooseOutputPath: chooseExportOutputPath,
  emitProgress: (jobId, progress) => {
    exportJobs?.handleEngineProgress(jobId, progress)
  },
  emitLog: (jobId, message) => {
    exportJobs?.handleEngineLog(jobId, message)
  },
  getTempPath: () => app.getPath('temp'),
})

const projectStore = createProjectStore(() => join(app.getPath('userData'), 'projects'))

app.whenReady().then(async () => {
  exportJobs = createExportJobService({
    engine: exportEngine,
    storagePath: join(app.getPath('userData'), 'export-jobs.json'),
    chooseOutputPath: chooseExportOutputPath,
    sendToRenderers,
    ensureExportRenderer: ensureExportWorkerWindow,
    sendToExportRenderer,
  })
  await exportJobs?.restore()
  await ensureExportWorkerWindow()
  createWindow()
  app.on('activate', () => {
    if (!mainWindow) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('dialog:openFiles', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv', 'mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'avif'] },
      { name: 'Video Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv'] },
      { name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'avif'] },
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return canceled ? [] : filePaths
})

registerExportIpc(ipcMain, {
  engine: exportEngine,
  getExportJobs: () => exportJobs,
  getExportWorkerWebContents: () => exportWorkerWindow && !exportWorkerWindow.isDestroyed()
    ? exportWorkerWindow.webContents
    : null,
})
ipcMain.handle('shell:openPath', (_event, path: string) => shell.openPath(path))
registerProjectIpc(ipcMain, projectStore)
