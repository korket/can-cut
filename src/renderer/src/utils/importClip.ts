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
        thumbnail: `file://${path}`,
        importedAt,
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
      type: vs ? 'video' : 'audio',
      importedAt,
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
        results.push(clip)
      }
    }
  }
  return results
}
