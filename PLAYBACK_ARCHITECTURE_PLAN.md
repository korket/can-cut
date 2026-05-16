# Playback Architecture Plan

Goal: move preview playback toward a CapCut/Resolve-style architecture instead of relying on hidden browser video elements sampled into canvas every tick.

## Target Architecture

### 1. Media Analysis Layer
- Probe every imported video with FFprobe.
- Store codec, resolution, bitrate, FPS mode, duration, audio streams, and color metadata.
- Detect difficult preview media: HEVC/H.265, AV1, 4K+, high bitrate, variable frame rate, long GOP, or unsupported Chromium codec.

### 2. Proxy/Optimized Media System
- Generate preview proxies in the app data cache.
- Use H.264, constant frame rate, yuv420p, and fast-decode settings.
- Suggested proxy profiles:
  - 540p for weak machines or heavy timelines
  - 720p as default
  - 1080p for higher-quality preview
- Keep original media for final export.
- Track proxy status: queued, generating, ready, failed.
- Run proxy generation in the background after import.
- Replace preview source with proxy once ready.

### 3. Playback Source Resolver
- Add a resolver that decides what file preview should use:
  - Proxy if available
  - Optimized media if available
  - Original only as fallback
- Export always uses original source media.
- Render cache may use proxy for preview, but export must use originals.

### 4. Preview Playback Engine Refactor
- Stop treating playback as free-running clock plus hidden video sampled into canvas.
- Create a playback coordinator that owns:
  - playhead time
  - active video source
  - video element state
  - frame availability
- Make the clock media-aware:
  - Advance normally when frames are ready.
  - Hold or intentionally drop frames when decode is late.
  - Never let the playhead drift far ahead of decoded video.

### 5. Frame Scheduling
- Maintain a small decoded-frame/readiness window around the playhead.
- Use `requestVideoFrameCallback` where available.
- Draw only when the active video has produced a frame.
- Keep the last good frame visible when decoder is late.
- Support controlled frame dropping instead of random freezes.

### 6. Layer Rendering Strategy
- Split preview rendering into:
  - Fast video base layer playback
  - Overlay compositing for transforms, text, and effects
- For simple timelines, let video playback drive the base frame.
- For complex timelines, composite layers using canvas/WebGL on top.
- For heavy sections, use preview render cache.

### 7. Preview Render Cache
- Pre-render complex timeline spans:
  - transitions
  - effects
  - multiple video layers
  - text-heavy sections
  - keyframes
- Store low-resolution preview cache files.
- During playback, use cached preview media instead of recomputing per frame.
- Invalidate cache when timeline/effects change.

### 8. Codec/Format Normalization
- Normalize proxies to:
  - constant frame rate
  - H.264
  - yuv420p
  - predictable GOP/keyframe interval
  - AAC audio or separate preview audio
- This avoids phone-video and VFR timing issues.

### 9. Background Job System
- Add a persistent, cancellable job queue for:
  - proxy generation
  - waveform analysis
  - thumbnail generation
  - preview render cache generation
- Show job status in the UI.

### 10. User Controls
- Add preview quality menu:
  - Auto
  - Original
  - Proxy 1080p
  - Proxy 720p
  - Proxy 540p
- Add `Generate proxies` and `Regenerate proxies` actions.
- Add `Use proxies for playback` toggle.
- Add `Render preview cache` for selected range.

### 11. Export Separation
- Export path remains original-quality.
- Preview proxies must never silently replace export sources.
- Hybrid export and native export continue using original media paths.

### 12. Instrumentation
- Add preview performance telemetry:
  - dropped frames
  - decode stalls
  - render time
  - active source type: original/proxy/cache
  - average frame interval
- Use telemetry to decide when Auto preview should switch to lower quality or proxy.

## Implementation Phases

### Phase 1: Media Analysis + Proxy Cache ✅
- Probe video files on import. ✅
- Generate 720p H.264 CFR proxies. ✅
- Store proxy metadata. ✅
- Preview uses proxy if ready. ✅
- Automatic proxy generation for existing project videos on open. ✅
- Proxy cache validated and reused across app restarts. ✅
- Transient proxy state stripped from project files (no stale paths saved). ✅

### Phase 2: Proxy Job UI (Partial)
- Background proxy status badges in Media Bin (`PROXY`, `PROXY...`, `NO PROXY`). ✅
- Preview quality setting. ❌
- Manual regenerate proxy action. ❌
- Dedicated proxy job queue/management panel. ❌

### Phase 3: Media-Aware Playback Clock ❌
- Use video frame callbacks / video-driven timing.
- Prevent playhead drift from decoded frame availability.
- Preserve last good frame when decoder stalls.

### Phase 4: Preview Render Cache ❌
- Detect complex timeline ranges.
- Render low-resolution cache clips.
- Play cache for heavy timeline sections.

### Phase 5: GPU Compositor Integration ❌
- Use WebGL compositor for proxy/cached video layers.
- Keep canvas fallback for unsupported effects.
- Move more effects to GPU shaders.

## Current Status

Phase 1 is fully implemented, manually verified, and ready for use. Proxy generation runs automatically on import and on project open. Preview uses ready proxies while export always uses original media. Transient proxy metadata is excluded from project save/load to avoid stale machine-local path issues.

## Next Up

Phase 2: preview quality controls, manual regenerate, and a proper proxy job management system.
