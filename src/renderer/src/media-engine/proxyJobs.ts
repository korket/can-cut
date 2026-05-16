import { useEditorStore } from '../store/useEditorStore'
import type { MediaClip, MediaProxyInfo } from '../types'

type ProxyJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface ProxyJobSnapshot {
  clipId: string
  clipName: string
  status: ProxyJobStatus
  error?: string
  queuedAt: string
  startedAt?: string
  completedAt?: string
}

interface ProxyQueueEntry {
  clipId: string
  sourcePath: string
  force: boolean
}

const MAX_PROXY_JOBS = 2

const jobs = new Map<string, ProxyJobSnapshot>()
const queue: ProxyQueueEntry[] = []
const listeners = new Set<() => void>()
let runningJobs = 0

function notify() {
  for (const listener of listeners) listener()
}

function proxyInfoFromResult(result: MediaProxyResult): MediaProxyInfo {
  if (result.status === 'ready') {
    return {
      status: 'ready',
      profile: result.profile,
      path: result.path,
      width: result.width,
      height: result.height,
      fps: result.fps,
      generatedAt: result.generatedAt,
    }
  }

  return {
    status: 'failed',
    profile: result.profile,
    error: result.error,
    generatedAt: result.generatedAt,
  }
}

function updateClipProxy(clipId: string, sourcePath: string, proxy: MediaProxyInfo) {
  const store = useEditorStore.getState()
  const clip = store.clips.find((candidate) => candidate.id === clipId)
  if (!clip || clip.path !== sourcePath) return
  store.updateClip(clipId, { proxy })
}

function setJob(job: ProxyJobSnapshot) {
  jobs.set(job.clipId, job)
  notify()
}

function drainQueue() {
  while (runningJobs < MAX_PROXY_JOBS && queue.length > 0) {
    const entry = queue.shift()
    if (!entry) return

    const clip = useEditorStore.getState().clips.find((candidate) => candidate.id === entry.clipId)
    if (!clip || clip.type !== 'video' || clip.path !== entry.sourcePath) continue

    runningJobs++
    const startedAt = new Date().toISOString()
    setJob({
      ...(jobs.get(entry.clipId) ?? { queuedAt: startedAt }),
      clipId: clip.id,
      clipName: clip.name,
      status: 'running',
      startedAt,
      error: undefined,
    })
    updateClipProxy(clip.id, clip.path, {
      status: 'generating',
      profile: '720p',
      generatedAt: startedAt,
    })

    void window.api.ensureVideoProxy({ path: clip.path, profile: '720p' })
      .then((result) => {
        const proxy = proxyInfoFromResult(result)
        updateClipProxy(clip.id, clip.path, proxy)
        const completedAt = new Date().toISOString()
        setJob({
          ...(jobs.get(clip.id) ?? { queuedAt: completedAt }),
          clipId: clip.id,
          clipName: clip.name,
          status: result.status === 'ready' ? 'completed' : 'failed',
          error: result.status === 'failed' ? result.error : undefined,
          completedAt,
        })
      })
      .catch((error: unknown) => {
        const completedAt = new Date().toISOString()
        const message = error instanceof Error ? error.message : String(error)
        updateClipProxy(clip.id, clip.path, {
          status: 'failed',
          profile: '720p',
          error: message,
          generatedAt: completedAt,
        })
        setJob({
          ...(jobs.get(clip.id) ?? { queuedAt: completedAt }),
          clipId: clip.id,
          clipName: clip.name,
          status: 'failed',
          error: message,
          completedAt,
        })
      })
      .finally(() => {
        runningJobs--
        drainQueue()
      })
  }
}

export function enqueueVideoProxyForClip(clip: MediaClip, options: { force?: boolean } = {}): void {
  if (clip.type !== 'video') return
  const force = options.force === true
  const currentJob = jobs.get(clip.id)
  if (!force && (currentJob?.status === 'queued' || currentJob?.status === 'running')) return
  if (!force && clip.proxy?.status === 'ready') return

  const queuedAt = new Date().toISOString()
  jobs.set(clip.id, {
    clipId: clip.id,
    clipName: clip.name,
    status: 'queued',
    queuedAt,
  })
  updateClipProxy(clip.id, clip.path, {
    status: 'queued',
    profile: '720p',
    generatedAt: queuedAt,
  })

  const existingIndex = queue.findIndex((entry) => entry.clipId === clip.id)
  if (existingIndex !== -1) queue.splice(existingIndex, 1)
  queue.push({ clipId: clip.id, sourcePath: clip.path, force })
  notify()
  drainQueue()
}

export function enqueueVideoProxiesForClips(clips: MediaClip[], options: { force?: boolean } = {}): void {
  for (const clip of clips) enqueueVideoProxyForClip(clip, options)
}

export function getProxyJobs(): ProxyJobSnapshot[] {
  return [...jobs.values()].sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
}

export function subscribeProxyJobs(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
