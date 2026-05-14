import { contextBridge, ipcRenderer } from 'electron'

const isExportWorker = new URLSearchParams(globalThis.location.search).get('exportWorker') === '1'

const appApi = {
  openFiles:    () => ipcRenderer.invoke('dialog:openFiles'),
  getVideoInfo: (path: string) => ipcRenderer.invoke('ffprobe:getInfo', path),
  getThumbnail: (path: string, timeMs: number) => ipcRenderer.invoke('ffmpeg:thumbnail', path, timeMs),
  validateMediaPaths: (paths: string[]) => ipcRenderer.invoke('media:validatePaths', paths),
  getWaveform: (path: string) => ipcRenderer.invoke('media:waveform', path),
  startExportJob:    (request: unknown) => ipcRenderer.invoke('export:jobStart', request),
  getExportJobs:     () => ipcRenderer.invoke('export:jobList'),
  cancelExportJob:   (jobId: string) => ipcRenderer.invoke('export:jobCancel', jobId),
  removeExportJob:   (jobId: string) => ipcRenderer.invoke('export:jobRemove', jobId),
  openPath:     (path: string) => ipcRenderer.invoke('shell:openPath', path),
  listSystemFonts: () => ipcRenderer.invoke('system:listFonts'),
  onExportJobsChanged: (cb: (jobs: unknown[]) => void) => {
    const handler = (_: unknown, jobs: unknown[]) => cb(jobs)
    ipcRenderer.on('export:jobsChanged', handler)
    return () => ipcRenderer.removeListener('export:jobsChanged', handler)
  },
  listProjects:  ()                          => ipcRenderer.invoke('project:list'),
  createProject: (name: string)              => ipcRenderer.invoke('project:create', name),
  saveProject:   (id: string, data: string)  => ipcRenderer.invoke('project:save', id, data),
  loadProject:   (id: string)                => ipcRenderer.invoke('project:load', id),
  deleteProject: (id: string)                => ipcRenderer.invoke('project:delete', id),
  renameProject: (id: string, name: string)  => ipcRenderer.invoke('project:rename', id, name),
  listProjectVersions:   (id: string) => ipcRenderer.invoke('project:versions:list', id),
  createProjectVersion:  (id: string, data: string, options?: unknown) => ipcRenderer.invoke('project:versions:create', id, data, options),
  loadProjectVersion:    (id: string, versionId: string) => ipcRenderer.invoke('project:versions:load', id, versionId),
  deleteProjectVersion:  (id: string, versionId: string) => ipcRenderer.invoke('project:versions:delete', id, versionId),
  duplicateProjectVersion: (id: string, versionId: string, name?: string) => ipcRenderer.invoke('project:versions:duplicate', id, versionId, name),
  saveProjectRecovery:   (id: string, data: string) => ipcRenderer.invoke('project:recovery:save', id, data),
  loadProjectRecovery:   (id: string) => ipcRenderer.invoke('project:recovery:load', id),
}

const exportWorkerApi = {
  startFrameExport:  (jobId: string, opts: unknown) => ipcRenderer.invoke('export:frameStart', jobId, opts),
  sendExportFrame:   (jobId: string, buf: ArrayBuffer) => ipcRenderer.invoke('export:frameSend', jobId, buf),
  finishFrameExport: (jobId: string) => ipcRenderer.invoke('export:frameFinish', jobId),
  cancelExport:      (jobId: string) => ipcRenderer.invoke('export:cancel', jobId),
  reportRendererExportProgress: (jobId: string, pct: number) => ipcRenderer.invoke('export:rendererProgress', jobId, pct),
  completeRendererExport:       (jobId: string, result: unknown) => ipcRenderer.invoke('export:rendererComplete', jobId, result),
  onRendererExportJob: (cb: (payload: unknown) => void) => {
    const handler = (_: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on('export:rendererRun', handler)
    return () => ipcRenderer.removeListener('export:rendererRun', handler)
  },
  onRendererExportCancel: (cb: (payload: { jobId: string }) => void) => {
    const handler = (_: unknown, payload: { jobId: string }) => cb(payload)
    ipcRenderer.on('export:rendererCancel', handler)
    return () => ipcRenderer.removeListener('export:rendererCancel', handler)
  },
}

contextBridge.exposeInMainWorld('api', isExportWorker
  ? { ...appApi, ...exportWorkerApi }
  : appApi)
