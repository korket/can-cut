interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  thumbnail?: string | null
}

interface Window {
  api: {
    openFiles: () => Promise<string[]>
    getVideoInfo: (path: string) => Promise<any>
    getThumbnail: (path: string, timeMs: number) => Promise<string>
    exportVideo: (options: any) => Promise<any>
    startFrameExport: (opts: any) => Promise<any>
    sendExportFrame: (buf: ArrayBuffer) => Promise<any>
    finishFrameExport: () => Promise<any>
    openPath: (path: string) => Promise<void>
    onExportProgress: (cb: (pct: number) => void) => () => void
    listProjects: () => Promise<ProjectMeta[]>
    createProject: (name: string) => Promise<{ id: string; name: string; createdAt: string; updatedAt: string }>
    saveProject: (id: string, data: string) => Promise<void>
    loadProject: (id: string) => Promise<string | null>
    deleteProject: (id: string) => Promise<void>
    renameProject: (id: string, name: string) => Promise<void>
  }
}
