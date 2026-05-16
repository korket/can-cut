import { useEditorStore } from '../store/useEditorStore'
import { enqueueVideoProxyForClip } from '../media-engine/proxyJobs'
import type { MediaAnalysis, MediaClip } from '../types'
import { toFileUrl } from './fileUrl'
import { nanoid } from './nanoid'

function evalFPS(str: string | undefined): number {
  if (!str) return 30
  const [n, d] = str.split('/').map(Number)
  const fps = d ? n / d : n
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 30
}

function probeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

function probeDurationSec(info: any, stream: any): number | null {
  return probeNumber(info?.format?.duration) ?? probeNumber(stream?.duration)
}

function fpsMode(stream: any): MediaAnalysis['fpsMode'] {
  const avg = stream?.avg_frame_rate
  const real = stream?.r_frame_rate
  if (!avg || !real || avg === '0/0' || real === '0/0') return 'unknown'
  return avg === real ? 'constant' : 'variable'
}

function createMediaAnalysis(info: any, videoStream: any): MediaAnalysis {
  const audioStream = info.streams?.find((s: any) => s.codec_type === 'audio')
  const bitrate = probeNumber(info?.format?.bit_rate) ?? undefined
  const mode = fpsMode(videoStream)
  const reasons: string[] = []
  const width = probeNumber(videoStream?.width) ?? 0
  const height = probeNumber(videoStream?.height) ?? 0
  const codec = typeof videoStream?.codec_name === 'string' ? videoStream.codec_name : undefined

  if (codec && ['hevc', 'h265', 'av1', 'vp9'].includes(codec.toLowerCase())) reasons.push(`codec ${codec}`)
  if (width >= 3840 || height >= 2160) reasons.push('4K+ resolution')
  if (bitrate && bitrate >= 30_000_000) reasons.push('high bitrate')
  if (mode !== 'constant') reasons.push(`${mode} frame rate`)

  return {
    videoCodec: codec,
    audioCodec: typeof audioStream?.codec_name === 'string' ? audioStream.codec_name : undefined,
    bitrate,
    fpsMode: mode,
    needsProxy: reasons.length > 0,
    proxyReasons: reasons,
  }
}

export function ensureVideoProxyForClip(clip: MediaClip): void {
  enqueueVideoProxyForClip(clip)
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'])
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'avif'])

export function isSupportedMedia(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext) || IMAGE_EXTS.has(ext)
}

export async function importClip(path: string): Promise<MediaClip | null> {
  try {
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const name = path.split(/[\\/]/).pop() ?? path
    const importedAt = new Date().toISOString()

    if (IMAGE_EXTS.has(ext)) {
      // Use ffprobe to get dimensions; images have no duration so default to 5s
      let width = 1920
      let height = 1080
      try {
        const info = await window.api.getVideoInfo(path)
        const vs = info.streams?.find((s: any) => s.codec_type === 'video')
        if (vs) { width = vs.width ?? 1920; height = vs.height ?? 1080 }
      } catch (_) {}

      return {
        id: nanoid(),
        name,
        path,
        duration: 3_600_000, // images have no real duration; allow up to 1 h on timeline
        width,
        height,
        fps: 30,
        type: 'image',
        thumbnail: toFileUrl(path),
        importedAt,
      }
    }

    const info = await window.api.getVideoInfo(path)
    const vs = info.streams?.find((s: any) => s.codec_type === 'video')
    const durationSec = probeDurationSec(info, vs ?? info.streams?.[0])
    const durationMs = durationSec ? Math.round(durationSec * 1000) : 5000

    const clip: MediaClip = {
      id: nanoid(),
      name,
      path,
      duration: Math.max(1, durationMs),
      width: vs?.width ?? 1920,
      height: vs?.height ?? 1080,
      fps: vs ? evalFPS(vs.avg_frame_rate ?? vs.r_frame_rate) : 30,
      type: vs ? 'video' : 'audio',
      importedAt,
      ...(vs ? {
        analysis: createMediaAnalysis(info, vs),
        proxy: { status: 'queued', profile: '720p' as const },
      } : {}),
    }

    if (clip.type === 'video') {
      try {
        const thumb = await window.api.getThumbnail(path, 0)
        clip.thumbnail = toFileUrl(thumb)
      } catch (_) {}
    }

    return clip
  } catch (e) {
    console.error('Failed to import', path, e)
    return null
  }
}

export async function importAndAddClips(paths: string[], folderId?: string): Promise<MediaClip[]> {
  const { addClip, addFolder } = useEditorStore.getState()
  const entries = await window.api.resolveMediaImportPaths(paths)
  const results: MediaClip[] = []
  const folderNames = new Set(useEditorStore.getState().folders.map((folder) => folder.name.toLowerCase()))

  function uniqueFolderName(baseName: string) {
    const rootName = baseName.trim() || 'Imported Folder'
    let name = rootName
    let suffix = 2
    while (folderNames.has(name.toLowerCase())) {
      name = `${rootName} ${suffix}`
      suffix += 1
    }
    folderNames.add(name.toLowerCase())
    return name
  }

  for (const entry of entries) {
    if (entry.files.length === 0) continue

    let targetFolderId = folderId
    if (!targetFolderId && entry.isDirectory) {
      targetFolderId = nanoid()
      addFolder({ id: targetFolderId, name: uniqueFolderName(entry.name) })
    }

    for (const path of entry.files) {
      if (!isSupportedMedia(path)) continue
      const clip = await importClip(path)
      if (clip) {
        if (targetFolderId) clip.folderId = targetFolderId
        addClip(clip)
        ensureVideoProxyForClip(clip)
        results.push(clip)
      }
    }
  }
  return results
}
