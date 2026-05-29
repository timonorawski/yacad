---
topic: coordinate-system-convention
tags:
  - coordinates
  - z-up
  - rendering
  - manifold
  - three.js
  - shipped
files:
  - packages/render/src/geometry.ts
  - packages/render/src/viewport.ts
  - packages/kernel-manifold/src/kernel.ts
created: '2026-05-29T14:38:03.809367Z'
updated: '2026-05-29T14:50:59.981427Z'
---

## Overview

YACAD uses a **Z-up right-handed coordinate system** for all geometry operations, matching Manifold, OpenSCAD, and STL conventions. This is the canonical convention, documented in `docs/architecture.md`.

## Coordinate Transform (Shipped)

The render package applies a `(x, y, z) → (x, z, -y)` swizzle when converting kernel geometry to three.js BufferGeometry. This maps kernel Z-up to viewport Y-up while preserving right-handedness.

Applied in:

- `meshToBufferGeometry` — 3D mesh vertices
- `crossSectionToBufferGeometry` — 2D triangulated fill
- `buildOutline` — 2D polygon outlines
- `showPlaceholder` / `zoomToBox` — bounding boxes

The viewport displays axis labels showing the kernel convention (X red, Y blue, Z green pointing up).

## Revolve Default Axis

Changed from `'y'` to `'z'` to match the canonical Z-up convention. Manifold's native revolve frame has ring axis = Z, so the default now requires no post-rotation.

## Exports

- **STL**: no coordinate transform — Z-up matches slicer convention
- **DXF**: no transform — Y-up 2D matches XY plane
- **SVG/PNG**: Y-flip applied (CAD Y-up to screen Y-down)

## Camera Presets

After the viewport transform, named views correctly match kernel conventions:

- "top" looks down kernel Z (the up axis)
- "front" shows kernel XZ plane (X horizontal, Z vertical)
- "right" shows kernel YZ plane (Y horizontal, Z vertical)
