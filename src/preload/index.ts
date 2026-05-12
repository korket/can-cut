import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openFiles:    () => ipcRenderer.invoke('dialog:openFiles'),
  getVideoInfo: (path: string) => ipcRenderer.invoke('ffprobe:getInfo', path),
  getThumbnail: (path: string, timeMs: number) => ipcRenderer.invoke('ffmpeg:thumbnail', path, timeMs),
  exportVideo:       (options: unknown) => ipcRenderer.invoke('ffmpeg:export', options),
  startFrameExport:  (opts: unknown) => ipcRenderer.invoke('export:frameStart', opts),
  sendExportFrame:   (buf: ArrayBuffer) => ipcRenderer.invoke('export:frameSend', buf),
  finishFrameExport: () => ipcRenderer.invoke('export:frameFinish'),
  openPath:     (path: string) => ipcRenderer.invoke('shell:openPath', path),
  onExportProgress: (cb: (pct: number) => void) => {
    const handler = (_: unknown, pct: number) => cb(pct)
    ipcRenderer.on('export:progress', handler)
    return () => ipcRenderer.removeListener('export:progress', handler)
  },
  listProjects:  ()                          => ipcRenderer.invoke('project:list'),
  createProject: (name: string)              => ipcRenderer.invoke('project:create', name),
  saveProject:   (id: string, data: string)  => ipcRenderer.invoke('project:save', id, data),
  loadProject:   (id: string)                => ipcRenderer.invoke('project:load', id),
  deleteProject: (id: string)                => ipcRenderer.invoke('project:delete', id),
  renameProject: (id: string, name: string)  => ipcRenderer.invoke('project:rename', id, name),
})
