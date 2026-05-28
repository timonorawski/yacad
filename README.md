# yacad

Parametric 3D printing platform built around a content-addressable Merkle DAG of geometric operations.

## What this is

A prototype CAD system whose central bet is that **the parametric model is the artifact, not the STL**. Every operation — a primitive, a transform, a boolean, a Lua snippet — is a node in a Merkle DAG. Every node has a deterministic hash derived from its type, parameters, and child hashes. That hash is the cache key; editing a parameter recomputes only the changed subtree.

The same pattern that underlies Git, IPFS, Bazel, and Nix, applied to CAD.

The target audience sits in a gap: between Tinkercad's accessibility, OpenSCAD's expressiveness, and Thingiverse's social/remix layer. No existing tool covers all three corners.

Status: early prototype. The core pipeline (DAG → cache → Manifold kernel → Web Worker → three.js viewport) is shipped. A second-generation studio UI is in progress. See [docs/features.md](docs/features.md) for what's usable today and [docs/ROADMAP.md](docs/ROADMAP.md) for what's planned.

## Philosophy

A few principles, distilled from [docs/vision.md](docs/vision.md), that shape every design decision in this repo.

**Parametric source is the truth; meshes are derived artifacts.** The DAG is canonical. Meshes are cached computational results, regenerable on demand. The system never relies on meshes as primary data and never asks users to manipulate them directly.

**One DAG, multiple authoring surfaces.** Visual editing, code (Lua), imported parametric formats — all are _views_ onto the same underlying representation. Round-tripping happens through the DAG.

**Code is a first-class node type, not a separate mode.** Following Houdini's model rather than OpenSCAD's: a Lua block is a DAG node with declared inputs, outputs, and parameters, opaque to the visual editor. No attempt to reverse-engineer visual structure from arbitrary code.

**Determinism is non-negotiable.** Non-determinism poisons the Merkle cache. Sandboxed code execution: no I/O, no clock, no unseeded RNG, no network.

**Scope discipline over feature breadth.** Surface lofts, draft analysis, mold parting lines, large assemblies, constraint solving — all explicitly out of scope. What 3D-printable models actually need is a much simpler problem than full mechanical CAD.

**Open-source CAD projects are specification documents, not architectural references.** FreeCAD, OpenSCAD, JSCAD, CadQuery encode decades of hard-won problem-domain knowledge in their test suites and forum threads. Mine them for what the problem is. Design implementation fresh.

**Escape hatches exist and are honest.** When the visual layer can't represent something, surface a code escape hatch. When kernel choice constrains operations (Manifold can't do true BREP fillets), say so. When an AI-reconstructed parametric model is best-guess, mark it that way.

## Try it

Requires Node 22+ and pnpm 10+.

```bash
git clone https://github.com/timonorawski/yacad.git
cd yacad
pnpm install
pnpm dev
```

Then open the URL Vite prints (typically `http://localhost:5173`). The sample-scene dropdown gives a tour of what the kernel can do.

## Where to go next

- **[docs/features.md](docs/features.md)** — capability inventory: what's shipped today.
- **[docs/architecture.md](docs/architecture.md)** — guided tour of the codebase: layered pipeline, package map, threading model, core data structures.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — deferred work, grouped by capability.
- **[docs/vision.md](docs/vision.md)** — original north-star design document. Dense, opinionated, and load-bearing for design decisions. Preserved as-written; the implementation may diverge in places.
- **[docs/language-reference.md](docs/language-reference.md)** — per-node-type reference for the JSON DAG format.

## For contributors

The project is a TypeScript pnpm monorepo. `pnpm test` runs the unit suite, `pnpm build` is the type-check gate (`tsc -b`), `pnpm lint` and `pnpm format:check` round out the CI gates. See [CLAUDE.md](CLAUDE.md) for the working-in-this-repo cheat sheet — invariants that code review treats as load-bearing, commands, layout.

Design and implementation history lives under `docs/superpowers/specs/` (per-phase design docs) and `docs/superpowers/plans/` (per-phase implementation plans). Reading the most recent spec + plan is the fastest way to understand how a phase was scoped.

## License

MIT. See [LICENSE](LICENSE).
