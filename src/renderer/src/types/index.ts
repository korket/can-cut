export interface MediaClip {
  id: string
  name: string
  path: string
  duration: number   // ms
  width: number
  height: number
  fps: number
  type: 'video' | 'audio' | 'image'
  thumbnail?: string
  folderId?: string | null
}

export interface MediaFolder {
  id: string
  name: string
}

export interface TimelineItem {
  id: string
  clipId: string
  trackIndex: number
  startTime: number  // ms on timeline
  trimStart: number  // ms into source clip
  trimEnd: number    // ms into source clip (= duration used)
}

export interface TextOverlay {
  id: string
  text: string
  fontFamily: string
  fontSize: number
  color: string
  x: number          // px
  y: number          // px
  startTime: number  // ms on timeline
  endTime: number    // ms on timeline
  bold: boolean
  italic: boolean
}

export type Tool = 'select' | 'text'
