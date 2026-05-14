import type {
  Animation,
  Effects,
  KenBurns,
  KeyframeTrack,
  MediaClip,
  TextOverlay,
  TimelineItem,
  Transform,
  Transition,
} from '../types'
import { getTimelineDuration } from './timeline'

export interface RenderResolution {
  width: number
  height: number
}

export interface RenderAsset {
  id: string
  name: string
  path: string
  duration: number
  width: number
  height: number
  fps: number
  type: MediaClip['type']
  color?: string
}

export interface VideoRenderLayer {
  id: string
  asset: RenderAsset
  trackIndex: number
  startTime: number
  trimStart: number
  trimEnd: number
  volume: number
  transform?: Transform
  effects?: Effects
  animation?: Animation
  transitionIn?: Transition
  kenBurns?: KenBurns
  keyframeTracks?: KeyframeTrack[]
}

export interface AudioRenderLayer {
  id: string
  asset: RenderAsset
  trackIndex: number
  startTime: number
  trimStart: number
  trimEnd: number
  volume: number
}

export interface TextRenderLayer extends TextOverlay {}

export interface RenderPlan {
  schemaVersion: 1
  fps: number
  resolution: RenderResolution
  durationMs: number
  videoLayers: VideoRenderLayer[]
  audioLayers: AudioRenderLayer[]
  textLayers: TextRenderLayer[]
}

export interface CreateRenderPlanInput {
  resolution: string
  fps: number
  duration?: number
  timelineItems: TimelineItem[]
  clips: MediaClip[]
  textOverlays: TextOverlay[]
}

function parseResolution(resolution: string): RenderResolution {
  const [width, height] = resolution.split('x').map(Number)
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1920,
    height: Number.isFinite(height) && height > 0 ? height : 1080,
  }
}

function toAsset(clip: MediaClip): RenderAsset {
  return {
    id: clip.id,
    name: clip.name,
    path: clip.path,
    duration: clip.duration,
    width: clip.width,
    height: clip.height,
    fps: clip.fps,
    type: clip.type,
    color: clip.color,
  }
}

export function createRenderPlan(input: CreateRenderPlanInput): RenderPlan {
  const videoLayers: VideoRenderLayer[] = []
  const audioLayers: AudioRenderLayer[] = []

  for (const item of input.timelineItems) {
    const clip = input.clips.find((candidate) => candidate.id === item.clipId)
    if (!clip) continue

    const base = {
      id: item.id,
      asset: toAsset(clip),
      trackIndex: item.trackIndex,
      startTime: item.startTime,
      trimStart: item.trimStart,
      trimEnd: item.trimEnd,
      volume: item.volume ?? 100,
    }

    if (clip.type === 'audio') {
      audioLayers.push(base)
    } else {
      videoLayers.push({
        ...base,
        transform: item.transform,
        effects: item.effects,
        animation: item.animation,
        transitionIn: item.transitionIn,
        kenBurns: item.kenBurns,
        keyframeTracks: item.keyframeTracks,
      })
    }
  }

  return {
    schemaVersion: 1,
    fps: input.fps,
    resolution: parseResolution(input.resolution),
    durationMs: input.duration ?? getTimelineDuration(input.timelineItems),
    videoLayers: videoLayers.sort((a, b) => a.trackIndex - b.trackIndex || a.startTime - b.startTime),
    audioLayers: audioLayers.sort((a, b) => a.trackIndex - b.trackIndex || a.startTime - b.startTime),
    textLayers: [...input.textOverlays],
  }
}

export function getRenderPlanAssets(plan: RenderPlan): MediaClip[] {
  const assets = new Map<string, MediaClip>()

  for (const layer of [...plan.videoLayers, ...plan.audioLayers]) {
    if (assets.has(layer.asset.id)) continue
    assets.set(layer.asset.id, {
      id: layer.asset.id,
      name: layer.asset.name,
      path: layer.asset.path,
      duration: layer.asset.duration,
      width: layer.asset.width,
      height: layer.asset.height,
      fps: layer.asset.fps,
      type: layer.asset.type,
      color: layer.asset.color,
    })
  }

  return [...assets.values()]
}

export function getRenderPlanTimelineItems(plan: RenderPlan): TimelineItem[] {
  return [...plan.videoLayers, ...plan.audioLayers]
    .map((layer) => ({
      id: layer.id,
      clipId: layer.asset.id,
      trackIndex: layer.trackIndex,
      startTime: layer.startTime,
      trimStart: layer.trimStart,
      trimEnd: layer.trimEnd,
      volume: layer.volume,
      ...('transform' in layer && layer.transform ? { transform: layer.transform } : {}),
      ...('effects' in layer && layer.effects ? { effects: layer.effects } : {}),
      ...('animation' in layer && layer.animation ? { animation: layer.animation } : {}),
      ...('transitionIn' in layer && layer.transitionIn ? { transitionIn: layer.transitionIn } : {}),
      ...('kenBurns' in layer && layer.kenBurns ? { kenBurns: layer.kenBurns } : {}),
      ...('keyframeTracks' in layer && layer.keyframeTracks ? { keyframeTracks: layer.keyframeTracks } : {}),
    }))
    .sort((a, b) => a.trackIndex - b.trackIndex || a.startTime - b.startTime)
}
