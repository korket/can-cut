import type { ExportProfile } from '../editor-core/exportSettings'
import { createRenderPlanFingerprint, type RenderPlan } from '../editor-core/renderPlan'

export interface RenderCacheDescriptor {
  version: 2
  rendererId: string
  planHash: string
  profileId: string
  videoCodec: string
  framePipeFormat: string
  width: number
  height: number
  fps: number
}

export function createRenderCacheDescriptor(
  plan: RenderPlan,
  profile: ExportProfile,
  rendererId: string,
): RenderCacheDescriptor {
  return {
    version: 2,
    rendererId,
    planHash: createRenderPlanFingerprint(plan),
    profileId: profile.id,
    videoCodec: profile.encoder.videoCodec,
    framePipeFormat: profile.encoder.framePipeFormat,
    width: plan.resolution.width,
    height: plan.resolution.height,
    fps: plan.fps,
  }
}

export function createRenderCacheKey(descriptor: RenderCacheDescriptor): string {
  return [
    `v${descriptor.version}`,
    descriptor.rendererId,
    descriptor.planHash,
    descriptor.profileId,
    descriptor.videoCodec,
    descriptor.framePipeFormat,
    `${descriptor.width}x${descriptor.height}`,
    `${descriptor.fps}fps`,
  ].join(':')
}
