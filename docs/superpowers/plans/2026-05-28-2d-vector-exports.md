# 2D Vector Exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three new exporters — DXF, SVG, PNG — for any 2D-root scene. Spec: [docs/superpowers/specs/2026-05-28-2d-vector-exports-design.md](../specs/2026-05-28-2d-vector-exports-design.md).

**Architecture:** Three per-format packages (`@yacad/export-dxf`, `@yacad/export-svg`, `@yacad/export-png`) mirroring the existing `@yacad/export-stl` pattern. DXF/SVG are pure string emission; PNG splits into an environment-agnostic rasterizer core plus thin browser (`OffscreenCanvas`) and Node (`@napi-rs/canvas`) wrappers. Studio adds three buttons next to the existing Export STL button, each gated on the current result's geometry kind.

**Tech Stack:** TypeScript / pnpm workspaces, Vitest, `@napi-rs/canvas` (devDep for PNG Node tests), browser Canvas 2D + OffscreenCanvas (runtime), three.js (unchanged), Playwright (existing studio smoke).

**Spec reference:** Read [docs/superpowers/specs/2026-05-28-2d-vector-exports-design.md](../specs/2026-05-28-2d-vector-exports-design.md) before starting. If you find tension between plan and spec, the spec wins — pause and raise it.

**Project conventions (skim before starting):**

- Tests live next to source: `foo.ts` + `foo.test.ts` colocated. Vitest, no `__tests__/` subdirs.
- `pnpm --filter @yacad/<pkg> test` runs one package's tests; `pnpm vitest run packages/<pkg>` works too.
- `pnpm build` is the type-correctness gate (`tsc -b` with project references).
- Each new workspace package needs `package.json`, `tsconfig.json` (extending `../../tooling/tsconfig/base.json` with project references), and a re-exporting `src/index.ts`. Look at `packages/export-stl/` for the canonical small-package template.
- Commit cadence: one commit per task; conventional-commit prefixes (`feat:`, `test:`, `chore:`).
- TDD: failing test first, confirm failure, implement, confirm pass, commit.
- Run `pnpm format` and `pnpm lint` before the final acceptance commit.

**Existing infrastructure to reuse:**

- `CrossSection` type from `@yacad/geometry` (`{ polygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>> }`).
- `Vec2` from `@yacad/geometry`.
- Studio's existing Blob+anchor download pattern (`apps/studio/src/App.svelte:689-698` for the STL precedent).
- Studio's reactive `$state` pattern for tracking the latest evaluated geometry (currently `lastMesh` — we'll add a `lastCrossSection` sibling).

**Note on studio UI scope:**

The spec described "File → Export submenu" but the studio currently has a single `<button onclick={exportStl}>Export STL</button>` with no menu component. This plan adds three more buttons next to it (per-format buttons with `disabled` predicates), not a new menu. A proper File menu is its own UX design and not in scope here.

---

## Task 1: `@yacad/export-dxf` package

**Files:**

- Create: `packages/export-dxf/package.json`
- Create: `packages/export-dxf/tsconfig.json`
- Create: `packages/export-dxf/src/index.ts`
- Create: `packages/export-dxf/src/dxf.ts`
- Create: `packages/export-dxf/src/dxf.test.ts`

- [ ] **Step 1: Scaffold the package**

Create `packages/export-dxf/package.json`:

```json
{
  "name": "@yacad/export-dxf",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "clean": "tsc -b --clean"
  },
  "dependencies": {
    "@yacad/geometry": "workspace:*"
  },
  "devDependencies": {
    "@yacad/tsconfig": "workspace:*"
  }
}
```

Create `packages/export-dxf/tsconfig.json`:

```json
{
  "extends": "../../tooling/tsconfig/base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"],
  "references": [{ "path": "../geometry" }]
}
```

Create `packages/export-dxf/src/index.ts`:

```ts
export { crossSectionToDxf, ExportError } from './dxf';
export type { DxfOptions } from './dxf';
```

Run: `pnpm install`
Expected: new workspace package detected.

- [ ] **Step 2: Write the failing tests**

Create `packages/export-dxf/src/dxf.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CrossSection } from '@yacad/geometry';
import { crossSectionToDxf, ExportError } from './dxf';

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

const emptyCs: CrossSection = { polygons: [] };

const squareCs: CrossSection = {
  polygons: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  ],
};

const squareWithHoleCs: CrossSection = {
  polygons: [
    // Outer CCW
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    // Hole CW
    [
      [3, 3],
      [3, 7],
      [7, 7],
      [7, 3],
    ],
  ],
};

describe('crossSectionToDxf', () => {
  it('emits a valid DXF for an empty CrossSection (no LWPOLYLINE)', () => {
    const dxf = decode(crossSectionToDxf(emptyCs));
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('HEADER');
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('EOF');
    expect(dxf).not.toContain('LWPOLYLINE');
  });

  it('emits one LWPOLYLINE per polygon with correct vertex count and coords', () => {
    const dxf = decode(crossSectionToDxf(squareCs));
    expect(dxf).toContain('LWPOLYLINE');
    // 4 vertices, closed
    expect(dxf).toMatch(/^\s*90\s*\n\s*4\s*$/m); // group code 90 = vertex count
    expect(dxf).toMatch(/^\s*70\s*\n\s*1\s*$/m); // group code 70 = flags (1 = closed)
    // First vertex (group 10 = x, 20 = y)
    expect(dxf).toMatch(/^\s*10\s*\n\s*0(\.0+)?\s*$/m);
  });

  it('emits two LWPOLYLINE entries for a multi-polygon CrossSection', () => {
    const dxf = decode(crossSectionToDxf(squareWithHoleCs));
    const matches = dxf.match(/LWPOLYLINE/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('uses the supplied layer name on each entity', () => {
    const dxf = decode(crossSectionToDxf(squareCs, { layer: 'profile' }));
    // Layer table entry
    expect(dxf).toContain('profile');
    // Group code 8 = layer on entity
    expect(dxf).toMatch(/^\s*8\s*\n\s*profile\s*$/m);
  });

  it('defaults layer to "0" and units to mm (4)', () => {
    const dxf = decode(crossSectionToDxf(squareCs));
    expect(dxf).toMatch(/^\s*8\s*\n\s*0\s*$/m);
    // $INSUNITS header
    expect(dxf).toContain('$INSUNITS');
    expect(dxf).toMatch(/\$INSUNITS\s*\n\s*70\s*\n\s*4/);
  });

  it('throws ExportError on non-finite coordinates', () => {
    const bad: CrossSection = {
      polygons: [
        [
          [0, 0],
          [Infinity, 0],
          [1, 1],
        ],
      ],
    };
    expect(() => crossSectionToDxf(bad)).toThrow(ExportError);
  });

  it('is deterministic — same input produces byte-identical output', () => {
    const a = crossSectionToDxf(squareCs);
    const b = crossSectionToDxf(squareCs);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 3: Run and verify failure**

Run: `pnpm vitest run packages/export-dxf/src/dxf.test.ts`
Expected: FAIL — module `./dxf` not found.

- [ ] **Step 4: Implement `dxf.ts`**

Create `packages/export-dxf/src/dxf.ts`:

```ts
import type { CrossSection } from '@yacad/geometry';

export interface DxfOptions {
  /** Layer name for all emitted entities. Default: '0'. */
  readonly layer?: string;
  /** DXF $INSUNITS code. Default: 4 (millimeters). */
  readonly units?: number;
}

export class ExportError extends Error {
  override readonly name = 'ExportError';
}

/**
 * Serialize a CrossSection to a minimal AutoCAD 2010 (AC1024) DXF file.
 * One LWPOLYLINE entity per polygon, closed, vertex order preserved.
 * Manifold's CCW-outer / CW-hole winding passes through unchanged.
 */
export function crossSectionToDxf(cs: CrossSection, opts: DxfOptions = {}): Uint8Array {
  const layer = opts.layer ?? '0';
  const units = opts.units ?? 4; // millimeters

  // Defensive scan for non-finite coordinates.
  for (let p = 0; p < cs.polygons.length; p++) {
    const polygon = cs.polygons[p]!;
    for (let v = 0; v < polygon.length; v++) {
      const [x, y] = polygon[v]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new ExportError(`non-finite coordinate at polygons[${p}][${v}]`);
      }
    }
  }

  const { minX, minY, maxX, maxY } = boundsOf(cs);

  const lines: string[] = [];
  const emit = (groupCode: number, value: string | number): void => {
    lines.push(String(groupCode), String(value));
  };

  // HEADER
  emit(0, 'SECTION');
  emit(2, 'HEADER');
  emit(9, '$ACADVER');
  emit(1, 'AC1024');
  emit(9, '$INSUNITS');
  emit(70, units);
  emit(9, '$EXTMIN');
  emit(10, fmtNum(minX));
  emit(20, fmtNum(minY));
  emit(30, '0.0');
  emit(9, '$EXTMAX');
  emit(10, fmtNum(maxX));
  emit(20, fmtNum(maxY));
  emit(30, '0.0');
  emit(0, 'ENDSEC');

  // TABLES (one layer)
  emit(0, 'SECTION');
  emit(2, 'TABLES');
  emit(0, 'TABLE');
  emit(2, 'LAYER');
  emit(70, 1);
  emit(0, 'LAYER');
  emit(2, layer);
  emit(70, 0);
  emit(62, 7); // color: white
  emit(6, 'CONTINUOUS');
  emit(0, 'ENDTAB');
  emit(0, 'ENDSEC');

  // ENTITIES
  emit(0, 'SECTION');
  emit(2, 'ENTITIES');
  for (const polygon of cs.polygons) {
    emit(0, 'LWPOLYLINE');
    emit(8, layer);
    emit(90, polygon.length);
    emit(70, 1); // 1 = closed
    for (const [x, y] of polygon) {
      emit(10, fmtNum(x));
      emit(20, fmtNum(y));
    }
  }
  emit(0, 'ENDSEC');

  emit(0, 'EOF');

  // DXF lines are CRLF-terminated by convention; \n also works in modern readers
  // but CRLF is what AutoCAD writes and what some older tools require.
  const text = lines.join('\r\n') + '\r\n';
  return new TextEncoder().encode(text);
}

function boundsOf(cs: CrossSection): { minX: number; minY: number; maxX: number; maxY: number } {
  if (cs.polygons.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of cs.polygons) {
    for (const [x, y] of polygon) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Format a number for DXF: avoid scientific notation, trim trailing zeros. */
function fmtNum(n: number): string {
  // toFixed(9) gives sub-nanometer precision in mm; trim trailing zeros.
  return n.toFixed(9).replace(/0+$/, '').replace(/\.$/, '.0');
}
```

- [ ] **Step 5: Run and verify pass**

Run: `pnpm vitest run packages/export-dxf/src/dxf.test.ts`
Expected: PASS (7 cases).

Run: `pnpm build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/export-dxf/ pnpm-lock.yaml
git commit -m "feat(export-dxf): crossSectionToDxf"
```

---

## Task 2: `@yacad/export-svg` package

**Files:**

- Create: `packages/export-svg/package.json`
- Create: `packages/export-svg/tsconfig.json`
- Create: `packages/export-svg/src/index.ts`
- Create: `packages/export-svg/src/svg.ts`
- Create: `packages/export-svg/src/svg.test.ts`

- [ ] **Step 1: Scaffold the package**

Create `packages/export-svg/package.json`:

```json
{
  "name": "@yacad/export-svg",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "clean": "tsc -b --clean"
  },
  "dependencies": {
    "@yacad/geometry": "workspace:*"
  },
  "devDependencies": {
    "@yacad/tsconfig": "workspace:*"
  }
}
```

Create `packages/export-svg/tsconfig.json`:

```json
{
  "extends": "../../tooling/tsconfig/base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"],
  "references": [{ "path": "../geometry" }]
}
```

Create `packages/export-svg/src/index.ts`:

```ts
export { crossSectionToSvg, ExportError } from './svg';
export type { SvgOptions } from './svg';
```

Run: `pnpm install`.

- [ ] **Step 2: Write the failing tests**

Create `packages/export-svg/src/svg.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CrossSection } from '@yacad/geometry';
import { crossSectionToSvg, ExportError } from './svg';

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

const emptyCs: CrossSection = { polygons: [] };
const squareCs: CrossSection = {
  polygons: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  ],
};
const squareWithHoleCs: CrossSection = {
  polygons: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    [
      [3, 3],
      [3, 7],
      [7, 7],
      [7, 3],
    ],
  ],
};

describe('crossSectionToSvg', () => {
  it('emits a valid SVG document for an empty CrossSection', () => {
    const svg = decode(crossSectionToSvg(emptyCs));
    expect(svg).toMatch(/^<\?xml[^>]*\?>/);
    expect(svg).toContain('<svg ');
    expect(svg).toContain('</svg>');
  });

  it('emits a single <path> with Y-flipped coordinates for a square', () => {
    const svg = decode(crossSectionToSvg(squareCs));
    expect(svg).toContain('<path');
    // Y-flipped: vertex [10, 10] should appear as "10 -10" in path data
    expect(svg).toContain('10 -10');
    // Path data uses M / L / Z
    expect(svg).toMatch(/d="M[^"]*L[^"]*Z"/);
  });

  it('concatenates multiple polygons into one <path> with fill-rule="evenodd"', () => {
    const svg = decode(crossSectionToSvg(squareWithHoleCs));
    const pathMatches = svg.match(/<path/g) ?? [];
    expect(pathMatches.length).toBe(1);
    expect(svg).toContain('fill-rule="evenodd"');
    // Two Z commands (one per polygon)
    const dAttr = svg.match(/d="([^"]+)"/)?.[1] ?? '';
    expect(dAttr.split('Z').length - 1).toBe(2);
  });

  it('autocomputes viewBox from bounds plus padding', () => {
    const svg = decode(crossSectionToSvg(squareCs, { padding: 5 }));
    // bbox (0,0)-(10,10), Y-flipped to (0,-10)-(10,0), padded by 5
    // viewBox = (-5, -15, 20, 20)
    expect(svg).toContain('viewBox="-5 -15 20 20"');
  });

  it('honors explicit width/height while keeping autocomputed viewBox', () => {
    const svg = decode(crossSectionToSvg(squareCs, { width: 400, height: 400 }));
    expect(svg).toContain('width="400"');
    expect(svg).toContain('height="400"');
    expect(svg).toContain('viewBox=');
  });

  it('emits a background rect when background is set', () => {
    const svg = decode(crossSectionToSvg(squareCs, { background: '#fff' }));
    expect(svg).toContain('<rect ');
    expect(svg).toContain('#fff');
  });

  it('omits the background rect when background is null (default)', () => {
    const svg = decode(crossSectionToSvg(squareCs));
    expect(svg).not.toContain('<rect ');
  });

  it('honors stroke / fill / strokeWidth options', () => {
    const svg = decode(
      crossSectionToSvg(squareCs, { stroke: '#f00', fill: '#0f0', strokeWidth: 2 }),
    );
    expect(svg).toContain('stroke="#f00"');
    expect(svg).toContain('fill="#0f0"');
    expect(svg).toContain('stroke-width="2"');
  });

  it('throws ExportError on non-finite coordinates', () => {
    const bad: CrossSection = {
      polygons: [
        [
          [0, 0],
          [NaN, 0],
          [1, 1],
        ],
      ],
    };
    expect(() => crossSectionToSvg(bad)).toThrow(ExportError);
  });

  it('is deterministic', () => {
    const a = crossSectionToSvg(squareCs);
    const b = crossSectionToSvg(squareCs);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 3: Verify failure**

Run: `pnpm vitest run packages/export-svg/src/svg.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `svg.ts`**

Create `packages/export-svg/src/svg.ts`:

```ts
import type { CrossSection } from '@yacad/geometry';

export interface SvgOptions {
  readonly width?: number;
  readonly height?: number;
  readonly padding?: number;
  readonly stroke?: string;
  readonly fill?: string;
  readonly strokeWidth?: number;
  readonly background?: string | null;
}

export class ExportError extends Error {
  override readonly name = 'ExportError';
}

const DEFAULT_PADDING = 10;
const DEFAULT_STROKE = '#000';
const DEFAULT_FILL = '#88aacc';
const DEFAULT_STROKE_WIDTH = 0.5;
const DEFAULT_MAX_PIXELS = 800;

/**
 * Serialize a CrossSection to an SVG document. Multiple polygons collapse into
 * one <path> element with fill-rule="evenodd" so Manifold's CW-hole convention
 * renders correctly. Y axis is flipped from CAD Y-up to SVG Y-down via a
 * negated viewBox.
 */
export function crossSectionToSvg(cs: CrossSection, opts: SvgOptions = {}): Uint8Array {
  const padding = opts.padding ?? DEFAULT_PADDING;
  const stroke = opts.stroke ?? DEFAULT_STROKE;
  const fill = opts.fill ?? DEFAULT_FILL;
  const strokeWidth = opts.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const background = opts.background ?? null;

  validateFinite(cs);

  const bounds = boundsOf(cs);
  // Y-flip: SVG y-axis points down, CAD up. Compute viewBox in flipped space.
  const vbX = bounds.minX - padding;
  const vbY = -bounds.maxY - padding;
  const vbW = bounds.maxX - bounds.minX + 2 * padding || 2 * padding;
  const vbH = bounds.maxY - bounds.minY + 2 * padding || 2 * padding;

  let width = opts.width;
  let height = opts.height;
  if (width === undefined && height === undefined) {
    const scale = DEFAULT_MAX_PIXELS / Math.max(vbW, vbH);
    width = Math.round(vbW * scale);
    height = Math.round(vbH * scale);
  } else if (width === undefined) {
    width = Math.round((height! / vbH) * vbW);
  } else if (height === undefined) {
    height = Math.round((width / vbW) * vbH);
  }

  const pathData = buildPathData(cs);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${width}" height="${height}">`,
  );
  if (background !== null) {
    lines.push(
      `  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${background}"/>`,
    );
  }
  if (pathData.length > 0) {
    lines.push(
      `  <path d="${pathData}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${strokeWidth}"/>`,
    );
  } else {
    lines.push(
      `  <path d="" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${strokeWidth}"/>`,
    );
  }
  lines.push('</svg>');

  return new TextEncoder().encode(lines.join('\n') + '\n');
}

function buildPathData(cs: CrossSection): string {
  const parts: string[] = [];
  for (const polygon of cs.polygons) {
    if (polygon.length === 0) continue;
    const [firstX, firstY] = polygon[0]!;
    parts.push(`M${fmt(firstX)} ${fmt(-firstY)}`);
    for (let i = 1; i < polygon.length; i++) {
      const [x, y] = polygon[i]!;
      parts.push(`L${fmt(x)} ${fmt(-y)}`);
    }
    parts.push('Z');
  }
  return parts.join(' ');
}

function fmt(n: number): string {
  // 4 decimals = sub-100μm precision at mm scale, plenty for vector graphics.
  return Number(n.toFixed(4)).toString();
}

function validateFinite(cs: CrossSection): void {
  for (let p = 0; p < cs.polygons.length; p++) {
    const polygon = cs.polygons[p]!;
    for (let v = 0; v < polygon.length; v++) {
      const [x, y] = polygon[v]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new ExportError(`non-finite coordinate at polygons[${p}][${v}]`);
      }
    }
  }
}

function boundsOf(cs: CrossSection): { minX: number; minY: number; maxX: number; maxY: number } {
  if (cs.polygons.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of cs.polygons) {
    for (const [x, y] of polygon) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}
```

- [ ] **Step 5: Verify pass**

Run: `pnpm vitest run packages/export-svg/src/svg.test.ts`
Expected: PASS (10 cases).

- [ ] **Step 6: Commit**

```bash
git add packages/export-svg/ pnpm-lock.yaml
git commit -m "feat(export-svg): crossSectionToSvg"
```

---

## Task 3: `@yacad/export-png` rasterizer core

**Files:**

- Create: `packages/export-png/package.json`
- Create: `packages/export-png/tsconfig.json`
- Create: `packages/export-png/src/index.ts`
- Create: `packages/export-png/src/render.ts`
- Create: `packages/export-png/src/render.test.ts`
- Create: `packages/export-png/src/errors.ts`

The PNG package splits into three TS modules: `render.ts` (env-agnostic rasterizer), `browser.ts` and `node.ts` (env-specific wrappers, added in Task 4). This task lands `render.ts` + tests.

- [ ] **Step 1: Scaffold the package**

Create `packages/export-png/package.json`:

```json
{
  "name": "@yacad/export-png",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "clean": "tsc -b --clean"
  },
  "dependencies": {
    "@yacad/geometry": "workspace:*"
  },
  "devDependencies": {
    "@napi-rs/canvas": "^0.1.50",
    "@yacad/tsconfig": "workspace:*"
  }
}
```

(Pin `@napi-rs/canvas` to the latest stable major; the exact patch is not load-bearing.)

Create `packages/export-png/tsconfig.json`:

```json
{
  "extends": "../../tooling/tsconfig/base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"],
  "references": [{ "path": "../geometry" }]
}
```

Create `packages/export-png/src/errors.ts`:

```ts
export class ExportError extends Error {
  override readonly name = 'ExportError';
}
```

Create `packages/export-png/src/index.ts` (will export more once Task 4 lands):

```ts
export { renderCrossSectionToContext } from './render';
export type { PngOptions } from './render';
export { ExportError } from './errors';
```

Run: `pnpm install`.

- [ ] **Step 2: Write the failing tests**

Create `packages/export-png/src/render.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CrossSection } from '@yacad/geometry';
import { renderCrossSectionToContext, type PngOptions } from './render';

interface Call {
  method: string;
  args: unknown[];
}

/** Minimal mock of CanvasRenderingContext2D — records every call. */
function mockContext() {
  const calls: Call[] = [];
  let fillStyle = '';
  let strokeStyle = '';
  let lineWidth = 0;

  const record = (method: string, args: unknown[]): void => {
    calls.push({ method, args });
  };

  const ctx = {
    get fillStyle(): string {
      return fillStyle;
    },
    set fillStyle(v: string) {
      fillStyle = v;
      record('set fillStyle', [v]);
    },
    get strokeStyle(): string {
      return strokeStyle;
    },
    set strokeStyle(v: string) {
      strokeStyle = v;
      record('set strokeStyle', [v]);
    },
    get lineWidth(): number {
      return lineWidth;
    },
    set lineWidth(v: number) {
      lineWidth = v;
      record('set lineWidth', [v]);
    },
    setTransform: (...a: unknown[]) => record('setTransform', a),
    resetTransform: () => record('resetTransform', []),
    fillRect: (...a: unknown[]) => record('fillRect', a),
    clearRect: (...a: unknown[]) => record('clearRect', a),
    beginPath: () => record('beginPath', []),
    closePath: () => record('closePath', []),
    moveTo: (...a: unknown[]) => record('moveTo', a),
    lineTo: (...a: unknown[]) => record('lineTo', a),
    fill: (...a: unknown[]) => record('fill', a),
    stroke: () => record('stroke', []),
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const emptyCs: CrossSection = { polygons: [] };
const squareCs: CrossSection = {
  polygons: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  ],
};

const baseOpts: PngOptions = { width: 100, height: 100 };

describe('renderCrossSectionToContext', () => {
  it('clears the canvas before drawing when no background', () => {
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(emptyCs, ctx, baseOpts);
    expect(calls.some((c) => c.method === 'clearRect')).toBe(true);
  });

  it('fills the canvas with the background color when provided', () => {
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(emptyCs, ctx, { ...baseOpts, background: '#fff' });
    const bgFill = calls.find((c) => c.method === 'fillRect');
    expect(bgFill).toBeDefined();
  });

  it('emits the expected draw sequence for a square (begin/move/line×3/close/fill/stroke)', () => {
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(squareCs, ctx, baseOpts);
    const methods = calls.map((c) => c.method);
    const drawSeq = methods.filter(
      (m) =>
        m === 'beginPath' ||
        m === 'moveTo' ||
        m === 'lineTo' ||
        m === 'closePath' ||
        m === 'fill' ||
        m === 'stroke',
    );
    expect(drawSeq).toEqual([
      'beginPath',
      'moveTo',
      'lineTo',
      'lineTo',
      'lineTo',
      'closePath',
      'fill',
      'stroke',
    ]);
  });

  it('calls setTransform once with the correct scale + Y-flip + translation for the square', () => {
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(squareCs, ctx, { ...baseOpts, padding: 10 });
    const set = calls.find((c) => c.method === 'setTransform');
    expect(set).toBeDefined();
    // Square is 10×10 in CAD; canvas is 100×100 with padding 10 → drawable 80×80
    // scaleX = 80 / 10 = 8; scaleY (with flip) = -8
    const [a, b, c, d, tx, ty] = set!.args as [number, number, number, number, number, number];
    expect(a).toBeCloseTo(8, 6);
    expect(b).toBeCloseTo(0, 6);
    expect(c).toBeCloseTo(0, 6);
    expect(d).toBeCloseTo(-8, 6);
    // Translation puts (minX, maxY) at (padding, padding) in canvas coords
    expect(tx).toBeCloseTo(10, 6);
    expect(ty).toBeCloseTo(90, 6);
  });

  it('uses fill rule evenodd', () => {
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(squareCs, ctx, baseOpts);
    const fillCall = calls.find((c) => c.method === 'fill');
    expect(fillCall?.args[0]).toBe('evenodd');
  });

  it('sets fillStyle and strokeStyle from options', () => {
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(squareCs, ctx, {
      ...baseOpts,
      fill: '#abc',
      stroke: '#def',
      strokeWidth: 1.5,
    });
    expect(calls.some((c) => c.method === 'set fillStyle' && c.args[0] === '#abc')).toBe(true);
    expect(calls.some((c) => c.method === 'set strokeStyle' && c.args[0] === '#def')).toBe(true);
    expect(calls.some((c) => c.method === 'set lineWidth')).toBe(true);
  });
});
```

- [ ] **Step 3: Verify failure**

Run: `pnpm vitest run packages/export-png/src/render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `render.ts`**

Create `packages/export-png/src/render.ts`:

```ts
import type { CrossSection } from '@yacad/geometry';
import { ExportError } from './errors';

export interface PngOptions {
  readonly width: number;
  readonly height: number;
  readonly padding?: number;
  readonly stroke?: string;
  readonly fill?: string;
  readonly strokeWidth?: number;
  readonly background?: string | null;
}

const DEFAULT_PADDING = 10;
const DEFAULT_STROKE = '#000';
const DEFAULT_FILL = '#88aacc';
const DEFAULT_STROKE_WIDTH = 0.5;

/**
 * Pure rasterizer: draws a CrossSection onto an existing 2D context. The
 * context can be a browser OffscreenCanvas's 2D context or @napi-rs/canvas's
 * equivalent — the API surface we use is well-supported in both.
 */
export function renderCrossSectionToContext(
  cs: CrossSection,
  ctx: CanvasRenderingContext2D,
  opts: PngOptions,
): void {
  const padding = opts.padding ?? DEFAULT_PADDING;
  const stroke = opts.stroke ?? DEFAULT_STROKE;
  const fill = opts.fill ?? DEFAULT_FILL;
  const strokeWidth = opts.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const background = opts.background ?? null;

  if (
    !Number.isInteger(opts.width) ||
    opts.width <= 0 ||
    !Number.isInteger(opts.height) ||
    opts.height <= 0
  ) {
    throw new ExportError('width and height must be positive integers');
  }

  validateFinite(cs);

  // Reset transform to identity for the background pass.
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (background !== null) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, opts.width, opts.height);
  } else {
    ctx.clearRect(0, 0, opts.width, opts.height);
  }

  if (cs.polygons.length === 0) {
    return;
  }

  const bounds = boundsOf(cs);
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  const drawableW = opts.width - 2 * padding;
  const drawableH = opts.height - 2 * padding;

  // Pick a uniform scale so the content fits the drawable area while
  // preserving aspect ratio.
  const scale = Math.min(
    contentW > 0 ? drawableW / contentW : Infinity,
    contentH > 0 ? drawableH / contentH : Infinity,
  );
  // Center the content in the drawable area.
  const offsetX = padding + (drawableW - contentW * scale) / 2;
  const offsetY = padding + (drawableH - contentH * scale) / 2;
  // Build affine transform: scale X, flip Y, translate to align (minX, maxY)
  // in CAD coords to (offsetX, offsetY) in canvas coords.
  // canvas_x = scale * cad_x + tx; canvas_y = -scale * cad_y + ty
  // At cad_x = minX: canvas_x = offsetX  → tx = offsetX - scale * minX
  // At cad_y = maxY: canvas_y = offsetY  → ty = offsetY + scale * maxY
  const tx = offsetX - scale * bounds.minX;
  const ty = offsetY + scale * bounds.maxY;
  ctx.setTransform(scale, 0, 0, -scale, tx, ty);

  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  // Stroke width is interpreted in transformed (CAD) units because we set
  // the transform before stroking. Authors specify width in their own units;
  // they can scale it appropriately if they want pixel-relative thickness.
  ctx.lineWidth = strokeWidth;

  ctx.beginPath();
  for (const polygon of cs.polygons) {
    if (polygon.length === 0) continue;
    const [firstX, firstY] = polygon[0]!;
    ctx.moveTo(firstX, firstY);
    for (let i = 1; i < polygon.length; i++) {
      const [x, y] = polygon[i]!;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fill('evenodd');
  ctx.stroke();
}

function validateFinite(cs: CrossSection): void {
  for (let p = 0; p < cs.polygons.length; p++) {
    const polygon = cs.polygons[p]!;
    for (let v = 0; v < polygon.length; v++) {
      const [x, y] = polygon[v]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new ExportError(`non-finite coordinate at polygons[${p}][${v}]`);
      }
    }
  }
}

function boundsOf(cs: CrossSection): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of cs.polygons) {
    for (const [x, y] of polygon) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}
```

- [ ] **Step 5: Verify pass**

Run: `pnpm vitest run packages/export-png/src/render.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 6: Commit**

```bash
git add packages/export-png/ pnpm-lock.yaml
git commit -m "feat(export-png): environment-agnostic rasterizer core"
```

---

## Task 4: `@yacad/export-png` browser + Node wrappers

**Files:**

- Create: `packages/export-png/src/browser.ts`
- Create: `packages/export-png/src/node.ts`
- Create: `packages/export-png/src/node.test.ts`
- Modify: `packages/export-png/src/index.ts`

- [ ] **Step 1: Write the failing Node-wrapper test**

Create `packages/export-png/src/node.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CrossSection } from '@yacad/geometry';
import { crossSectionToPngNode } from './node';
import { ExportError } from './errors';

const squareCs: CrossSection = {
  polygons: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  ],
};

describe('crossSectionToPngNode', () => {
  it('produces bytes starting with the PNG magic signature', () => {
    const bytes = crossSectionToPngNode(squareCs, { width: 100, height: 100 });
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
    expect(bytes[4]).toBe(0x0d);
    expect(bytes[5]).toBe(0x0a);
    expect(bytes[6]).toBe(0x1a);
    expect(bytes[7]).toBe(0x0a);
  });

  it('encodes width and height correctly in the IHDR chunk', () => {
    const bytes = crossSectionToPngNode(squareCs, { width: 100, height: 80 });
    // IHDR chunk starts at byte 16 (8 magic + 4 length + 4 type "IHDR")
    // Width is bytes 16..19, height is bytes 20..23 (big-endian uint32)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(16, false)).toBe(100);
    expect(view.getUint32(20, false)).toBe(80);
  });

  it('throws ExportError on zero width', () => {
    expect(() => crossSectionToPngNode(squareCs, { width: 0, height: 100 })).toThrow(ExportError);
  });

  it('throws ExportError on negative height', () => {
    expect(() => crossSectionToPngNode(squareCs, { width: 100, height: -1 })).toThrow(ExportError);
  });

  it('produces non-empty output for a non-empty cross-section', () => {
    const bytes = crossSectionToPngNode(squareCs, { width: 100, height: 100 });
    expect(bytes.length).toBeGreaterThan(100);
  });

  it('renders an empty cross-section without throwing (background-only image)', () => {
    const empty: CrossSection = { polygons: [] };
    const bytes = crossSectionToPngNode(empty, { width: 50, height: 50, background: '#fff' });
    expect(bytes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run packages/export-png/src/node.test.ts`
Expected: FAIL — module `./node` not found.

- [ ] **Step 3: Implement `node.ts`**

Create `packages/export-png/src/node.ts`:

```ts
import { createCanvas } from '@napi-rs/canvas';
import type { CrossSection } from '@yacad/geometry';
import { ExportError } from './errors';
import { renderCrossSectionToContext, type PngOptions } from './render';

/**
 * Node-side PNG export — uses @napi-rs/canvas for the canvas surface and
 * byte extraction. Intended for tests and CI; runtime in the studio uses
 * the browser wrapper.
 */
export function crossSectionToPngNode(cs: CrossSection, opts: PngOptions): Uint8Array {
  if (
    !Number.isInteger(opts.width) ||
    opts.width <= 0 ||
    !Number.isInteger(opts.height) ||
    opts.height <= 0
  ) {
    throw new ExportError('width and height must be positive integers');
  }
  const canvas = createCanvas(opts.width, opts.height);
  const ctx = canvas.getContext('2d');
  renderCrossSectionToContext(cs, ctx as unknown as CanvasRenderingContext2D, opts);
  const buffer = canvas.toBuffer('image/png');
  // Buffer is a Uint8Array subclass; return as Uint8Array for API uniformity.
  return new Uint8Array(buffer);
}
```

- [ ] **Step 4: Verify Node tests pass**

Run: `pnpm vitest run packages/export-png/src/node.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Implement `browser.ts`** (no unit test — covered by Task 6 Playwright)

Create `packages/export-png/src/browser.ts`:

```ts
import type { CrossSection } from '@yacad/geometry';
import { ExportError } from './errors';
import { renderCrossSectionToContext, type PngOptions } from './render';

/**
 * Browser-side PNG export — uses OffscreenCanvas for the canvas surface and
 * convertToBlob for byte extraction. Studio uses this at runtime.
 */
export async function crossSectionToPngBrowser(
  cs: CrossSection,
  opts: PngOptions,
): Promise<Uint8Array> {
  if (
    !Number.isInteger(opts.width) ||
    opts.width <= 0 ||
    !Number.isInteger(opts.height) ||
    opts.height <= 0
  ) {
    throw new ExportError('width and height must be positive integers');
  }
  const canvas = new OffscreenCanvas(opts.width, opts.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new ExportError('failed to acquire 2d context from OffscreenCanvas');
  }
  renderCrossSectionToContext(cs, ctx as unknown as CanvasRenderingContext2D, opts);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}
```

- [ ] **Step 6: Update `index.ts` to re-export everything**

Modify `packages/export-png/src/index.ts`:

```ts
export { renderCrossSectionToContext } from './render';
export type { PngOptions } from './render';
export { crossSectionToPngBrowser } from './browser';
export { crossSectionToPngNode } from './node';
export { ExportError } from './errors';
```

- [ ] **Step 7: Verify full package builds and tests**

Run: `pnpm --filter @yacad/export-png test`
Expected: PASS (12 total: 6 render + 6 node).

Run: `pnpm build`
Expected: clean. (`browser.ts` references `OffscreenCanvas` — verify the existing tsconfig DOM types are picked up; if not, add `"lib": ["ES2022", "DOM"]` to `tooling/tsconfig/base.json` — but it should already be there for the studio.)

- [ ] **Step 8: Commit**

```bash
git add packages/export-png/
git commit -m "feat(export-png): browser + Node wrappers"
```

---

## Task 5: Studio integration — three new export buttons

**Files:**

- Modify: `apps/studio/src/App.svelte`
- Modify: `apps/studio/package.json`
- Modify: `apps/studio/tsconfig.json`

- [ ] **Step 1: Add the three packages as studio dependencies**

In `apps/studio/package.json`, add to `dependencies`:

```json
"@yacad/export-dxf": "workspace:*",
"@yacad/export-svg": "workspace:*",
"@yacad/export-png": "workspace:*"
```

In `apps/studio/tsconfig.json`, add to `references`:

```json
{ "path": "../../packages/export-dxf" },
{ "path": "../../packages/export-svg" },
{ "path": "../../packages/export-png" }
```

(Match the existing reference-path format used for `@yacad/export-stl`.)

Run: `pnpm install`.

- [ ] **Step 2: Wire `lastCrossSection` reactive state**

Open `apps/studio/src/App.svelte`. Find the section near `lastMesh` declaration (search for `lastMesh`). It will look something like:

```ts
let lastMesh = $state<Mesh | undefined>(undefined);
```

Add immediately after:

```ts
let lastCrossSection = $state<CrossSection | undefined>(undefined);
```

Find the code that updates `lastMesh` after evaluation (it's inside the worker-result handler). It will look something like:

```ts
if (outcome.geometry.kind === '3d') {
  lastMesh = outcome.geometry.mesh;
  // ... render path
}
```

Update it to also handle 2D and track both:

```ts
if (outcome.geometry.kind === '3d') {
  lastMesh = outcome.geometry.mesh;
  lastCrossSection = undefined;
  // ... existing 3D render path
} else {
  lastCrossSection = outcome.geometry.section;
  lastMesh = undefined;
  // ... existing 2D render path
}
```

(Adapt to actual surrounding structure — the key change is keeping the two `$state` variables in sync with whichever kind the latest result is.)

Add the imports at the top of `<script>`:

```ts
import { crossSectionToDxf } from '@yacad/export-dxf';
import { crossSectionToSvg } from '@yacad/export-svg';
import { crossSectionToPngBrowser } from '@yacad/export-png';
import type { CrossSection } from '@yacad/geometry';
```

- [ ] **Step 3: Add export handler functions**

Find the existing `function exportStl()` (~line 689). Add immediately after it:

```ts
function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportDxf(): void {
  if (!lastCrossSection) return;
  downloadBytes(crossSectionToDxf(lastCrossSection), 'section.dxf', 'image/vnd.dxf');
}

function exportSvg(): void {
  if (!lastCrossSection) return;
  downloadBytes(crossSectionToSvg(lastCrossSection), 'section.svg', 'image/svg+xml');
}

async function exportPng(): Promise<void> {
  if (!lastCrossSection) return;
  const bytes = await crossSectionToPngBrowser(lastCrossSection, {
    width: 800,
    height: 800,
    background: '#fff',
  });
  downloadBytes(bytes, 'section.png', 'image/png');
}
```

Optionally, refactor the existing `exportStl()` to use the same `downloadBytes` helper (it currently duplicates the blob/anchor logic). Either way is acceptable; refactor in the same commit if you do.

- [ ] **Step 4: Add the three buttons**

Find the existing `<button onclick={exportStl} disabled={!lastMesh}>Export STL</button>` (~line 738). Replace that line with all four buttons:

```svelte
<button onclick={exportStl} disabled={!lastMesh}>Export STL</button>
<button onclick={exportDxf} disabled={!lastCrossSection}>Export DXF</button>
<button onclick={exportSvg} disabled={!lastCrossSection}>Export SVG</button>
<button onclick={exportPng} disabled={!lastCrossSection}>Export PNG</button>
```

- [ ] **Step 5: Verify studio builds**

Run: `pnpm --filter @yacad/studio build`
Expected: PASS.

Run: `pnpm --filter @yacad/studio check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/ pnpm-lock.yaml
git commit -m "feat(studio): export DXF/SVG/PNG buttons for 2D scenes"
```

---

## Task 6: Studio Playwright smoke for button state

**Files:**

- Modify: `apps/studio/e2e/studio.spec.ts`

- [ ] **Step 1: Write the smoke tests**

Append to `apps/studio/e2e/studio.spec.ts`:

```ts
test('export buttons gate by geometry kind: 2D scene enables DXF/SVG/PNG', async ({ page }) => {
  await page.goto('/');
  await page.locator('select[name="scene"]').selectOption('2d-circle');
  // Wait for evaluation
  await page.waitForSelector('canvas');
  // Give the studio a tick to update lastCrossSection
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: 'Export DXF' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export SVG' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export STL' })).toBeDisabled();
});

test('export buttons gate by geometry kind: 3D scene enables STL only', async ({ page }) => {
  await page.goto('/');
  await page.locator('select[name="scene"]').selectOption('box');
  await page.waitForSelector('canvas');
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: 'Export STL' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export DXF' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export SVG' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeDisabled();
});
```

(Adjust the scene-picker selector if Task 7 (Phase 2.5 was the prior phase that touched this) used a different attribute. The prior Playwright tests use `page.getByLabel('Sample scene')` — match whichever selector is currently in use.)

- [ ] **Step 2: Run Playwright**

Run: `pnpm --filter @yacad/studio test` (or whichever command runs Playwright — check the studio package.json scripts).
Expected: all tests pass, including the two new ones.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/e2e/
git commit -m "test(studio): Playwright smoke for DXF/SVG/PNG button gating"
```

---

## Task 7: Final acceptance + spec status

- [ ] **Step 1: Full sweep**

Run:

```bash
pnpm test
pnpm build
pnpm lint
pnpm format:check
```

All four expected green. Test count up by ~25 (7 DXF + 10 SVG + 6 render + 6 node) plus 2 Playwright tests.

- [ ] **Step 2: Mark spec as implemented**

Modify `docs/superpowers/specs/2026-05-28-2d-vector-exports-design.md`:

```diff
- **Status**: design approved, awaiting implementation plan
+ **Status**: implemented
```

- [ ] **Step 3: Update ROADMAP — move to shipped phases**

In `docs/ROADMAP.md`, find "## Shipped phases" at the top. Add a new entry:

```markdown
- **2D vector exports** — DXF/SVG/PNG export for any 2D-root scene. See [specs/2026-05-28-2d-vector-exports-design.md](superpowers/specs/2026-05-28-2d-vector-exports-design.md).
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-28-2d-vector-exports-design.md docs/ROADMAP.md
git commit -m "docs(2d-exports): mark spec implemented"
```

- [ ] **Step 5: Optional manual smoke**

Run `pnpm dev`, select "2d-circle" from the dropdown, click each of Export DXF / SVG / PNG. Each should trigger a browser download. Open the resulting files:

- DXF: opens cleanly in any DXF viewer (LibreCAD, QCAD, AutoCAD, online DXF viewers). Should show a circle.
- SVG: opens in a browser tab. Should show a circle on a light-blue fill with black outline.
- PNG: opens as an image. Should show a circle on a white background.

Repeat with "box" (3D scene): STL exports; the other three buttons are disabled.

---

## Wrap-up

By the end of this plan:

- **`@yacad/export-dxf`** ships `crossSectionToDxf` — AutoCAD-2010 DXF, one `LWPOLYLINE` per polygon, configurable layer/units. 7 unit tests.
- **`@yacad/export-svg`** ships `crossSectionToSvg` — single `<path>` with `fill-rule="evenodd"`, Y-flipped coordinate transform, autocomputed viewBox + pixel dimensions. 10 unit tests.
- **`@yacad/export-png`** ships `renderCrossSectionToContext` (rasterizer core) plus `crossSectionToPngBrowser` (OffscreenCanvas) and `crossSectionToPngNode` (`@napi-rs/canvas` devDep). 12 unit tests (6 mocked + 6 real Node canvas).
- **Studio** gains three new buttons next to Export STL, each enabled/disabled based on the current geometry's kind. `lastCrossSection` reactive state tracks 2D results parallel to `lastMesh`.
- **Playwright smoke** verifies button gating across 2D and 3D scenes.
- **Spec marked `implemented`**; ROADMAP entry added to "Shipped phases."

Out of scope (per spec — track in ROADMAP.md):

- 2D vector import (DXF in, SVG in).
- DWG support.
- Multi-layer DXF organization.
- SVG annotations (dimensions, scale bars).
- 3D mesh export beyond STL (sequenced after mesh-data-model evolution).
- 3MF (slicer-direction; print-bridge layer).
- File menu / save-as dialog.

If something resists clean implementation — especially Manifold's CrossSection winding convention conflicting with what DXF/SVG/Canvas expect — STOP and surface the tension. The exporters assume Manifold's CCW-outer / CW-hole convention passes through unchanged; the existing Phase 2 tests confirm that's the on-disk reality.
