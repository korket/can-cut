# Architecture Decisions

## ADR-001: Engine-First Refactor

Decision: move timeline correctness and render semantics out of React/Zustand into deterministic core packages.

Rationale: professional preview/export behavior requires one shared interpretation of the project timeline. React should manage interaction and presentation, not final render semantics.

## ADR-002: Canonical Project Schema Before Native Engine

Decision: define a versioned TypeScript project schema before adding Rust/C++ native media code.

Rationale: native code will not solve unclear timeline semantics. The app first needs a stable data contract for projects, render graph generation, export, migrations, and tests.

## ADR-003: Render Graph As The Shared Contract

Decision: preview and export should consume render graph output rather than raw UI store state.

Rationale: this makes export strategy selection, backend compatibility, golden-frame tests, and future GPU/native rendering possible without rewriting UI features repeatedly.

## ADR-004: FFmpeg Backend First

Decision: use FFmpeg CLI/filter graphs as the first production backend behind an engine API.

Rationale: FFmpeg is already in the app and can immediately improve export speed for compatible timelines. The API boundary keeps the path open for later Rust/C++ native implementations.

## ADR-005: Worker/Engine Boundary For Heavy Jobs

Decision: long-running media tasks should move behind asynchronous engine jobs.

Rationale: probing, thumbnailing, waveform generation, proxy generation, and export should not block or depend on the Electron renderer process.

## ADR-006: Native/GPU Direction

Decision: the preferred long-term native direction is Rust plus `wgpu` plus FFmpeg/libav bindings, subject to benchmark validation.

Rationale: Rust gives strong safety boundaries for complex media code, and `wgpu` provides a cross-platform path over Vulkan, Metal, D3D12, and WebGPU-style APIs.

## ADR-007: Benchmark-Gated Migration

Decision: each major rendering/export architecture change must include benchmark evidence.

Rationale: cleaner architecture is not enough. The refactor must improve export speed, preview performance, correctness, testability, or backend flexibility.
