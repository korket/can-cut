import type { MediaClip, PreviewQuality } from '../types'

export function getPreviewSourcePath(clip: MediaClip, quality: PreviewQuality = 'auto'): string {
  if (quality === 'original') return clip.path
  if (clip.type === 'video' && clip.proxy?.status === 'ready' && clip.proxy.path) return clip.proxy.path
  return clip.path
}

export function withPreviewSources(clips: MediaClip[], quality: PreviewQuality = 'auto'): MediaClip[] {
  return clips.map((clip) => {
    const previewPath = getPreviewSourcePath(clip, quality)
    return previewPath === clip.path ? clip : { ...clip, path: previewPath }
  })
}
