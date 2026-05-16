import type { MediaClip } from '../types'

export function getPreviewSourcePath(clip: MediaClip): string {
  if (clip.type === 'video' && clip.proxy?.status === 'ready' && clip.proxy.path) return clip.proxy.path
  return clip.path
}

export function withPreviewSources(clips: MediaClip[]): MediaClip[] {
  return clips.map((clip) => {
    const previewPath = getPreviewSourcePath(clip)
    return previewPath === clip.path ? clip : { ...clip, path: previewPath }
  })
}
