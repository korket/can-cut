# Professional Native/GPU Editor Plan

## Goal

Turn Can Cut from an Electron/React prototype with canvas-based export into a professional-grade video editor architecture with a native media engine, GPU compositing, hardware-aware export, scalable project storage, and deterministic rendering.

This should be treated as a staged product/engineering migration, not a single rewrite. The current app can remain usable while core systems are replaced behind stable interfaces.

If the team is willing to do a larger refactor, the architecture should become engine-first: build the project model, render graph, and media engine boundary before investing more in UI-level editor features.

## Current Constraints

- Export is primarily renderer-driven: frames are drawn to a browser canvas, encoded as JPEG, sent through Electron IPC, then encoded by FFmpeg.
- Preview rendering and export rendering are coupled through browser primitives instead of a shared media/render engine.
- Timeline, media, selection, layout, playback, and editing state are concentrated in broad Zustand stores.
- Project persistence is plain JSON without schema versioning, migrations, relinking, recovery, or cache metadata.
- Advanced effects are implemented close to React components, making them hard to test, optimize, or reproduce exactly in export.
- There is no render graph, media cache, proxy system, hardware encoder abstraction, or GPU scheduling layer.

## Target Architecture

```text
apps/
  desktop/                 Electron shell, windows, IPC boundary

packages/
  core/                    Project schema, timeline model, commands, migrations
  render-plan/             Timeline normalization and render graph generation
  media-engine/            Native decode, playback, cache, proxy, audio engine
  gpu-compositor/          GPU transforms, effects, transitions, color pipeline
  export-engine/           Render scheduling, hardware/software encoding, muxing
  ui/                      React panels consuming core/editor services
```

The strategic separation is:

```text
Project Model -> Render Plan -> Preview Renderer
                         \-> Export Renderer
```

React should own UI, interaction, panels, and short-lived view state. It should not own final rendering, export correctness, media decoding, or timeline semantics.

## Larger Refactor Recommendation

For a professional-grade editor, a larger refactor is better if it changes the ownership model of the application.

Current ownership:

```text
React/Zustand owns timeline state
React preview interprets timeline state
Export adapts UI state into a renderer
```

Preferred ownership:

```text
Core model owns timeline semantics
Render graph owns render semantics
Media engine owns decode, cache, playback, and export
React owns only UI interaction and presentation
```

The most important refactor is not switching frameworks or rewriting components. The most important refactor is moving editor correctness out of React and into deterministic packages that can be tested, benchmarked, and reused by preview and export.

### Refactor Scope

Use a larger refactor to create these boundaries immediately:

- `core`: project schema, timeline model, commands, validation, migrations.
- `render-graph`: normalized render operations, effect curves, layer ordering, backend compatibility.
- `engine-api`: stable TypeScript interface between the UI and media/export engine.
- `ffmpeg-backend`: first production backend for probing, fast export, audio mix, and simple filter graphs.
- `preview-adapter`: current preview consuming render-graph output during transition.
- `legacy-adapter`: bridge from the existing Zustand state into the new project model until the UI is migrated.

This lets the team rewrite internals without freezing all UI work.

### Process Model

The scalable desktop architecture should separate UI from heavy media work.

```text
Electron Renderer
  React UI, timeline gestures, inspector panels

Electron Main
  Window lifecycle, project I/O, IPC routing

Engine Worker Process or Native Module
  FFmpeg/libav, media cache, render scheduling, encode jobs

GPU Compositor
  Preview surface and export frame compositor
```

Long-running export, waveform generation, thumbnailing, proxy creation, and media probing should not run in the renderer process.

### Recommended Technical Direction

Use this sequence for a larger refactor:

- TypeScript core packages first, because they are fast to build and easy to test.
- FFmpeg CLI backend behind `engine-api` second, because it fixes export performance earlier.
- Worker-process job system third, because it isolates expensive media tasks.
- Rust + `wgpu` + FFmpeg/libav native engine later, once render semantics are stable.

Avoid starting with a full Rust/C++ engine before the render graph is proven. Native code will only help if the app already has clean timeline semantics and backend contracts.

### Measurement Gates

Every major refactor phase should have benchmark gates.

Required metrics:

- Export speed by timeline type, resolution, fps, and encoder.
- Preview FPS while playing and scrubbing.
- Memory usage during import, preview, and export.
- Time to generate thumbnails and waveforms.
- Time to open large projects.
- Output duration correctness.
- Audio/video sync drift.
- Golden-frame visual differences for representative timelines.

Do not accept architecture changes based only on code cleanliness. Accept them when they improve correctness, performance, testability, or future backend flexibility.

## Engine Strategy

### Native Media Engine

Build or integrate a native layer responsible for:

- Media probing and indexing.
- Frame-accurate video/audio decode.
- Audio resampling and mixing.
- Source frame cache.
- Proxy and optimized media generation.
- Hardware decoder selection.
- Hardware encoder selection.
- Export process orchestration.

Candidate implementation paths:

- Rust core with `ffmpeg-next`/FFmpeg bindings and N-API bridge.
- C++ core with libavcodec/libavfilter/libavformat and Node/Electron bindings.
- Hybrid: TypeScript orchestration plus FFmpeg CLI initially, then migrate hot paths into native modules.

Recommended path: start with FFmpeg CLI/filter graphs behind a clean export-engine interface, then migrate to Rust/C++ native modules once the model and render plan are stable.

### GPU Compositor

The compositor should eventually render frames using GPU textures, not browser canvas frames.

Responsibilities:

- Layer compositing.
- Transforms, crop, opacity, blend modes.
- Color corrections.
- Blur/shadow/backdrop effects.
- Transitions.
- Text and vector overlays.
- LUT/color-management hooks.

Candidate APIs:

- WebGPU for cross-platform GPU work inside Electron.
- Native GPU backend later if needed: Vulkan/Metal/D3D12 via `wgpu` or a custom renderer.

Recommended path: design the render graph first, implement an FFmpeg-compatible backend, then add WebGPU/native compositor for unsupported/high-end effects.

## Project Model

Create a versioned schema independent of React state.

Core entities:

- `Project`
- `MediaAsset`
- `MediaReference`
- `Timeline`
- `Track`
- `Clip`
- `TextLayer`
- `EffectStack`
- `Effect`
- `Transition`
- `KeyframeTrack`
- `ExportPreset`
- `RenderCacheManifest`

Requirements:

- Schema versioning.
- Migration functions for every version change.
- Project validation.
- Missing-media detection.
- Media relinking.
- Autosave and crash recovery.
- Deterministic serialization.

## Timeline And Commands

Move all editing behavior into command objects or pure command functions.

Examples:

- `AddMediaAsset`
- `AddClipToTimeline`
- `MoveClip`
- `TrimClipStart`
- `TrimClipEnd`
- `SplitClip`
- `DeleteSelection`
- `SetClipTransform`
- `AddEffect`
- `SetKeyframe`
- `AddTransition`

Benefits:

- Reliable undo/redo.
- Testable editing behavior.
- Better autosave/change tracking.
- Future collaboration support.
- Easier keyboard shortcut routing.

## Render Plan

Introduce a render planner that converts a project timeline into normalized operations.

The planner should:

- Resolve media assets to source paths/proxies.
- Normalize clips, trims, gaps, and overlaps.
- Build track/layer order.
- Identify active ranges.
- Resolve keyframes into property curves.
- Classify effects by backend compatibility.
- Produce a render graph for preview/export.

Example output categories:

- `ffmpeg-compatible`
- `gpu-required`
- `cpu-render-required`
- `unsupported`

## Export Pipeline

Implement export as a strategy-based pipeline.

```text
Project
  -> Validate
  -> Build Render Plan
  -> Analyze Backend Compatibility
  -> Select Export Strategy
  -> Execute Export
  -> Verify Output
```

### Strategy 1: Direct FFmpeg Export

Use for simple/common edits:

- Trim.
- Multi-track overlay.
- Scale/crop/position/rotation.
- Opacity.
- Basic color filters.
- Audio trim/mix/volume.
- Basic text overlays.
- Simple transitions.

This becomes the near-term default fast path.

### Strategy 2: Hybrid Segmented Export

Use FFmpeg for simple timeline regions and render complex sections separately.

Flow:

- Segment the timeline by backend compatibility.
- Render simple segments through FFmpeg.
- Render complex segments through GPU/canvas/native renderer.
- Concatenate all normalized segments.

This reduces fallback cost without requiring the full native engine immediately.

### Strategy 3: Native/GPU Full Export

Long-term target.

Flow:

- Decode into native frames or GPU textures.
- Composite through GPU render graph.
- Mix audio through native audio graph.
- Encode with hardware encoder when available.
- Fall back to software x264/x265/ProRes/DNxHR when needed.

Hardware encoder targets:

- NVIDIA NVENC.
- Intel Quick Sync.
- AMD AMF.
- Apple VideoToolbox.
- Software x264/x265 fallback.

## Preview Pipeline

Preview should become a client of the render plan rather than a separate implementation of timeline semantics.

Phases:

- Keep current React/DOM preview initially.
- Move timing/layer/effect resolution into shared core logic.
- Add a GPU preview surface for compositor-backed playback.
- Add render cache/proxy support for smooth scrubbing.

## Media Cache And Proxies

Professional editors rely heavily on cache layers.

Add:

- Thumbnail cache.
- Waveform cache.
- Probe metadata cache.
- Proxy media generation.
- Optimized intermediate media.
- Render cache for expensive timeline regions.
- Cache invalidation keyed by media hash, timeline range, effect stack, and output settings.

## Storage

Replace single plain JSON project files with a project package structure.

Example:

```text
MyProject.cancut/
  project.json
  autosave/
  cache/
  thumbnails/
  waveforms/
  proxies/
  render-cache/
```

Project files should reference external media by stable media IDs and path metadata, not assume source files always exist.

## UI Refactor

After the core model is stable, split UI state from project state.

Suggested stores/services:

- `projectSession`
- `timelineSelection`
- `playbackController`
- `mediaBrowserState`
- `inspectorState`
- `layoutState`
- `exportSession`
- `historyService`

React components should dispatch commands and subscribe to derived selectors. They should not directly encode timeline business rules.

## Testing Strategy

Prioritize tests around systems that must be deterministic.

Required test areas:

- Project schema validation and migrations.
- Timeline command behavior.
- Undo/redo.
- Clip trim/split/move behavior.
- Keyframe interpolation.
- Render plan generation.
- Export strategy selection.
- FFmpeg filter graph generation.
- Audio mix timing.
- Output duration correctness.

Later add golden-frame tests for renderer consistency.

## Migration Roadmap

This roadmap has two tracks.

The conservative track keeps the existing app structure longer and replaces systems incrementally. The larger-refactor track builds the new engine-facing architecture earlier and uses adapters to keep the current UI alive.

For a scaling product, prefer the larger-refactor track.

## Larger-Refactor Roadmap

### Phase A: Monorepo/Package Split

- Create package boundaries for `core`, `render-graph`, `engine-api`, `ffmpeg-backend`, and `desktop`.
- Keep the existing UI inside `desktop` during migration.
- Add path aliases and package-level TypeScript builds.
- Add unit test infrastructure before moving behavior.

### Phase B: Canonical Project Model

- Define the versioned project schema as the only durable project format.
- Add conversion from current Zustand/editor state into the canonical schema.
- Add schema validation and migrations.
- Make save/load use the canonical schema, even if the UI still uses old stores internally.

### Phase C: Command Layer And Legacy Adapter

- Implement editing commands against the canonical model.
- Route new editing work through commands.
- Add a legacy adapter that synchronizes existing Zustand state with canonical project state.
- Replace snapshot history with command-aware history where possible.

### Phase D: Render Graph First

- Build render-graph generation from the canonical project model.
- Move timeline timing, track ordering, clip ranges, effect stacks, and keyframe evaluation into render-graph code.
- Make preview/export read from render-graph outputs instead of raw UI state.
- Add compatibility analysis for FFmpeg, GPU, and fallback rendering.

### Phase E: Engine API And Job System

- Define an asynchronous `engine-api` for probe, thumbnail, waveform, proxy, preview-frame, and export jobs.
- Move media work out of renderer-driven flows.
- Add job progress, cancellation, error reporting, and logs.
- Keep FFmpeg CLI as the first implementation behind the API.

### Phase F: Fast Export Backend

- Promote FFmpeg render-graph export as the default backend for compatible timelines.
- Keep canvas export only as a temporary fallback adapter.
- Add encoder selection and presets.
- Add hardware encoder detection where FFmpeg supports it.

### Phase G: GPU Preview/Compositor Prototype

- Add a compositor-backed preview surface.
- Start with transforms, opacity, crop, image/video layers, and color filters.
- Compare compositor output against render-graph golden frames.
- Move effects into shader modules only after semantics are stable.

### Phase H: Native Engine

- Replace selected FFmpeg CLI jobs with Rust/C++ native jobs only where benchmarks justify it.
- Add frame-accurate decode APIs.
- Add GPU texture upload path.
- Add render cache and proxy-aware playback.
- Add native audio graph and hardware encoder integration.

### Phase I: Retire Legacy Paths

- Remove raw UI-state export.
- Remove canvas frame export except as an emergency unsupported-backend fallback.
- Remove legacy store-to-schema synchronization after the UI uses canonical commands directly.
- Make render graph the single source of preview/export semantics.

### Phase 0: Stabilize Current App

- Add tests for current timeline duration, trim, split, move, and export option logic.
- Change canvas export encoder preset from `medium` to `veryfast` for immediate relief.
- Add telemetry/logging around export strategy, frame count, resolution, fps, and elapsed time.

### Phase 1: Core Project Schema

- Create `packages/core` or `src/core`.
- Define versioned project schema.
- Add migrations.
- Add validators.
- Convert save/load to use schema functions.

### Phase 2: Command-Based Editing

- Implement command functions for timeline edits.
- Route UI actions through commands.
- Replace snapshot-only history with command-aware history.
- Keep existing Zustand store as an adapter during migration.

### Phase 3: Render Plan And Export Compatibility

- Create render plan generator.
- Create export compatibility analyzer.
- Add tests for backend classification.
- Make export use render plan instead of raw UI store objects.

### Phase 4: Fast FFmpeg Export

- Promote direct FFmpeg export to default for compatible timelines.
- Keep canvas export as fallback.
- Add export mode display: `Fast`, `Hybrid`, or `Fallback`.
- Add software/hardware encoder options.

### Phase 5: Hybrid Export

- Segment timeline by compatibility.
- Render only complex ranges through fallback renderer.
- Normalize and concatenate output segments.
- Add cache reuse for unchanged complex ranges.

### Phase 6: GPU Preview Prototype

- Introduce a WebGPU preview surface.
- Implement basic layer compositing and transforms.
- Compare output against current preview with golden-frame tests.
- Move supported effects into GPU shaders.

### Phase 7: Native Media Engine

- Add Rust or C++ native module boundary.
- Move probing/cache/proxy generation into native layer.
- Add frame-accurate decoding APIs.
- Add hardware decoder discovery.
- Add audio engine primitives.

### Phase 8: Native/GPU Export

- Decode frames into native/GPU memory.
- Composite with GPU render graph.
- Encode through selected hardware/software encoder.
- Add deterministic output verification.
- Retire canvas frame export except as emergency fallback.

## Key Risks

- Native media engines are complex and can consume the whole product roadmap.
- GPU rendering differs across vendors and operating systems.
- Matching preview and export output requires strict render-plan semantics.
- Text rendering consistency can be difficult across canvas, FFmpeg, GPU, and native platforms.
- Hardware encoders have different quality, feature, and pixel-format constraints.
- A big-bang rewrite could stall the app before the new engine is usable.

## Recommended First Implementation Step

Do not start with the native engine. Start by creating the core project schema, command layer, render graph, and engine API interfaces. Those boundaries let the existing app keep working while the renderer/export engine is replaced incrementally.

The first concrete milestone should be:

```text
Current timeline state -> canonical project schema -> render graph -> export strategy selection
```

Once that exists, the team can improve export backends without rewriting UI features repeatedly.

For a larger refactor, the first sprint should produce a thin but real vertical slice:

```text
Existing project -> canonical schema -> render graph -> FFmpeg export backend -> benchmark report
```

That slice proves the new architecture improves export performance before the team commits to a long native/GPU rewrite.
