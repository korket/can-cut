import { useEditorStore } from '../store/useEditorStore'
import type { MediaClip } from '../types'
import { nanoid } from './nanoid'

function evalFPS(str: string | undefined): number {
  if (!str) return 30
  const [n, d] = str.split('/').map(Number)
  return d ? Math.round(n / d) : 30
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
        thumbnail: `file://${path}`
      }
    }

    const info = await window.api.getVideoInfo(path)
    const vs = info.streams?.find((s: any) => s.codec_type === 'video')
    const durationSec = parseFloat(info.format?.duration ?? '0')

    const clip: MediaClip = {
      id: nanoid(),
      name,
      path,
      duration: Math.round(durationSec * 1000),
      width: vs?.width ?? 1920,
      height: vs?.height ?? 1080,
      fps: vs ? evalFPS(vs.r_frame_rate) : 30,
      type: vs ? 'video' : 'audio'
    }

    if (clip.type === 'video') {
      try {
        const thumb = await window.api.getThumbnail(path, 0)
        clip.thumbnail = `file://${thumb}`
      } catch (_) {}
    }

    return clip
  } catch (e) {
    console.error('Failed to import', path, e)
    return null
  }
}

export async function importAndAddClips(paths: string[], folderId?: string): Promise<MediaClip[]> {
  const { addClip } = useEditorStore.getState()
  const results: MediaClip[] = []
  for (const path of paths) {
    if (!isSupportedMedia(path)) continue
    const clip = await importClip(path)
    if (clip) {
      if (folderId) clip.folderId = folderId
      addClip(clip)
      results.push(clip)
    }
  }
  return results
}
