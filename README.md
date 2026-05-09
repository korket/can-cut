# can-cut

A CapCut-style desktop video editor built with Electron, React, and TypeScript.

## Features

- **Multi-track timeline** — drag clips onto multiple video and audio tracks; all active video layers composite in real time
- **Preview player** — live playback with per-track compositing, transitions, and Ken Burns animation
- **Clip editing** — trim, split, move, and delete clips on the timeline
- **Transitions** — crossfade, fade-to-color, and directional wipes between clips
- **Ken Burns** — pan-and-zoom animation on image/video clips with preset presets
- **Transform** — scale, position, rotation, pitch/yaw, flip, and crop per clip
- **Effects** — brightness, contrast, saturation, hue, blur, opacity, grayscale, sepia
- **Animations** — fade, zoom, and slide in/out per clip
- **Keyframes** — per-property keyframe tracks with linear/ease interpolation
- **Text overlays** — add, style, and position text on the timeline
- **Media bin** — import clips, organize into folders, preview thumbnails
- **Waveform display** — audio waveform rendered on timeline tracks
- **Export** — render to MP4 via FFmpeg (resolution, bitrate, fps configurable)
- **Keyboard shortcuts** — customizable shortcuts for all major actions
- **Undo/redo** — full history for all timeline edits
- **Pointer-lock scrubbing** — infinite-range value sliders (DaVinci Resolve-style)
- **Snap** — clip edges and playhead snap to neighboring clip boundaries

## Tech Stack

- [Electron](https://www.electronjs.org/) + [electron-vite](https://evite.netlify.app/)
- [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Zustand](https://zustand-demo.pmnd.rs/) for state management
- [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) + [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) for export and probe

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

The packaged app outputs to `out/`.

## Project Structure

```
src/
  main/           Electron main process (file dialogs, FFmpeg export, ffprobe)
  renderer/
    src/
      components/ React UI components (Timeline, PreviewPlayer, PropertiesPanel, …)
      hooks/      useKeyboardShortcuts, useAudioEngine
      store/      Zustand stores (useEditorStore, useHistoryStore, useShortcutsStore)
      types/      Shared TypeScript types
      utils/      frame math, keyframe interpolation, waveform, clip import
```
