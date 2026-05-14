interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  thumbnail?: string | null
}

interface ExportEncoderSettings {
  videoCodec: 'libx264'
  x264Preset: 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow'
  crf: number
  pixelFormat: 'yuv420p'
  audioCodec: 'aac'
  audioBitrate: string
  framePipeFormat: 'raw-rgba' | 'mjpeg'
  frameJpegQuality: number
}

interface MediaPathValidationResult {
  path: string
  exists: boolean
  isFile: boolean
  error?: string
}

interface FrameExportOptions {
  W: number
  H: number
  fps: number
  totalMs: number
  encoder: ExportEncoderSettings
  outputPath?: string
  clips: Array<{
    id: string
    path: string
    type: 'video' | 'audio' | 'image' | 'solid'
    width: number
    height: number
  }>
  timelineItems: Array<{
    id: string
    clipId: string
    trackIndex: number
    startTime: number
    trimStart: number
    trimEnd: number
    volume: number
  }>
}

type FrameExportStartResult =
  | { ok: true }
  | { canceled: true }
  | { error: string }

type FrameExportSendResult =
  | { ok: true }
  | { error: string }

interface FrameExportFinishResult {
  success?: boolean
  path?: string
  error?: string
  canceled?: boolean
}

type ExportCancelResult =
  | { ok: true }
  | { error: string }

interface ExportResult {
  success?: boolean
  path?: string
  error?: string
  canceled?: boolean
}

interface RendererExportJobPayload {
  jobId: string
  outputPath: string
  plan: any
  profile: {
    id: string
    label: string
    description: string
    encoder: ExportEncoderSettings
  }
}

interface Window {
  api: {
    openFiles: () => Promise<string[]>
    getVideoInfo: (path: string) => Promise<any>
    getThumbnail: (path: string, timeMs: number) => Promise<string>
    validateMediaPaths: (paths: string[]) => Promise<MediaPathValidationResult[]>
    startFrameExport?: (jobId: string, opts: FrameExportOptions) => Promise<FrameExportStartResult>
    sendExportFrame?: (jobId: string, buf: ArrayBuffer) => Promise<FrameExportSendResult>
    finishFrameExport?: (jobId: string) => Promise<FrameExportFinishResult>
    cancelExport?: (jobId: string) => Promise<ExportCancelResult>
    startExportJob: (request: unknown) => Promise<unknown>
    getExportJobs: () => Promise<unknown[]>
    cancelExportJob: (jobId: string) => Promise<unknown>
    removeExportJob: (jobId: string) => Promise<void>
    reportRendererExportProgress?: (jobId: string, pct: number) => Promise<void>
    completeRendererExport?: (jobId: string, result: ExportResult) => Promise<void>
    openPath: (path: string) => Promise<void>
    onExportJobsChanged: (cb: (jobs: unknown[]) => void) => () => void
    onRendererExportJob?: (cb: (payload: RendererExportJobPayload) => void) => () => void
    onRendererExportCancel?: (cb: (payload: { jobId: string }) => void) => () => void
    listProjects: () => Promise<ProjectMeta[]>
    createProject: (name: string) => Promise<{ id: string; name: string; createdAt: string; updatedAt: string }>
    saveProject: (id: string, data: string) => Promise<void>
    loadProject: (id: string) => Promise<string | null>
    deleteProject: (id: string) => Promise<void>
    renameProject: (id: string, name: string) => Promise<void>
  }
}
