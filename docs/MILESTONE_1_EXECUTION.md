# Milestone 1 Execution Plan

## Objective

Build the first engine-first vertical slice without breaking the current editor UI.

```text
Existing project -> canonical schema -> render graph -> FFmpeg export backend -> benchmark report
```

## Scope

- Create a canonical project schema that can represent current saved projects.
- Add a legacy adapter from the existing editor store/project JSON into the canonical schema.
- Generate a deterministic render graph from the canonical schema.
- Add export strategy selection from the render graph.
- Route compatible timelines to a fast FFmpeg backend.
- Keep current canvas export as fallback only.
- Record benchmark results before and after the migration.

## Out Of Scope

- New editor features.
- UI redesign.
- Native Rust/C++ implementation.
- Full GPU compositor.
- Replacing the current preview renderer.

## Acceptance Criteria

- Existing projects still open and save successfully.
- Render graph generation is deterministic for the same project input.
- Simple timelines export through FFmpeg without canvas frame streaming.
- Unsupported timelines fall back to the current canvas export path.
- Exported duration equals timeline duration within one output frame.
- Audio starts at the correct timeline offset for video and audio clips.
- Baseline and post-migration benchmark reports are checked into the branch or attached to the PR.
- At least one unit-test suite covers schema conversion, render graph generation, and export strategy selection.

## Implementation Order

1. Add package or source boundaries for `core`, `render-graph`, `engine-api`, and `ffmpeg-backend`.
2. Define the canonical schema and migration hooks.
3. Implement current-project-to-schema conversion.
4. Implement render graph generation for existing clip types.
5. Implement backend compatibility analysis.
6. Wire export selection into the existing `ExportModal` flow.
7. Add tests and benchmark comparisons.

## Guardrails

- Do not add new user-facing editing features during this milestone.
- Do not rewrite UI panels unless required for the schema/render-graph adapter.
- Keep the current app launchable throughout the migration.
- Prefer thin adapters over duplicate timeline logic.
- Do not introduce native code until the TypeScript render graph and FFmpeg backend are proven.
