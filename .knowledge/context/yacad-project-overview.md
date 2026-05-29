---
topic: yacad-project-overview
tags:
  - overview
  - architecture
  - parametric-cad
  - merkle-dag
files:
  - package.json
  - README.md
  - CLAUDE.md
  - docs/vision.md
  - docs/architecture.md
  - docs/ROADMAP.md
created: '2026-05-29T12:43:17.152813Z'
updated: '2026-05-29T12:43:17.152813Z'
---

## Project Overview

YACAD is a parametric 3D printing platform built around a **content-addressable Merkle DAG of geometric operations**. The core bet: **the parametric model is the artifact, not the STL**.

### Target Audience

Fills the gap between:

- **Tinkercad's accessibility** (direct manipulation, immediate feedback)
- **OpenSCAD's power** (full parametric expressiveness with code escape hatch)
- **Thingiverse's social layer** (shareable, remixable models)

### Core Architecture

Uses the same pattern as Git, IPFS, Bazel, and Nix applied to CAD:

- Each node has deterministic hash from `type + params + child_hashes`
- Hash is the cache key - enables incremental recomputation
- Edit one parameter → only changed subtree recomputes
- Content-addressable sharing across users

## Key Architectural Principles

1. **Parametric source is truth; meshes are derived artifacts** - DAG is canonical
2. **Determinism is non-negotiable** - enables Merkle caching (no I/O, clock, unseeded RNG)
3. **Code is first-class node type** - Lua nodes compose with visual nodes through DAG
4. **Dual type system** - 2D shapes vs 3D solids, typed operations catch errors early
5. **Scope discipline over feature breadth** - focused on 3D printing needs, not full mechanical CAD

## Current Status

**Mature and shipped:** Core pipeline complete, Studio v2 live at cad.yamplay.cc

**Shipped phases:**

- Phase 0: Merkle DAG + Manifold kernel + worker + studio v1
- Phase 1: LuaNode (sandboxed Lua code nodes)
- Phase 2: 2D layer (14 new node types)
- Phase 2.5: Mesh imports (STL/OBJ/glTF decoder nodes)
- Section node, 2D vector exports, Lua static validation, warp node
- Studio v2 foundation + tree editor

## Development Workflow

**Commands:**

```bash
pnpm install        # install deps
pnpm build          # tsc -b all packages
pnpm test           # vitest run all tests
pnpm dev:v2         # run studio2 (active app)
pnpm build:v2       # production build studio2
```

**Key files:**

- `docs/vision.md` - load-bearing architectural spec
- `docs/architecture.md` - implementer-friendly layered overview
- `docs/ROADMAP.md` - shipped phases + deferred features
- `CLAUDE.md` - working-in-repo guidance + invariants
