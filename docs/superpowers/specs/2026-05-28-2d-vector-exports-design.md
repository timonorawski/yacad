# 2D vector exports design (DXF / SVG / PNG)

**Status**: design approved, awaiting implementation plan
**Date**: 2026-05-28
**Scope**: Three new exporters — DXF, SVG, PNG — operating on `CrossSection`. Smallest-possible package surface that unlocks "slice a 3D part → export the section for laser cutting / documentation / wiki embedding."

## Goals

- Ship DXF + SVG + PNG export for any 2D-root scene. Combined with the existing `section` node, this enables the "section + export" workflow (slice → DXF → laser cutter / DXF → fabrication shop / SVG → web display / PNG → Markdown docs).
- Reuse existing patterns: per-format packages (matching `@yacad/export-stl`); pure data-transformer functions (no engine/kernel/cache changes); studio's existing blob+anchor download UX.
- Preserve all prior invariants. Exports are evaluation-time consumers, not node types — they consume `Geometry`, never become part of the DAG.

## Non-goals (deferred — track in ROADMAP.md)

- **2D vector import** (DXF in, SVG in). Useful for "extrude a drafted plate" workflows but a separate problem — input parsing rather than output rendering, different complexity, different test surface. Plan it as a sibling phase once user demand surfaces.
- **DWG support** (proprietary AutoCAD binary). DXF covers ~95% of the share-CAD-files workflow; DWG → DXF conversion is standard upstream. Defer until specific user demand.
- **3D mesh export beyond STL** (OBJ, glTF, PLY, 3MF). The user's broader roadmap calls for these AFTER the mesh data model evolves to carry normals/UVs/materials. Shipping mesh I/O against the current minimal `Mesh` would bake lossy interfaces. Sequenced after the mesh-model evolution.
- **3MF specifically.** Slicer-direction format; belongs with the future print-bridge layer (build-plate arrangement + slicer config), not engine I/O.
- **Per-layer DXF organization.** Initial export emits everything to a single layer (default `'0'`, configurable via `layer` option). Multi-layer organization (e.g., outer contours on layer "cut", interior holes on layer "engrave") is a useful follow-up but adds a per-polygon classification problem that's its own design.
- **Vector SVG with overlay text** (dimension labels, scale bars, technical drawing decoration). The exporter emits raw geometry; annotations are a future feature.
- **Filename customization / save-as dialog.** v1 derives filename from scene id + extension; browser's default download flow handles user-selected location.

## Decisions and rationale

### Scope: ship all three (DXF, SVG, PNG) in one phase

DXF and SVG are pure string emission (no new deps, trivial unit tests). PNG needs a rasterizer, which is the only non-trivial piece — but solving it once unlocks all three formats simultaneously, and PNG is requested for documentation/embedding workflows where SVG alone wouldn't suffice (PDF generation, image-only platforms, slicer thumbnails).

_Rejected:_ DXF + SVG only, defer PNG. Smaller spec but PNG was explicitly part of the user's intent; deferring leaves a known gap.

### Per-format packages (mirroring `@yacad/export-stl`)

Three new workspace packages: `@yacad/export-dxf`, `@yacad/export-svg`, `@yacad/export-png`. Matches the existing `@yacad/export-stl` precedent and the Phase 2.5 `@yacad/import-*` pattern. Each package's deps are scoped to that format (PNG adds `@napi-rs/canvas` as a devDependency for Node-side tests; DXF and SVG have no deps).

_Rejected:_ a unified `@yacad/export-2d` package. Code-sharing benefit is small (the three formats share little beyond a bbox-with-padding helper, which lives naturally on `CrossSection` anyway), and the per-package pattern is already established.

### Output type: `Uint8Array` for all three

DXF and SVG are textual; PNG is binary. Returning `Uint8Array` uniformly matches `@yacad/export-stl` and `@yacad/export-png` (binary) naturally. Callers that want strings call `new TextDecoder().decode(bytes)` — one line, well-understood.

### PNG strategy: pure rasterizer core + browser & Node wrappers

`renderCrossSectionToContext(cs, ctx, opts): void` is environment-agnostic — operates on any `CanvasRenderingContext2D`. Two thin wrappers add the canvas factory and bytes extraction:

- **Browser**: `OffscreenCanvas` + `convertToBlob({type: 'image/png'})`. Native; studio runtime path.
- **Node**: `@napi-rs/canvas` (devDep) + `canvas.toBuffer('image/png')`. Tests path.

The drawing code lives in one place; only the canvas surface and bytes-out differ per environment.

_Rejected:_ PNG via a pure-JS/WASM rasterizer (e.g., `resvg-wasm`). Adds ~500KB+ runtime dep for marginal benefit. The two-wrapper approach has no runtime cost (browser canvas is already loaded by three.js; Node canvas is devDep-only).

### Canvas library: `@napi-rs/canvas`

Rust + napi-rs prebuilt binaries. No cairo native build (the historical pain point with `canvas`). Faster `pnpm install`, more reliable on CI. Our usage of the Canvas 2D API is a small well-supported subset.

_Rejected:_ `canvas` (mature but cairo native build; install reliability concerns on diverse CI platforms). `skia-canvas` (overkill for our minimal API usage).

### Exports stay as functions, not node types

The DAG composes geometry. Exports are terminals — they consume a final `Geometry` and produce bytes for the user to save. Making them nodes would force the architecture to model "what bytes to produce" as a participant in geometry composition, which it isn't.

_Decision confirmed by user during brainstorm._ Locked in.

## Architecture

### Package changes

```text
@yacad/export-dxf  NEW   — crossSectionToDxf(cs, opts?): Uint8Array. Pure JS, no deps.

@yacad/export-svg  NEW   — crossSectionToSvg(cs, opts?): Uint8Array. Pure JS, no deps.

@yacad/export-png  NEW   — renderCrossSectionToContext(cs, ctx2d, opts): void
                           crossSectionToPngBrowser(cs, opts): Promise<Uint8Array>
                           crossSectionToPngNode(cs, opts): Uint8Array
                           @napi-rs/canvas as devDependency.

@yacad/studio            — File → Export submenu gains DXF/SVG/PNG entries.
                           Menu items gate on currentResult.geometry.kind:
                             - 2D root: DXF/SVG/PNG enabled, STL disabled
                             - 3D root: STL enabled, DXF/SVG/PNG disabled.
                           Download uses the existing Blob + anchor pattern.
```

No engine changes, no kernel changes, no cache changes, no worker protocol changes. Exports run on the main thread after the worker returns geometry.

Total new surface: three small packages (~150-300 lines each including tests) plus a handful of additions to the studio's File menu.

### Public surfaces

```ts
// @yacad/export-dxf

export interface DxfOptions {
  /** Layer name for all emitted entities. Default: '0'. */
  readonly layer?: string;
  /** DXF $INSUNITS code. Default: 4 (millimeters). */
  readonly units?: number;
}

export function crossSectionToDxf(cs: CrossSection, opts?: DxfOptions): Uint8Array;

export class ExportError extends Error {}
```

```ts
// @yacad/export-svg

export interface SvgOptions {
  /** Output pixel width. Default: auto-fit from bounds + padding (max 800). */
  readonly width?: number;
  /** Output pixel height. Default: auto-fit from bounds + padding. */
  readonly height?: number;
  /** Padding around content in user-space units. Default: 10. */
  readonly padding?: number;
  /** Stroke color. Default: '#000'. */
  readonly stroke?: string;
  /** Fill color. Default: '#88aacc' (matches studio's 2D fill material). */
  readonly fill?: string;
  /** Stroke width in user-space units. Default: 0.5. */
  readonly strokeWidth?: number;
  /** Background color or null for transparent. Default: null. */
  readonly background?: string | null;
}

export function crossSectionToSvg(cs: CrossSection, opts?: SvgOptions): Uint8Array;

export class ExportError extends Error {}
```

```ts
// @yacad/export-png

export interface PngOptions {
  readonly width: number; // required — PNG is raster, no auto-fit
  readonly height: number;
  readonly padding?: number;
  readonly stroke?: string;
  readonly fill?: string;
  readonly strokeWidth?: number;
  readonly background?: string | null;
}

/** Environment-agnostic core: draws the CrossSection onto an existing 2D
 *  context. Both wrappers below delegate to this. */
export function renderCrossSectionToContext(
  cs: CrossSection,
  ctx: CanvasRenderingContext2D,
  opts: PngOptions,
): void;

/** Browser wrapper — OffscreenCanvas + convertToBlob. */
export async function crossSectionToPngBrowser(
  cs: CrossSection,
  opts: PngOptions,
): Promise<Uint8Array>;

/** Node wrapper — @napi-rs/canvas (devDep). */
export function crossSectionToPngNode(cs: CrossSection, opts: PngOptions): Uint8Array;

export class ExportError extends Error {}
```

### Studio integration

`apps/studio/src/App.svelte` gains:

1. A `File > Export` submenu structure (existing STL entry slots into the same submenu).
2. Per-format download handlers wired to the corresponding exporter.
3. Menu-item state derived from `currentResult.geometry.kind`:
   - `kind === '2d'`: DXF/SVG/PNG enabled, STL disabled.
   - `kind === '3d'`: STL enabled, DXF/SVG/PNG disabled.
4. Download uses the existing `Blob` + anchor pattern (lifted from the current STL export code path).

Filename: `<scene-id>.{dxf,svg,png}`. The browser's default download flow handles location.

## Data flow

### Authoring → eval → export (studio)

1. User authors a scene whose root produces a 2D `CrossSection` (e.g., `section(...)`, `circle(...)`, `offset_2d(...)`).
2. Studio worker evaluates the DAG → `EvaluateResult { geometry: { kind: '2d', section } }` flows back via `WorkerClient`.
3. User selects File → Export → DXF/SVG/PNG.
4. Export handler unwraps `outcome.geometry.section`, calls the matching exporter, downloads the resulting `Uint8Array` via the existing blob/anchor pattern.

Re-export of an unchanged scene is free (no recomputation — the geometry sits in the in-memory `EvaluateResult`; only the exporter runs again).

### Coordinate mapping

Each exporter computes the CrossSection's bounding box (`computeBBox` already exists on `Mesh`; an equivalent `computeBBox2d` helper or inline is fine), then maps:

- **DXF**: identity. CAD-native Y-up. Vertices pass through with their original numeric values; `$INSUNITS` declares mm. `$EXTMIN` / `$EXTMAX` header entries written from the bbox for "fit to window" support.
- **SVG**: Y-flip + padded `viewBox`. Compute bbox `(minX, minY, maxX, maxY)`. ViewBox = `(minX - pad, -maxY - pad, (maxX - minX) + 2*pad, (maxY - minY) + 2*pad)`. Each vertex emits `(x, -y)` so the negated viewBox Y restores CAD orientation. Default `width`/`height` autocomputed to preserve aspect ratio at a sensible pixel resolution (~800px on the longest side).
- **PNG**: same projection as SVG, applied via `ctx.setTransform(scaleX, 0, 0, -scaleY, txX, txY)`. Drawing proceeds in CAD coordinates; canvas renders them correctly oriented.

### Polygon traversal

`CrossSection.polygons` is `ReadonlyArray<ReadonlyArray<Vec2>>` (outer CCW, holes CW per Manifold's convention). For each polygon:

- **DXF**: emit one `LWPOLYLINE` entity with `closed = 1`, `numvertices = polygon.length`, then one X/Y pair per vertex. Winding preserved from input.
- **SVG**: append `M <x0> <y0> L <x1> <y1> L ... Z` to the single `<path>` `d` attribute. Multiple polygons concatenate. `fill-rule="evenodd"` makes CW holes punch correctly.
- **PNG**: `ctx.beginPath()`, then for each polygon `ctx.moveTo(...)`, `ctx.lineTo(...)`, `ctx.closePath()` in sequence (single path block), then one `ctx.fill('evenodd')` + one `ctx.stroke()`.

### Studio download (existing pattern)

```ts
function download(bytes: Uint8Array, filename: string, mimeType: string): void {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

Per format: DXF → `image/vnd.dxf`, SVG → `image/svg+xml`, PNG → `image/png`.

## Error handling

All errors are caller-facing. Exporters don't have meaningful failure modes beyond malformed input.

### Empty CrossSection (`polygons: []`)

Not an error — matches the convention that an empty section is a valid result downstream of a missed slice plane.

- **DXF**: valid file, no `LWPOLYLINE` entities (HEADER + empty ENTITIES + EOF).
- **SVG**: valid file, empty `<path d="">` (or omit the path entirely). ViewBox falls back to `(0, 0, 100, 100)`. Background still rendered if requested.
- **PNG**: `width × height` canvas with only the background fill.

### Degenerate polygon (vertex count < 3 or all-collinear)

Shouldn't happen for a valid `CrossSection` from Manifold. If it does:

- **DXF**: emits the polyline anyway (DXF readers tolerate 2-vertex "polylines" as line segments).
- **SVG/PNG**: emits the path; degenerate paths render as nothing or a line.

No throw — garbage-in-garbage-out at this layer.

### Non-finite coordinates (NaN, Infinity)

Defensive guard: each exporter scans polygons once before serializing. Throws `ExportError("non-finite coordinate at polygon[i][j]")` if any non-finite value is found. The cost is one O(vertices) pass — negligible — and the alternative (writing `NaN` into DXF/SVG/PNG) produces files that downstream tools handle inconsistently.

### PNG-specific: zero or negative width/height

`crossSectionToPngBrowser` / `crossSectionToPngNode` throws `ExportError('width and height must be positive integers')` before invoking the canvas factory. The browser canvas constructors throw their own errors but with less useful messages; pre-validation gives a clean failure.

### Studio: wrong-dimension export attempted

The menu items are grayed out when dimensions don't match (DXF/SVG/PNG on 3D root, STL on 2D root). Defensive guard: if a handler is invoked on the wrong kind, it throws `Error('expected 2D geometry, got 3D')` (or vice versa). Same defensive pattern as the studio's existing render-path guard.

### Determinism

- **DXF/SVG**: same input + options → byte-identical output. No timestamps, no UUIDs, no random ordering. Tests use exact byte comparisons.
- **PNG**: byte-identical only **within one canvas implementation**. Across browser canvas vs `@napi-rs/canvas`, PNG bytes may differ slightly due to subpixel rendering differences. Tests use the Node implementation and assert against golden files generated by that same implementation. Browser verification is via Playwright "canvas non-empty, dimensions correct" smoke.

## Testing strategy

### `@yacad/export-dxf` (`src/dxf.test.ts`)

- Empty CrossSection → valid DXF (structural markers present; no `LWPOLYLINE`).
- Single square (4 vertices) → one `LWPOLYLINE`, `closed=1`, correct X/Y order.
- Multi-polygon (outer + inner hole) → two `LWPOLYLINE` entries, winding preserved.
- Custom `layer: 'profile'` option → layer name in TABLES section and on each entity.
- Non-finite coordinate throws `ExportError`.
- Determinism: identical output across runs.
- Golden-file test: a 3-vertex triangle, golden DXF bytes committed; exact byte match.

### `@yacad/export-svg` (`src/svg.test.ts`)

- Empty CrossSection → valid SVG with fallback viewBox.
- Single square → one `<path>` with correct `M`/`L`/`Z` and Y-flipped coordinates.
- Multi-polygon → single `<path>` with multiple `M`/`Z` blocks and `fill-rule="evenodd"`.
- ViewBox autocomputed from bounds + padding; explicit `width`/`height` overrides pixel dimensions but preserves viewBox.
- Background option emits `<rect>`; null background omits it.
- Custom stroke/fill/strokeWidth round-trip into path attributes.
- Non-finite coordinate throws.
- Golden-file test.

### `@yacad/export-png`

- `src/render.test.ts` (pure rasterizer with mock context):
  - Mock `CanvasRenderingContext2D` recording every call.
  - Empty CrossSection → only background fill / clearRect.
  - Single square → expected sequence `beginPath, moveTo, lineTo×3, closePath, fill('evenodd'), stroke`.
  - `setTransform` invoked once with correct scale + Y-flip + translation matrix.
  - Custom stroke/fill propagate to `fillStyle`/`strokeStyle`.
- `src/node.test.ts` (real `@napi-rs/canvas`):
  - Square fixture rendered at 100×100 → PNG bytes begin with magic `0x89 0x50 0x4E 0x47`; IHDR dimensions match.
  - Golden-file byte-equality on a deterministic 50×50 fixture.
  - Zero-width input throws `ExportError`.

### Studio integration (Playwright smoke in `apps/studio/e2e/studio.spec.ts`)

- Load a 2D scene (e.g., `2d-circle`), open File → Export, assert DXF/SVG/PNG entries enabled and STL disabled.
- Load a 3D scene (`box`), open File → Export, assert STL enabled and DXF/SVG/PNG disabled.

Don't actually trigger downloads (Playwright download handling is fiddly; the menu-state assertion verifies the gating logic).

### E2E corpus

None needed. Exports don't participate in the geometry pipeline.

### Perf guards

None needed. Each exporter is O(vertices) for DXF/SVG; PNG is O(pixels). No surprises expected.

### Drift protection

None needed. Exporters aren't node types — no registry-vs-docs invariant.

## Open questions

- **Multi-layer DXF organization.** Future: assign different layer names per polygon based on user-supplied metadata or polygon role (outer / hole). Tracked in ROADMAP.md.
- **SVG annotations** (dimension labels, scale bars). Future feature; needs its own design pass.
- **DXF/SVG/PNG import**, completing the round-trip. Useful for "extrude a drafted plate" workflows but a sibling phase, not part of this scope.
- **Studio export-format menu polish.** v1 ships functional menu items; visual design (icons, recent-export memory, etc.) is a future studio-UX pass.
