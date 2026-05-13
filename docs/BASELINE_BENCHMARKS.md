# Baseline Benchmarks

## Purpose

This document defines the baseline that future refactor phases must beat or preserve.

The current app cannot perform a fully automated end-to-end export benchmark without launching the Electron UI and selecting an output path. Until an automated fixture exporter exists, the baseline is split into automated repository/build capture and manual editor/export measurements.

## Automated Capture

Run:

```bash
npm run benchmark:baseline
```

This writes:

```text
benchmarks/baseline-current.json
```

The report includes:

- OS and Node/npm versions.
- Git branch and commit.
- Build duration and build success/failure.
- Current export implementation facts detected from source.
- Source file counts.

## Manual Export Fixture

Use this fixture before replacing the export pipeline:

- Project: one 60-second 1080p H.264 video clip on V1.
- Export: 1920x1080, 30 fps, MP4.
- Record: elapsed export time, output duration, output file size, peak memory, and whether audio stays in sync.

Second fixture:

- Project: two overlapping 30-second video clips, one image overlay, one text overlay, one audio track.
- Export: 1920x1080, 30 fps, MP4.
- Record: elapsed export time, output duration, output file size, peak memory, and visual correctness notes.

Third fixture:

- Project: complex timeline using keyframes, transition, blur, shadow, and Ken Burns.
- Export: 1920x1080, 30 fps, MP4.
- Record: elapsed export time and whether fallback export is selected.

## Performance Targets For Milestone 1

- Simple fixture should use fast FFmpeg export instead of canvas frame export.
- Simple fixture should export materially faster than the current baseline.
- Output duration should match timeline duration within one frame.
- Audio/video sync drift should not be visibly detectable.
- Complex fixture may still fall back to canvas export, but it must report that fallback explicitly.

## Current Baseline Notes

- Current default export path in `ExportModal` calls `renderAndExport` from `src/renderer/src/utils/exportRenderer.ts`.
- `renderAndExport` renders every output frame to a browser canvas.
- Each canvas frame is JPEG encoded and sent to the main process through Electron IPC.
- The main process pipes JPEG frames into FFmpeg and encodes MP4 with x264.
- This path is flexible but slow, especially for video clips because each output frame seeks browser video elements.
