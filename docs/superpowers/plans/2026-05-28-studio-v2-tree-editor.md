# Studio v2 Tree Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Spec 2 — `@yacad/selection`, `@yacad/mutations`, a `paramSchema` refactor in `@yacad/dag` (with `@yacad/lua` derived from it), and `apps/studio2` (Svelte 5 three-pane tree-editor + property-inspector app, first-run seeded from the v1 example library).

**Architecture:** Two new framework-agnostic packages on top of the spec-1 foundation, one schema refactor in `@yacad/dag`, and one new Svelte 5 app at `apps/studio2`. The studio v2 app consumes the foundation (`@yacad/vfs` + `@yacad/doc-store`) plus the new packages and reuses `@yacad/render` + `@yacad/worker` from v1. The existing `apps/studio` stays untouched as historical reference.

**Tech Stack:** TypeScript 5, pnpm workspaces, Svelte 5 (matching v1), Vite 6, Vitest + `fake-indexeddb` for unit tests, Playwright for e2e. `crypto.subtle` for hashing (already wired via `@yacad/hash`).

**Spec:** `docs/superpowers/specs/2026-05-28-studio-v2-tree-editor-design.md`

---

## File structure

```text
packages/dag/
  src/
    registry.ts              # MODIFY: add summary/outputDoc/paramSchema to KernelNodeType
    schema-docs.ts           # NEW: ParamDoc type + getKernelTypeDoc helper
    schema-docs.test.ts      # NEW: pin every kernel type has a paramSchema
packages/lua/
  src/
    geo-docs.ts              # REWRITE: thin reader joining @yacad/dag schemas + local Lua examples
    geo-docs.test.ts         # MODIFY: still passes after the rewrite
packages/selection/
  package.json
  tsconfig.json
  src/
    index.ts
    selection.ts             # Selection class
    selection.test.ts
packages/mutations/
  package.json
  tsconfig.json
  src/
    index.ts
    paths.ts                 # path traversal helpers (parsePath, getAt, replaceWithin)
    paths.test.ts
    set-param.ts
    set-param.test.ts
    structural.ts            # addChild, removeAt, replaceAt, moveChild, wrapWith
    structural.test.ts
apps/studio2/
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  src/
    main.ts
    worker.ts
    seed-scenes.ts
    App.svelte
    app.css
    state/
      session.svelte.ts
      selection.svelte.ts
    ui/
      DocPicker.svelte
      TreePane.svelte
      TreeNode.svelte
      ToolPalette.svelte
      ViewportPane.svelte
      InspectorPane.svelte
      inspectors/
        KernelInspector.svelte
        LuaInspector.svelte
        DecoderInspector.svelte
        InvalidatedInspector.svelte
      forms/
        NumberField.svelte
        IntField.svelte
        BoolField.svelte
        StringField.svelte
        EnumField.svelte
        Vec2Field.svelte
        Vec3Field.svelte
  e2e/
    studio2.spec.ts          # Playwright e2e
    playwright.config.ts
```

Root config changes:

- `tsconfig.json` — add references for `packages/selection` and `packages/mutations`.
- `vitest.config.ts` — add aliases for `@yacad/selection` and `@yacad/mutations`.
- `pnpm-workspace.yaml` — already globs `apps/*` and `packages/*` so no edit needed.

---

## Task 1: `@yacad/dag` — schema refactor

**Files:**
- Modify: `packages/dag/src/registry.ts`
- Create: `packages/dag/src/schema-docs.ts`
- Modify: `packages/dag/src/index.ts`
- Create: `packages/dag/src/schema-docs.test.ts`

- [ ] **Step 1: Write the failing test in `packages/dag/src/schema-docs.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { listNodeTypes, getKernelTypeDoc, getNodeType } from './index';

describe('kernel schema-docs', () => {
  it('getKernelTypeDoc returns summary/outputDoc/paramSchema for every kernel type', () => {
    const kernelTypes = listNodeTypes()
      .map((t) => t.type)
      .filter((t) => getNodeType(t)?.kind === 'kernel');

    expect(kernelTypes.length).toBeGreaterThan(0);
    for (const type of kernelTypes) {
      const doc = getKernelTypeDoc(type);
      expect(doc, `kernel type "${type}" has no docs`).toBeDefined();
      expect(doc!.summary.length).toBeGreaterThan(0);
      expect(doc!.outputDoc.length).toBeGreaterThan(0);
      expect(Array.isArray(doc!.paramSchema)).toBe(true);
    }
  });

  it('getKernelTypeDoc returns undefined for non-kernel types', () => {
    // 'lua' is expandable; 'import-stl' is a decoder. Neither has a kernel doc.
    expect(getKernelTypeDoc('lua')).toBeUndefined();
    expect(getKernelTypeDoc('not-a-real-type')).toBeUndefined();
  });

  it('a kernel doc with paramSchema entries has well-formed ParamDoc shape', () => {
    const box = getKernelTypeDoc('box');
    expect(box).toBeDefined();
    const size = box!.paramSchema.find((p) => p.name === 'size');
    expect(size).toBeDefined();
    expect(size!.type).toBe('vec3');
    expect(size!.required).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/dag/src/schema-docs`
Expected: FAIL — `getKernelTypeDoc` does not exist.

- [ ] **Step 3: Add `paramSchema` / `summary` / `outputDoc` fields to `KernelNodeType` and `ParamDoc` type**

In `packages/dag/src/schema-docs.ts`, create:

```typescript
/**
 * Per-parameter documentation used by the studio's property inspector and by
 * any other introspection tool (Lua API docs, future code completion).
 */
export interface ParamDoc {
  readonly name: string;
  readonly type: 'number' | 'int' | 'boolean' | 'string' | 'vec2' | 'vec3';
  readonly required: boolean;
  readonly default?: unknown;
  readonly doc: string;
  readonly min?: number;
  readonly max?: number;
  readonly enum?: readonly string[];
}

/** Kernel-node-type summary fields, surfaced via getKernelTypeDoc. */
export interface KernelTypeDocSummary {
  readonly summary: string;
  readonly outputDoc: string;
  readonly paramSchema: readonly ParamDoc[];
}
```

In `packages/dag/src/registry.ts`, modify the `KernelNodeType` interface to extend the summary fields:

```typescript
import type { KernelTypeDocSummary, ParamDoc } from './schema-docs';

export interface KernelNodeType extends KernelTypeDocSummary {
  readonly kind: 'kernel';
  readonly type: string;
  readonly output: GeometryType | ((children: readonly Node[]) => GeometryType);
  checkChildren(children: readonly Node[], path: string): void;
  normalizeParams(params: unknown, path: string): Record<string, unknown>;
}
```

Update every factory function in `registry.ts` (`primitive`, `primitive2d`, `transform`, `transform2d`, `bridge2dTo3d`, `refinement2d`, `refinement3d`, `overloaded`) to accept a `docs: KernelTypeDocSummary` argument and attach the three fields to the returned `KernelNodeType`. Example for `primitive`:

```typescript
function primitive(
  type: string,
  docs: KernelTypeDocSummary,
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '3d',
    summary: docs.summary,
    outputDoc: docs.outputDoc,
    paramSchema: docs.paramSchema,
    checkChildren(children, path) {
      if (children.length !== 0) {
        throw new DagError(`"${type}" takes no children`, path);
      }
    },
    normalizeParams,
  };
}
```

Apply the same shape to every other factory function (each gets a new `docs` second param threaded into the returned object).

- [ ] **Step 4: Migrate the schema data from `packages/lua/src/geo-docs.ts` into the registry calls**

`packages/lua/src/geo-docs.ts` currently has 19 entries in `KERNEL_TYPE_DOCS`. For each entry, port the `{ summary, outputDoc, params }` (renaming `params` → `paramSchema`) into the corresponding registry factory call as the `docs` argument. Leave `example` in `geo-docs.ts` — task 2 handles it.

Worked example for `box`:

In `packages/dag/src/registry.ts`, the existing line is:

```typescript
  primitive('box', (params, path) => {
    const p = asRecord(params, path);
    return { size: posVec3(p, 'size', path), center: optBool(p, 'center', path, false) };
  }),
```

Change to:

```typescript
  primitive(
    'box',
    {
      summary: 'A rectangular cuboid aligned to the world axes.',
      outputDoc: '3D mesh',
      paramSchema: [
        {
          name: 'size',
          type: 'vec3',
          required: true,
          doc: 'Positive [x, y, z] dimensions of the box.',
        },
        {
          name: 'center',
          type: 'boolean',
          required: false,
          default: false,
          doc: 'When true the box is centered on the origin; otherwise its corner is at the origin.',
        },
      ],
    },
    (params, path) => {
      const p = asRecord(params, path);
      return { size: posVec3(p, 'size', path), center: optBool(p, 'center', path, false) };
    },
  ),
```

Repeat for the other 18 entries currently in `geo-docs.ts`. Copy the `{ summary, outputDoc, params }` triples verbatim (rename `params` → `paramSchema`). Watch for two entries that use `overloaded(...)` and `refinement2d(...)` etc. — same `docs` argument shape applies to every factory.

- [ ] **Step 5: Add `getKernelTypeDoc` helper to `packages/dag/src/schema-docs.ts`**

Append to `schema-docs.ts`:

```typescript
import { getNodeType } from './registry';

/**
 * Returns the schema-summary documentation for a kernel-backed node type, or
 * `undefined` if `type` is not registered or is not a kernel node.
 */
export function getKernelTypeDoc(type: string): KernelTypeDocSummary | undefined {
  const def = getNodeType(type);
  if (!def || def.kind !== 'kernel') return undefined;
  return {
    summary: def.summary,
    outputDoc: def.outputDoc,
    paramSchema: def.paramSchema,
  };
}
```

- [ ] **Step 6: Export the new surface from `packages/dag/src/index.ts`**

Add to `packages/dag/src/index.ts`:

```typescript
export type { ParamDoc, KernelTypeDocSummary } from './schema-docs';
export { getKernelTypeDoc } from './schema-docs';
```

- [ ] **Step 7: Run the test — expect PASS**

Run: `pnpm vitest run packages/dag`
Expected: PASS — all existing dag tests still pass, plus the 3 new schema-docs tests.

- [ ] **Step 8: Build + lint + format the workspace**

Run: `pnpm build && pnpm lint && pnpm format:check`
Expected: all green. If prettier reports drift, `pnpm format` and re-check.

- [ ] **Step 9: Commit**

```bash
git add packages/dag/src
git commit -m "feat(dag): promote kernel paramSchema/summary/outputDoc to registry"
```

---

## Task 2: `@yacad/lua` — derive `KERNEL_TYPE_DOCS` from registry

**Files:**
- Modify: `packages/lua/src/geo-docs.ts`
- Modify: `packages/lua/src/geo-docs.test.ts`

- [ ] **Step 1: Inspect existing geo-docs.test.ts**

Run: `cat packages/lua/src/geo-docs.test.ts`
Note: the existing tests assert KERNEL_TYPE_DOCS covers every kernel type and has non-empty params. They should keep passing after the rewrite.

- [ ] **Step 2: Rewrite `packages/lua/src/geo-docs.ts` as a derived join**

The new file reads `summary` / `outputDoc` / `paramSchema` from `@yacad/dag`'s registry and pairs them with a local per-type Lua-example map. Resulting `KERNEL_TYPE_DOCS` export keeps the same TypeScript shape as before (so v1's studio keeps compiling).

Replace the entire file with:

```typescript
import {
  getKernelTypeDoc,
  getNodeType,
  listNodeTypes,
  type KernelTypeDocSummary,
  type ParamDoc,
} from '@yacad/dag';

/**
 * Per-type documentation descriptors for every kernel-backed node type.
 * The studio v1 Lua API docs panel is generated from this map. Spec 2 split
 * the documentation: type-system-level docs (summary/outputDoc/paramSchema)
 * live in @yacad/dag's registry; the Lua-specific source-snippet `example`
 * stays here as a per-type map. KERNEL_TYPE_DOCS is the join.
 *
 * Re-exported types and the export shape are preserved for backwards
 * compatibility with v1's Lua-docs panel and any external readers.
 */

export type { ParamDoc };

export interface KernelTypeDoc extends KernelTypeDocSummary {
  readonly type: string;
  readonly example: string;
}

/**
 * Lua source examples per kernel type. Adding a new kernel type requires both
 * a registry entry (in @yacad/dag) AND an example here.
 */
const EXAMPLES: Record<string, string> = {
  box: 'return geo.box({ size = {20, 20, 20}, center = true })',
  sphere: 'return geo.sphere({ radius = 10, segments = 48 })',
  cylinder: 'return geo.cylinder({ height = 30, radius = 8, segments = 64, center = true })',
  translate: 'return geo.translate({ offset = {15, 0, 0} }, { geo.box({ size = {10, 10, 10} }) })',
  rotate: 'return geo.rotate({ angles = {0, 90, 0} }, { geo.cylinder({ height = 30, radius = 6 }) })',
  union: 'return geo.union({}, { geo.box({ size = {10, 10, 10} }), geo.sphere({ radius = 6 }) })',
  difference: 'return geo.difference({}, { geo.box({ size = {30, 30, 30}, center = true }), geo.sphere({ radius = 19 }) })',
  intersection: 'return geo.intersection({}, { geo.box({ size = {10, 10, 10}, center = true }), geo.sphere({ radius = 6 }) })',
  hull: 'return geo.hull({}, { geo.circle({ radius = 1 }), geo.translate_2d({ offset = {10, 0} }, { geo.circle({ radius = 1 }) }) })',
  circle: 'return geo.circle({ radius = 5, segments = 48 })',
  rectangle: 'return geo.rectangle({ size = {10, 20}, center = true })',
  polygon: 'return geo.polygon({ points = { {0,0}, {10,0}, {5,10} } })',
  spline: 'return geo.spline({ points = { {10,0}, {3,3}, {0,10}, {-3,3}, {-10,0}, {-3,-3}, {0,-10}, {3,-3} } })',
  extrude: 'return geo.extrude({ height = 10 }, { geo.circle({ radius = 5 }) })',
  revolve: 'return geo.revolve({ axis = "y" }, { geo.polygon({ points = { {3,0}, {4,5}, {0,5} } }) })',
  translate_2d: 'return geo.translate_2d({ offset = {5, 0} }, { geo.circle({ radius = 1 }) })',
  rotate_2d: 'return geo.rotate_2d({ angle = 45 }, { geo.rectangle({ size = {2, 1} }) })',
  refine: 'return geo.refine({ n = 2 }, { geo.box({ size = {1, 1, 1} }) })',
  offset_2d: 'return geo.offset_2d({ delta = 2, joinType = "round" }, { geo.rectangle({ size = {10, 10}, center = true }) })',
};

/**
 * Build the derived KERNEL_TYPE_DOCS array by joining the registry's
 * type-system-level docs with the local example map. Filters to kernel-kind
 * node types only.
 */
function buildKernelTypeDocs(): readonly KernelTypeDoc[] {
  const docs: KernelTypeDoc[] = [];
  for (const meta of listNodeTypes()) {
    const def = getNodeType(meta.type);
    if (!def || def.kind !== 'kernel') continue;
    const summary = getKernelTypeDoc(meta.type);
    if (!summary) continue;
    const example = EXAMPLES[meta.type] ?? '';
    docs.push({
      type: meta.type,
      summary: summary.summary,
      outputDoc: summary.outputDoc,
      paramSchema: summary.paramSchema,
      example,
    });
  }
  return docs;
}

export const KERNEL_TYPE_DOCS: readonly KernelTypeDoc[] = buildKernelTypeDocs();
```

- [ ] **Step 3: Update the existing test in `packages/lua/src/geo-docs.test.ts` to match the new shape**

The existing test file references `params` on `KernelTypeDoc`. Since the new shape uses `paramSchema` (inherited via `KernelTypeDocSummary`), update field references accordingly. Read the file first, then update the assertions to use `paramSchema` instead of `params`. Add a new assertion that every kernel type has a non-empty `example` string:

```typescript
it('every kernel type has a Lua example', () => {
  for (const doc of KERNEL_TYPE_DOCS) {
    expect(doc.example.length, `kernel type "${doc.type}" has no example`).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 4: Run the lua tests**

Run: `pnpm vitest run packages/lua`
Expected: PASS. If a test still references `.params`, replace with `.paramSchema`.

- [ ] **Step 5: Build + lint + format**

Run: `pnpm build && pnpm lint && pnpm format:check`
Expected: all green.

- [ ] **Step 6: Verify studio v1's Lua API panel still type-checks**

Run: `pnpm --filter @yacad/studio check`
Expected: 0 errors. (V1's `App.svelte` reads `KERNEL_TYPE_DOCS`; the shape now uses `paramSchema` instead of `params` — if v1 reads `.params`, update the reference there too. Adjust v1 if needed.)

If v1 needs updates, include them in this commit.

- [ ] **Step 7: Commit**

```bash
git add packages/lua/src packages/dag/src apps/studio/src
git commit -m "refactor(lua): derive KERNEL_TYPE_DOCS from registry; rename params → paramSchema"
```

---

## Task 3: `@yacad/selection` — scaffold the package

**Files:**
- Create: `packages/selection/package.json`
- Create: `packages/selection/tsconfig.json`
- Modify: `tsconfig.json` (root, add reference)
- Modify: `vitest.config.ts` (add alias)

- [ ] **Step 1: Create the package.json**

Write `packages/selection/package.json`:

```json
{
  "name": "@yacad/selection",
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
  "dependencies": {},
  "devDependencies": {
    "@yacad/tsconfig": "workspace:*"
  }
}
```

- [ ] **Step 2: Create the tsconfig.json**

Write `packages/selection/tsconfig.json`:

```json
{
  "extends": "../../tooling/tsconfig/base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"],
  "references": []
}
```

- [ ] **Step 3: Add to root tsconfig**

In workspace-root `tsconfig.json`, append to the `references` array: `{ "path": "packages/selection" }`. Place after the existing `packages/doc-store` entry.

- [ ] **Step 4: Add vitest alias**

In `vitest.config.ts`, inside `resolve.alias`, add:

```typescript
      '@yacad/selection': pkg('selection'),
```

Place near other `@yacad/*` aliases, alphabetically with the existing entries.

- [ ] **Step 5: Create the placeholder `packages/selection/src/index.ts`**

```typescript
export {};
```

- [ ] **Step 6: Install + verify build**

Run: `pnpm install && pnpm --filter @yacad/selection build`
Expected: install + build succeed.

- [ ] **Step 7: Commit**

```bash
git add packages/selection tsconfig.json vitest.config.ts pnpm-lock.yaml
git commit -m "feat(selection): scaffold @yacad/selection package"
```

---

## Task 4: `@yacad/selection` — Selection class + tests

**Files:**
- Create: `packages/selection/src/selection.ts`
- Create: `packages/selection/src/selection.test.ts`
- Modify: `packages/selection/src/index.ts`

- [ ] **Step 1: Write the failing test in `packages/selection/src/selection.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { Selection } from './selection';

describe('Selection', () => {
  it('starts with no selection', () => {
    const sel = new Selection();
    expect(sel.selectedId).toBeNull();
    expect(sel.isSelected('$')).toBe(false);
  });

  it('select() sets the selected id and emits to subscribers', () => {
    const sel = new Selection();
    const events: (string | null)[] = [];
    sel.subscribe((id) => events.push(id));

    sel.select('$/0');

    expect(sel.selectedId).toBe('$/0');
    expect(sel.isSelected('$/0')).toBe(true);
    expect(sel.isSelected('$')).toBe(false);
    expect(events).toEqual(['$/0']);
  });

  it('selecting the same id again is a no-op (no event)', () => {
    const sel = new Selection();
    sel.select('$/0');
    const events: (string | null)[] = [];
    sel.subscribe((id) => events.push(id));

    sel.select('$/0');

    expect(events).toEqual([]);
  });

  it('clear() resets to null and emits null', () => {
    const sel = new Selection();
    sel.select('$/0');
    const events: (string | null)[] = [];
    sel.subscribe((id) => events.push(id));

    sel.clear();

    expect(sel.selectedId).toBeNull();
    expect(events).toEqual([null]);
  });

  it('subscribe returns a working unsubscribe function', () => {
    const sel = new Selection();
    const events: (string | null)[] = [];
    const unsubscribe = sel.subscribe((id) => events.push(id));
    unsubscribe();
    sel.select('$/0');
    expect(events).toEqual([]);
  });

  it('subscribers added during dispatch do not see the in-flight event', () => {
    const sel = new Selection();
    const received: string[] = [];
    sel.subscribe(() => {
      sel.subscribe(() => received.push('LATE'));
    });

    sel.select('$/0');

    expect(received).toEqual([]);
    // The late subscriber sees subsequent events, not the in-flight one.
    sel.select('$/1');
    expect(received).toEqual(['LATE']);
  });

  it('a throwing subscriber does not block other subscribers', () => {
    const sel = new Selection();
    const received: string[] = [];
    sel.subscribe(() => {
      throw new Error('subscriber A boom');
    });
    sel.subscribe(() => received.push('B'));

    const origErr = console.error;
    console.error = () => {};
    try {
      sel.select('$/0');
    } finally {
      console.error = origErr;
    }

    expect(received).toEqual(['B']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/selection`
Expected: FAIL — `Cannot find module './selection'`.

- [ ] **Step 3: Implement `packages/selection/src/selection.ts`**

```typescript
/**
 * Single-node selection state with subscribers. The studio v2 tree editor
 * and spec-3's WYSIWYG both consume this. Multi-select is a non-breaking
 * future extension via additive `selectedIds` + `selectAdd`/`selectRemove`.
 *
 * Subscriber dispatch is hardened in the same way as `@yacad/doc-store`'s
 * session: snapshot subscribers before iteration so unsubscribes/subscribes
 * during dispatch don't affect the current emit, and swallow + log throws
 * from one subscriber so they don't abort delivery to the rest.
 */
export class Selection {
  private current: string | null = null;
  private readonly subscribers = new Set<(id: string | null) => void>();

  /** Currently-selected node id, or null. */
  get selectedId(): string | null {
    return this.current;
  }

  /** Replace the current selection. Emits to subscribers iff changed. */
  select(id: string | null): void {
    if (id === this.current) return;
    this.current = id;
    this.emit(id);
  }

  /** Convenience for select(null). */
  clear(): void {
    this.select(null);
  }

  /** Returns true iff `id` is currently selected. */
  isSelected(id: string): boolean {
    return this.current === id;
  }

  /** Subscribe to selection changes; returns unsubscribe. */
  subscribe(cb: (selectedId: string | null) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private emit(id: string | null): void {
    // Snapshot subscribers so subscribe/unsubscribe during dispatch doesn't
    // affect the current emit (mirrors doc-store's hardening).
    for (const cb of [...this.subscribers]) {
      try {
        cb(id);
      } catch (err) {
        console.error('Selection subscriber threw:', err);
      }
    }
  }
}
```

- [ ] **Step 4: Update `packages/selection/src/index.ts`**

Replace the placeholder with:

```typescript
export { Selection } from './selection';
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run packages/selection`
Expected: PASS — 7 tests.

- [ ] **Step 6: Build + lint + format**

Run: `pnpm --filter @yacad/selection build && pnpm lint && pnpm format:check`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/selection/src
git commit -m "feat(selection): Selection class with subscriber dispatch"
```

---

## Task 5: `@yacad/mutations` — scaffold + path helpers

**Files:**
- Create: `packages/mutations/package.json`
- Create: `packages/mutations/tsconfig.json`
- Modify: `tsconfig.json` (root)
- Modify: `vitest.config.ts`
- Create: `packages/mutations/src/index.ts`
- Create: `packages/mutations/src/paths.ts`
- Create: `packages/mutations/src/paths.test.ts`

- [ ] **Step 1: Create package.json + tsconfig.json**

`packages/mutations/package.json`:

```json
{
  "name": "@yacad/mutations",
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
    "@yacad/dag": "workspace:*"
  },
  "devDependencies": {
    "@yacad/tsconfig": "workspace:*"
  }
}
```

`packages/mutations/tsconfig.json`:

```json
{
  "extends": "../../tooling/tsconfig/base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"],
  "references": [{ "path": "../dag" }]
}
```

- [ ] **Step 2: Add to root tsconfig + vitest aliases**

Append `{ "path": "packages/mutations" }` to the root `tsconfig.json` references. Add `'@yacad/mutations': pkg('mutations')` to `vitest.config.ts` aliases.

- [ ] **Step 3: Placeholder `packages/mutations/src/index.ts`**

```typescript
export {};
```

- [ ] **Step 4: Install + verify the empty package builds**

Run: `pnpm install && pnpm --filter @yacad/mutations build`
Expected: success.

- [ ] **Step 5: Write the failing test in `packages/mutations/src/paths.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import type { NodeDoc } from '@yacad/dag';
import { getAt, parsePath, replaceWithin } from './paths';

const tree: NodeDoc = {
  type: 'union',
  children: [
    { type: 'box', params: { size: [10, 10, 10] } },
    {
      type: 'translate',
      params: { offset: [5, 0, 0] },
      children: [{ type: 'sphere', params: { radius: 3 } }],
    },
  ],
};

describe('paths', () => {
  it('parsePath splits `$` into []', () => {
    expect(parsePath('$')).toEqual([]);
  });

  it('parsePath splits `$/0/1` into [0, 1]', () => {
    expect(parsePath('$/0/1')).toEqual([0, 1]);
  });

  it('parsePath rejects malformed paths', () => {
    expect(() => parsePath('')).toThrow();
    expect(() => parsePath('/0')).toThrow();
    expect(() => parsePath('$/x')).toThrow();
    expect(() => parsePath('$/-1')).toThrow();
  });

  it('getAt returns the root for `$`', () => {
    expect(getAt(tree, '$')).toBe(tree);
  });

  it('getAt returns a leaf by path', () => {
    expect(getAt(tree, '$/1/0')).toMatchObject({ type: 'sphere' });
  });

  it('getAt throws for an out-of-range index', () => {
    expect(() => getAt(tree, '$/5')).toThrow();
  });

  it('replaceWithin replaces the node at the given path and returns a new tree', () => {
    const next = replaceWithin(tree, '$/1/0', {
      type: 'cylinder',
      params: { height: 5, radius: 1 },
    });
    expect((next.children![1].children![0] as NodeDoc).type).toBe('cylinder');
    // Original tree is untouched (immutability).
    expect((tree.children![1].children![0] as NodeDoc).type).toBe('sphere');
  });

  it('replaceWithin can replace the root', () => {
    const next = replaceWithin(tree, '$', { type: 'box', params: {} });
    expect(next.type).toBe('box');
  });
});
```

- [ ] **Step 6: Run test — expect failure**

Run: `pnpm vitest run packages/mutations/src/paths`
Expected: FAIL — module missing.

- [ ] **Step 7: Implement `packages/mutations/src/paths.ts`**

```typescript
import type { NodeDoc } from '@yacad/dag';

/**
 * Path utilities for navigating a NodeDoc tree by the same string ids the
 * engine uses (`$` for root, `$/0` for first child, `$/0/1` for nested).
 * Operations return new trees — never mutate in place.
 */

/** Parse a path string into an array of child indices. `$` → []. */
export function parsePath(path: string): readonly number[] {
  if (path === '$') return [];
  if (!path.startsWith('$/')) {
    throw new Error(`invalid path "${path}": must start with "$" or "$/"`);
  }
  const parts = path.slice(2).split('/');
  const indices: number[] = [];
  for (const part of parts) {
    if (!/^[0-9]+$/.test(part)) {
      throw new Error(`invalid path "${path}": segment "${part}" must be a non-negative integer`);
    }
    indices.push(parseInt(part, 10));
  }
  return indices;
}

/** Return the node at `path`, throwing if any step is out of range. */
export function getAt(doc: NodeDoc, path: string): NodeDoc {
  let current: NodeDoc = doc;
  for (const idx of parsePath(path)) {
    const children = current.children ?? [];
    const next = children[idx];
    if (!next) {
      throw new Error(`path "${path}" out of range at index ${idx}`);
    }
    current = next;
  }
  return current;
}

/**
 * Return a new tree where the node at `path` is replaced by `replacement`.
 * `$` replaces the entire tree. Ancestors are reconstructed shallowly along
 * the path; siblings are reused by reference (structural sharing).
 */
export function replaceWithin(doc: NodeDoc, path: string, replacement: NodeDoc): NodeDoc {
  const indices = parsePath(path);
  if (indices.length === 0) return replacement;
  return rebuild(doc, indices, 0, replacement);
}

function rebuild(node: NodeDoc, indices: readonly number[], depth: number, replacement: NodeDoc): NodeDoc {
  const idx = indices[depth]!;
  const children = node.children ?? [];
  if (idx >= children.length) {
    throw new Error(`path out of range at depth ${depth}: index ${idx}, children ${children.length}`);
  }
  const child = children[idx]!;
  const newChild = depth === indices.length - 1 ? replacement : rebuild(child, indices, depth + 1, replacement);
  const newChildren = children.slice();
  newChildren[idx] = newChild;
  return { ...node, children: newChildren };
}
```

- [ ] **Step 8: Run test — expect PASS**

Run: `pnpm vitest run packages/mutations/src/paths`
Expected: PASS — 8 tests.

- [ ] **Step 9: Commit**

```bash
git add packages/mutations tsconfig.json vitest.config.ts pnpm-lock.yaml
git commit -m "feat(mutations): scaffold @yacad/mutations + path helpers"
```

---

## Task 6: `@yacad/mutations` — `setParam`

**Files:**
- Create: `packages/mutations/src/set-param.ts`
- Create: `packages/mutations/src/set-param.test.ts`
- Modify: `packages/mutations/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import type { NodeDoc } from '@yacad/dag';
import { setParam } from './set-param';

const tree: NodeDoc = {
  type: 'difference',
  children: [
    { type: 'box', params: { size: [30, 30, 30], center: true } },
    { type: 'sphere', params: { radius: 19, segments: 48 } },
  ],
};

describe('setParam', () => {
  it('returns a new tree with the specified param updated', () => {
    const next = setParam(tree, '$/1', 'radius', 25);
    expect((next.children![1] as NodeDoc).params).toMatchObject({ radius: 25, segments: 48 });
  });

  it('does not mutate the original tree', () => {
    setParam(tree, '$/1', 'radius', 25);
    expect((tree.children![1] as NodeDoc).params).toMatchObject({ radius: 19 });
  });

  it('updates a root-level param when path is `$`', () => {
    const next = setParam({ type: 'box', params: { size: [1, 1, 1] } }, '$', 'size', [2, 2, 2]);
    expect(next.params).toMatchObject({ size: [2, 2, 2] });
  });

  it('adds a new param key if missing', () => {
    const next = setParam(tree, '$/0', 'newKey', 'newValue');
    expect((next.children![0] as NodeDoc).params).toMatchObject({ newKey: 'newValue' });
  });

  it('throws when the path is invalid', () => {
    expect(() => setParam(tree, '$/9', 'x', 1)).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run packages/mutations/src/set-param`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `packages/mutations/src/set-param.ts`**

```typescript
import type { NodeDoc } from '@yacad/dag';
import { getAt, replaceWithin } from './paths';

/**
 * Returns a new tree where the node at `path` has `params[key] = value`.
 * Other params on the node are preserved. The original tree is not mutated.
 */
export function setParam(
  doc: NodeDoc,
  path: string,
  key: string,
  value: unknown,
): NodeDoc {
  const target = getAt(doc, path);
  const newParams = { ...(target.params ?? {}), [key]: value };
  const newNode: NodeDoc = { ...target, params: newParams };
  return replaceWithin(doc, path, newNode);
}
```

- [ ] **Step 4: Update `packages/mutations/src/index.ts`**

Replace the placeholder with:

```typescript
export { parsePath, getAt, replaceWithin } from './paths';
export { setParam } from './set-param';
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm vitest run packages/mutations`
Expected: PASS — 13 tests total (8 paths + 5 setParam).

- [ ] **Step 6: Commit**

```bash
git add packages/mutations/src
git commit -m "feat(mutations): setParam primitive"
```

---

## Task 7: `@yacad/mutations` — structural primitives

**Files:**
- Create: `packages/mutations/src/structural.ts`
- Create: `packages/mutations/src/structural.test.ts`
- Modify: `packages/mutations/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import type { NodeDoc } from '@yacad/dag';
import { addChild, moveChild, removeAt, replaceAt, wrapWith } from './structural';

const tree: NodeDoc = {
  type: 'union',
  children: [
    { type: 'box', params: { size: [10, 10, 10] } },
    { type: 'sphere', params: { radius: 5 } },
  ],
};

describe('addChild', () => {
  it('appends a child when index is omitted', () => {
    const next = addChild(tree, '$', { type: 'cylinder', params: { height: 5, radius: 1 } });
    expect(next.children).toHaveLength(3);
    expect((next.children![2] as NodeDoc).type).toBe('cylinder');
  });

  it('inserts a child at the given index', () => {
    const next = addChild(tree, '$', { type: 'cylinder', params: { height: 5, radius: 1 } }, 0);
    expect((next.children![0] as NodeDoc).type).toBe('cylinder');
    expect((next.children![1] as NodeDoc).type).toBe('box');
  });

  it('throws on out-of-range index', () => {
    expect(() => addChild(tree, '$', { type: 'box', params: {} }, 99)).toThrow();
  });
});

describe('removeAt', () => {
  it('removes the node at the given path', () => {
    const next = removeAt(tree, '$/0');
    expect(next.children).toHaveLength(1);
    expect((next.children![0] as NodeDoc).type).toBe('sphere');
  });

  it('throws when removing the root', () => {
    expect(() => removeAt(tree, '$')).toThrow(/cannot remove root/i);
  });
});

describe('replaceAt', () => {
  it('replaces the node at the given path', () => {
    const next = replaceAt(tree, '$/0', { type: 'cylinder', params: { height: 5, radius: 1 } });
    expect((next.children![0] as NodeDoc).type).toBe('cylinder');
  });

  it('replaces the root when path is `$`', () => {
    const next = replaceAt(tree, '$', { type: 'box', params: {} });
    expect(next.type).toBe('box');
  });
});

describe('wrapWith', () => {
  it('wraps the node at the given path in a new parent', () => {
    const next = wrapWith(tree, '$/0', 'translate', { offset: [5, 0, 0] });
    const wrapped = next.children![0] as NodeDoc;
    expect(wrapped.type).toBe('translate');
    expect(wrapped.params).toMatchObject({ offset: [5, 0, 0] });
    expect((wrapped.children![0] as NodeDoc).type).toBe('box');
  });

  it('wraps the root', () => {
    const next = wrapWith(tree, '$', 'translate', { offset: [0, 0, 0] });
    expect(next.type).toBe('translate');
    expect((next.children![0] as NodeDoc).type).toBe('union');
  });
});

describe('moveChild', () => {
  it('moves a child to a different position within the same parent', () => {
    const next = moveChild(tree, '$/0', '$/1');
    expect((next.children![0] as NodeDoc).type).toBe('sphere');
    expect((next.children![1] as NodeDoc).type).toBe('box');
  });

  it('throws when source and destination share the same path', () => {
    expect(() => moveChild(tree, '$/0', '$/0')).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run packages/mutations/src/structural`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `packages/mutations/src/structural.ts`**

```typescript
import type { NodeDoc } from '@yacad/dag';
import { getAt, parsePath, replaceWithin } from './paths';

export function addChild(
  doc: NodeDoc,
  parentPath: string,
  child: NodeDoc,
  index?: number,
): NodeDoc {
  const parent = getAt(doc, parentPath);
  const children = parent.children ?? [];
  const insertAt = index ?? children.length;
  if (insertAt < 0 || insertAt > children.length) {
    throw new Error(`addChild index ${insertAt} out of range (parent has ${children.length} children)`);
  }
  const newChildren = [...children.slice(0, insertAt), child, ...children.slice(insertAt)];
  return replaceWithin(doc, parentPath, { ...parent, children: newChildren });
}

export function removeAt(doc: NodeDoc, path: string): NodeDoc {
  const indices = parsePath(path);
  if (indices.length === 0) {
    throw new Error('cannot remove root node');
  }
  const parentIndices = indices.slice(0, -1);
  const childIndex = indices[indices.length - 1]!;
  const parentPath = parentIndices.length === 0 ? '$' : '$/' + parentIndices.join('/');
  const parent = getAt(doc, parentPath);
  const children = parent.children ?? [];
  if (childIndex < 0 || childIndex >= children.length) {
    throw new Error(`removeAt index ${childIndex} out of range`);
  }
  const newChildren = [...children.slice(0, childIndex), ...children.slice(childIndex + 1)];
  return replaceWithin(doc, parentPath, { ...parent, children: newChildren });
}

export function replaceAt(doc: NodeDoc, path: string, replacement: NodeDoc): NodeDoc {
  return replaceWithin(doc, path, replacement);
}

export function wrapWith(
  doc: NodeDoc,
  path: string,
  wrapperType: string,
  wrapperParams: Record<string, unknown> = {},
): NodeDoc {
  const target = getAt(doc, path);
  const wrapped: NodeDoc = {
    type: wrapperType,
    params: wrapperParams,
    children: [target],
  };
  return replaceWithin(doc, path, wrapped);
}

export function moveChild(doc: NodeDoc, fromPath: string, toPath: string): NodeDoc {
  if (fromPath === toPath) {
    throw new Error('moveChild source and destination are the same');
  }
  const node = getAt(doc, fromPath);
  const removed = removeAt(doc, fromPath);
  // Reinsert at the destination as a sibling. Interpret `toPath` as the
  // target index *within its parent* — find the parent and child index, then
  // insert there.
  const toIndices = parsePath(toPath);
  if (toIndices.length === 0) {
    throw new Error('moveChild destination cannot be the root');
  }
  const destParentIndices = toIndices.slice(0, -1);
  const destChildIndex = toIndices[toIndices.length - 1]!;
  const destParentPath = destParentIndices.length === 0 ? '$' : '$/' + destParentIndices.join('/');
  return addChild(removed, destParentPath, node, destChildIndex);
}
```

- [ ] **Step 4: Update `packages/mutations/src/index.ts`**

```typescript
export { parsePath, getAt, replaceWithin } from './paths';
export { setParam } from './set-param';
export { addChild, moveChild, removeAt, replaceAt, wrapWith } from './structural';
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm vitest run packages/mutations`
Expected: PASS — 13 + 10 = 23 tests total.

- [ ] **Step 6: Build + lint + format**

Run: `pnpm --filter @yacad/mutations build && pnpm lint && pnpm format:check`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/mutations/src
git commit -m "feat(mutations): addChild, removeAt, replaceAt, wrapWith, moveChild"
```

---

## Task 8: `apps/studio2` — scaffold app

**Files:**
- Create: `apps/studio2/package.json`
- Create: `apps/studio2/vite.config.ts`
- Create: `apps/studio2/tsconfig.json`
- Create: `apps/studio2/index.html`
- Create: `apps/studio2/src/main.ts`
- Create: `apps/studio2/src/App.svelte`
- Create: `apps/studio2/src/app.css`
- Modify: `package.json` (root, add `dev:v2` and `build:v2` scripts)

- [ ] **Step 1: Create `apps/studio2/package.json`**

Copy `apps/studio/package.json` as a starting template, then update the `name` field to `@yacad/studio2`. Add the new package dependencies:

```json
{
  "name": "@yacad/studio2",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "test:e2e": "playwright test",
    "test:e2e:report": "playwright show-report"
  },
  "dependencies": {
    "@yacad/dag": "workspace:*",
    "@yacad/doc-store": "workspace:*",
    "@yacad/e2e": "workspace:*",
    "@yacad/export-stl": "workspace:*",
    "@yacad/geometry": "workspace:*",
    "@yacad/hash": "workspace:*",
    "@yacad/import-gltf": "workspace:*",
    "@yacad/import-obj": "workspace:*",
    "@yacad/import-stl": "workspace:*",
    "@yacad/kernel-manifold": "workspace:*",
    "@yacad/lua": "workspace:*",
    "@yacad/mutations": "workspace:*",
    "@yacad/render": "workspace:*",
    "@yacad/selection": "workspace:*",
    "@yacad/vfs": "workspace:*",
    "@yacad/worker": "workspace:*",
    "manifold-3d": "^3.5.0",
    "wasmoon": "1.16.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.60.0",
    "@sveltejs/vite-plugin-svelte": "^7.1.2",
    "@yacad/tsconfig": "workspace:*",
    "svelte": "^5.55.9",
    "svelte-check": "^4.4.8",
    "typescript": "^6.0.3",
    "vite": "^6.0.7"
  }
}
```

(Adjust versions to match `apps/studio/package.json` exactly. The deps you add beyond v1: `@yacad/doc-store`, `@yacad/selection`, `@yacad/mutations`, `@yacad/vfs`.)

- [ ] **Step 2: Create `apps/studio2/tsconfig.json`**

Copy `apps/studio/tsconfig.json` verbatim (the existing config works for Svelte 5).

- [ ] **Step 3: Create `apps/studio2/vite.config.ts`**

Copy `apps/studio/vite.config.ts` as a starting template, then add the three new package aliases. The full new aliases list should include every workspace package:

```typescript
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const src = (rel: string) => fileURLToPath(new URL(`../../packages/${rel}`, import.meta.url));
const srcFile = (name: string, file: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/${file}`, import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: [
      { find: '@yacad/worker/host', replacement: src('worker/src/host.ts') },
      { find: '@yacad/worker', replacement: src('worker/src/index.ts') },
      { find: '@yacad/canonical', replacement: src('canonical/src/index.ts') },
      { find: '@yacad/hash', replacement: src('hash/src/index.ts') },
      { find: '@yacad/geometry', replacement: src('geometry/src/index.ts') },
      { find: '@yacad/dag', replacement: src('dag/src/index.ts') },
      { find: '@yacad/cache', replacement: src('cache/src/index.ts') },
      { find: '@yacad/kernel-manifold', replacement: src('kernel-manifold/src/index.ts') },
      { find: '@yacad/engine', replacement: src('engine/src/index.ts') },
      { find: '@yacad/render', replacement: src('render/src/index.ts') },
      { find: '@yacad/export-stl', replacement: src('export-stl/src/index.ts') },
      { find: '@yacad/import-stl', replacement: src('import-stl/src/index.ts') },
      { find: '@yacad/import-obj', replacement: src('import-obj/src/index.ts') },
      { find: '@yacad/import-gltf', replacement: src('import-gltf/src/index.ts') },
      { find: '@yacad/lua', replacement: src('lua/src/index.ts') },
      { find: '@yacad/vfs', replacement: src('vfs/src/index.ts') },
      { find: '@yacad/doc-store', replacement: src('doc-store/src/index.ts') },
      { find: '@yacad/selection', replacement: src('selection/src/index.ts') },
      { find: '@yacad/mutations', replacement: src('mutations/src/index.ts') },
      { find: '@yacad/e2e/fixtures', replacement: srcFile('e2e', 'fixtures.ts') },
    ],
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
});
```

- [ ] **Step 4: Create `apps/studio2/index.html`**

Copy `apps/studio/index.html` verbatim. Update the `<title>` to `yacad studio v2`.

- [ ] **Step 5: Create `apps/studio2/src/app.css`**

A minimal CSS scaffold establishing the three-pane layout. Copy from `apps/studio/src/app.css` for color tokens / typography, then override the layout:

```css
:root {
  font-family: ui-sans-serif, system-ui, sans-serif;
  --bg: #1a1a1a;
  --panel: #232323;
  --panel-border: #2d2d2d;
  --fg: #e5e5e5;
  --accent: #7aa2f7;
  --error: #f7768e;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  overflow: hidden;
}
.studio-shell {
  display: grid;
  grid-template-rows: auto 1fr;
  grid-template-columns: 280px 1fr 320px;
  grid-template-areas:
    'topbar topbar topbar'
    'tree viewport inspector';
  height: 100vh;
}
.topbar {
  grid-area: topbar;
  padding: 0.5rem 1rem;
  background: var(--panel);
  border-bottom: 1px solid var(--panel-border);
}
.tree-pane {
  grid-area: tree;
  background: var(--panel);
  border-right: 1px solid var(--panel-border);
  overflow: auto;
}
.viewport-pane {
  grid-area: viewport;
  position: relative;
}
.inspector-pane {
  grid-area: inspector;
  background: var(--panel);
  border-left: 1px solid var(--panel-border);
  overflow: auto;
  padding: 0.75rem;
}
```

- [ ] **Step 6: Create `apps/studio2/src/main.ts`**

```typescript
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');
mount(App, { target: root });
```

- [ ] **Step 7: Create a minimal `apps/studio2/src/App.svelte`** that renders "Hello, studio v2" so the scaffold can boot

```svelte
<script lang="ts">
</script>

<div class="studio-shell">
  <header class="topbar">yacad studio v2</header>
  <aside class="tree-pane">tree</aside>
  <main class="viewport-pane">viewport</main>
  <aside class="inspector-pane">inspector</aside>
</div>
```

- [ ] **Step 8: Wire root scripts**

In root `package.json` (workspace root), add to the `scripts` object:

```json
"dev:v2": "pnpm --filter @yacad/studio2 dev",
"build:v2": "pnpm --filter @yacad/studio2 build",
"check:v2": "pnpm --filter @yacad/studio2 check"
```

- [ ] **Step 9: Install + verify the dev server starts**

Run: `pnpm install`
Then in a separate shell: `pnpm dev:v2`
Expected: Vite reports a local URL (e.g. `http://localhost:5173`) and the page renders the three-pane layout with placeholder labels. Stop the server with Ctrl-C.

Also verify the type-check passes: `pnpm check:v2` → 0 errors.

- [ ] **Step 10: Commit**

```bash
git add apps/studio2 package.json pnpm-lock.yaml
git commit -m "feat(studio2): scaffold three-pane shell"
```

---

## Task 9: `apps/studio2` — worker bootstrap + Svelte state adapters

**Files:**
- Create: `apps/studio2/src/worker.ts`
- Create: `apps/studio2/src/state/session.svelte.ts`
- Create: `apps/studio2/src/state/selection.svelte.ts`

- [ ] **Step 1: Worker bootstrap mirrors v1**

Create `apps/studio2/src/worker.ts`:

```typescript
import { startHost } from '@yacad/worker/host';

startHost(self as unknown as Parameters<typeof startHost>[0]);
```

- [ ] **Step 2: Svelte selection adapter**

Create `apps/studio2/src/state/selection.svelte.ts`:

```typescript
import { Selection } from '@yacad/selection';

/**
 * Svelte $state wrapper around a Selection instance. The class exposes
 * reactive `selectedId` that components can read directly; `select` / `clear`
 * proxy through to the underlying Selection (which fires its subscribers).
 *
 * One adapter per session lifetime; the App swaps it on doc change.
 */
export class SelectionState {
  readonly selection = new Selection();
  selectedId = $state<string | null>(null);

  constructor() {
    this.selection.subscribe((id) => {
      this.selectedId = id;
    });
  }

  select(id: string | null): void {
    this.selection.select(id);
  }

  clear(): void {
    this.selection.clear();
  }
}
```

- [ ] **Step 3: Svelte session adapter**

Create `apps/studio2/src/state/session.svelte.ts`:

```typescript
import type { NodeDoc } from '@yacad/dag';
import type { DocSession } from '@yacad/doc-store';

/**
 * Svelte $state wrapper around a DocSession. Subscribes to `doc-changed`,
 * `meta-changed`, `persisted`, and `invalidated` events and re-derives the
 * reactive properties so Svelte templates can read them.
 *
 * The wrapper is constructed once per opened session — when the App switches
 * docs, it disposes the old SessionState (calls unsubscribe) and creates a
 * fresh one for the new session.
 */
export class SessionState {
  doc = $state<NodeDoc>(this.session.doc);
  name = $state(this.session.meta.name);
  isDirty = $state(this.session.isDirty);
  canUndo = $state(this.session.canUndo);
  canRedo = $state(this.session.canRedo);
  invalidationError = $state<Error | undefined>(this.session.invalidationError);

  private readonly unsubscribe: () => void;

  constructor(readonly session: DocSession) {
    this.unsubscribe = session.subscribe((evt) => {
      if (evt.kind === 'doc-changed') {
        this.doc = session.doc;
        this.isDirty = session.isDirty;
        this.canUndo = session.canUndo;
        this.canRedo = session.canRedo;
      } else if (evt.kind === 'meta-changed') {
        this.name = session.meta.name;
        this.isDirty = session.isDirty;
      } else if (evt.kind === 'persisted') {
        this.isDirty = session.isDirty;
      } else if (evt.kind === 'invalidated') {
        this.invalidationError = evt.error;
      }
    });
  }

  dispose(): void {
    this.unsubscribe();
  }
}
```

- [ ] **Step 4: Run check**

Run: `pnpm check:v2`
Expected: 0 errors. (The adapters don't render anything yet — they just compile.)

- [ ] **Step 5: Commit**

```bash
git add apps/studio2/src/worker.ts apps/studio2/src/state
git commit -m "feat(studio2): worker bootstrap + Svelte state adapters"
```

---

## Task 10: `apps/studio2` — DocPicker + initial App wiring

**Files:**
- Create: `apps/studio2/src/ui/DocPicker.svelte`
- Modify: `apps/studio2/src/App.svelte`

- [ ] **Step 1: Replace `apps/studio2/src/App.svelte` with the wired version**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { IndexedDbVfs } from '@yacad/vfs';
  import { DocLibrary } from '@yacad/doc-store';
  import { WorkerClient } from '@yacad/worker';
  import wasmUrl from 'manifold-3d/manifold.wasm?url';
  import luaWasmUrl from 'wasmoon/dist/glue.wasm?url';
  import EvalWorker from './worker?worker';
  import { SessionState } from './state/session.svelte';
  import { SelectionState } from './state/selection.svelte';
  import DocPicker from './ui/DocPicker.svelte';

  let library: DocLibrary;
  let client: WorkerClient;
  let session = $state<SessionState | undefined>(undefined);
  let selection = $state<SelectionState | undefined>(undefined);
  let docs = $state<{ id: string; name: string }[]>([]);

  async function refreshDocs() {
    if (!library) return;
    const list = await library.list();
    docs = list.map((m) => ({ id: m.id, name: m.name }));
  }

  async function openDoc(id: string) {
    if (session) {
      await session.session.close();
      session.dispose();
    }
    const opened = await library.open(id);
    session = new SessionState(opened);
    selection = new SelectionState();
  }

  async function createDoc() {
    const fresh = await library.create('Untitled');
    await refreshDocs();
    await openDoc(fresh.id);
  }

  onMount(() => {
    const worker = new EvalWorker();
    client = new WorkerClient(worker, { wasmUrl, luaWasmUrl });
    const vfs = new IndexedDbVfs();
    library = new DocLibrary(vfs, client);
    void (async () => {
      await refreshDocs();
      if (docs.length === 0) {
        await createDoc();
      } else {
        await openDoc(docs[0].id);
      }
    })();

    return () => {
      worker.terminate();
      session?.session.close();
      session?.dispose();
    };
  });
</script>

<div class="studio-shell">
  <header class="topbar">
    <DocPicker {docs} currentId={session?.session.id ?? null} {openDoc} {createDoc} />
  </header>
  <aside class="tree-pane">
    {#if session}
      <pre>{JSON.stringify(session.doc, null, 2)}</pre>
    {:else}
      <em>loading…</em>
    {/if}
  </aside>
  <main class="viewport-pane">viewport</main>
  <aside class="inspector-pane">
    {#if selection?.selectedId}
      <p>Selected: {selection.selectedId}</p>
    {:else}
      <em>nothing selected</em>
    {/if}
  </aside>
</div>
```

- [ ] **Step 2: Create `apps/studio2/src/ui/DocPicker.svelte`**

```svelte
<script lang="ts">
  interface Props {
    docs: { id: string; name: string }[];
    currentId: string | null;
    openDoc: (id: string) => Promise<void>;
    createDoc: () => Promise<void>;
  }

  let { docs, currentId, openDoc, createDoc }: Props = $props();

  function onSelect(e: Event) {
    const id = (e.currentTarget as HTMLSelectElement).value;
    if (id === '__new__') {
      void createDoc();
    } else if (id !== currentId) {
      void openDoc(id);
    }
  }
</script>

<label>
  Document
  <select value={currentId ?? ''} onchange={onSelect}>
    {#each docs as d (d.id)}
      <option value={d.id}>{d.name}</option>
    {/each}
    <option value="__new__">＋ new document</option>
  </select>
</label>
```

- [ ] **Step 3: Smoke test in the dev server**

Run: `pnpm dev:v2`
Expected: the page loads, the document picker shows "Untitled" (auto-created on first run), the tree pane shows the seeded box's JSON. Refresh — the doc survives. Stop with Ctrl-C.

- [ ] **Step 4: Type check**

Run: `pnpm check:v2`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/studio2/src
git commit -m "feat(studio2): DocPicker + library/session/selection wiring"
```

---

## Task 11: `apps/studio2` — TreePane + TreeNode + selection

**Files:**
- Create: `apps/studio2/src/ui/TreePane.svelte`
- Create: `apps/studio2/src/ui/TreeNode.svelte`
- Modify: `apps/studio2/src/App.svelte`
- Modify: `apps/studio2/src/app.css`

- [ ] **Step 1: Create `apps/studio2/src/ui/TreeNode.svelte`** — recursive row

```svelte
<script lang="ts">
  import type { NodeDoc } from '@yacad/dag';
  import { getNodeType } from '@yacad/dag';
  import { SelectionState } from '../state/selection.svelte';

  interface Props {
    doc: NodeDoc;
    path: string;
    selection: SelectionState;
  }

  let { doc, path, selection }: Props = $props();

  let expanded = $state(true);
  const children = $derived(doc.children ?? []);
  const hasChildren = $derived(children.length > 0);
  const isSelected = $derived(selection.selectedId === path);
  const summary = $derived.by(() => {
    const def = getNodeType(doc.type);
    if (!def) return doc.type + ' (unknown)';
    if (def.kind === 'kernel') return doc.type;
    if (def.kind === 'expandable') return doc.type;
    return doc.type;
  });
</script>

<div class="tree-row" class:selected={isSelected}>
  {#if hasChildren}
    <button class="toggle" onclick={() => (expanded = !expanded)}>{expanded ? '▼' : '▶'}</button>
  {:else}
    <span class="toggle-spacer"></span>
  {/if}
  <button class="row-label" onclick={() => selection.select(path)}>{summary}</button>
</div>
{#if hasChildren && expanded}
  <div class="tree-children">
    {#each children as child, i (i)}
      <TreeNode doc={child} path={path === '$' ? `$/${i}` : `${path}/${i}`} {selection} />
    {/each}
  </div>
{/if}
```

- [ ] **Step 2: Create `apps/studio2/src/ui/TreePane.svelte`**

```svelte
<script lang="ts">
  import { SessionState } from '../state/session.svelte';
  import { SelectionState } from '../state/selection.svelte';
  import TreeNode from './TreeNode.svelte';

  interface Props {
    session: SessionState;
    selection: SelectionState;
  }

  let { session, selection }: Props = $props();
</script>

<div class="tree-pane-inner">
  <TreeNode doc={session.doc} path="$" {selection} />
</div>
```

- [ ] **Step 3: Update `apps/studio2/src/App.svelte`** to use TreePane

Replace the `<aside class="tree-pane">` block with:

```svelte
  <aside class="tree-pane">
    {#if session && selection}
      <TreePane {session} {selection} />
    {:else}
      <em>loading…</em>
    {/if}
  </aside>
```

Add the import at the top: `import TreePane from './ui/TreePane.svelte';`.

- [ ] **Step 4: Append tree styles to `apps/studio2/src/app.css`**

```css
.tree-row {
  display: flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  gap: 0.25rem;
  cursor: default;
}
.tree-row.selected {
  background: rgba(122, 162, 247, 0.18);
}
.tree-row .toggle,
.tree-row .row-label {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0.1rem 0.25rem;
  font: inherit;
}
.tree-row .toggle-spacer {
  display: inline-block;
  width: 1.2rem;
}
.tree-children {
  margin-left: 1rem;
}
```

- [ ] **Step 5: Smoke test**

Run: `pnpm dev:v2`
Expected: the tree shows the seeded "box" node. Clicking it highlights the row and the right pane shows `Selected: $`.

- [ ] **Step 6: Type check**

Run: `pnpm check:v2`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/studio2/src
git commit -m "feat(studio2): tree pane with collapse + click-to-select"
```

---

## Task 12: `apps/studio2` — form field components

**Files:**
- Create: `apps/studio2/src/ui/forms/NumberField.svelte`
- Create: `apps/studio2/src/ui/forms/IntField.svelte`
- Create: `apps/studio2/src/ui/forms/BoolField.svelte`
- Create: `apps/studio2/src/ui/forms/StringField.svelte`
- Create: `apps/studio2/src/ui/forms/EnumField.svelte`
- Create: `apps/studio2/src/ui/forms/Vec2Field.svelte`
- Create: `apps/studio2/src/ui/forms/Vec3Field.svelte`

- [ ] **Step 1: NumberField.svelte**

```svelte
<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: number | undefined;
    onCommit: (value: number) => void;
  }

  let { schema, value, onCommit }: Props = $props();

  let editing = $state(value === undefined ? '' : String(value));
  let error = $state<string | null>(null);

  $effect(() => {
    editing = value === undefined ? '' : String(value);
    error = null;
  });

  function commit() {
    const n = Number(editing);
    if (!Number.isFinite(n)) {
      error = 'must be a number';
      return;
    }
    if (schema.min !== undefined && n < schema.min) {
      error = `must be ≥ ${schema.min}`;
      return;
    }
    if (schema.max !== undefined && n > schema.max) {
      error = `must be ≤ ${schema.max}`;
      return;
    }
    error = null;
    onCommit(n);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  }
</script>

<label class="form-field" class:error={!!error} title={schema.doc}>
  <span>{schema.name}</span>
  <input
    type="number"
    bind:value={editing}
    min={schema.min}
    max={schema.max}
    onblur={commit}
    onkeydown={onKey}
  />
  {#if error}<small class="field-error">{error}</small>{/if}
</label>
```

- [ ] **Step 2: IntField.svelte** — identical to NumberField but rejects non-integers

```svelte
<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: number | undefined;
    onCommit: (value: number) => void;
  }

  let { schema, value, onCommit }: Props = $props();

  let editing = $state(value === undefined ? '' : String(value));
  let error = $state<string | null>(null);

  $effect(() => {
    editing = value === undefined ? '' : String(value);
    error = null;
  });

  function commit() {
    const n = Number(editing);
    if (!Number.isInteger(n)) {
      error = 'must be an integer';
      return;
    }
    if (schema.min !== undefined && n < schema.min) {
      error = `must be ≥ ${schema.min}`;
      return;
    }
    if (schema.max !== undefined && n > schema.max) {
      error = `must be ≤ ${schema.max}`;
      return;
    }
    error = null;
    onCommit(n);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  }
</script>

<label class="form-field" class:error={!!error} title={schema.doc}>
  <span>{schema.name}</span>
  <input
    type="number"
    step="1"
    bind:value={editing}
    min={schema.min}
    max={schema.max}
    onblur={commit}
    onkeydown={onKey}
  />
  {#if error}<small class="field-error">{error}</small>{/if}
</label>
```

- [ ] **Step 3: BoolField.svelte**

```svelte
<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: boolean | undefined;
    onCommit: (value: boolean) => void;
  }

  let { schema, value, onCommit }: Props = $props();
</script>

<label class="form-field bool-field" title={schema.doc}>
  <input
    type="checkbox"
    checked={value ?? false}
    onchange={(e) => onCommit((e.currentTarget as HTMLInputElement).checked)}
  />
  <span>{schema.name}</span>
</label>
```

- [ ] **Step 4: StringField.svelte**

```svelte
<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: string | undefined;
    onCommit: (value: string) => void;
  }

  let { schema, value, onCommit }: Props = $props();

  let editing = $state(value ?? '');
  $effect(() => {
    editing = value ?? '';
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  }
</script>

<label class="form-field" title={schema.doc}>
  <span>{schema.name}</span>
  <input type="text" bind:value={editing} onblur={() => onCommit(editing)} onkeydown={onKey} />
</label>
```

- [ ] **Step 5: EnumField.svelte**

```svelte
<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: string | undefined;
    onCommit: (value: string) => void;
  }

  let { schema, value, onCommit }: Props = $props();
  const options = $derived(schema.enum ?? []);
</script>

<label class="form-field" title={schema.doc}>
  <span>{schema.name}</span>
  <select
    value={value ?? ''}
    onchange={(e) => onCommit((e.currentTarget as HTMLSelectElement).value)}
  >
    {#each options as opt (opt)}
      <option value={opt}>{opt}</option>
    {/each}
  </select>
</label>
```

- [ ] **Step 6: Vec2Field.svelte**

```svelte
<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: [number, number] | undefined;
    onCommit: (value: [number, number]) => void;
  }

  let { schema, value, onCommit }: Props = $props();

  let editing = $state<[string, string]>([
    value?.[0]?.toString() ?? '0',
    value?.[1]?.toString() ?? '0',
  ]);
  let error = $state<string | null>(null);

  $effect(() => {
    editing = [value?.[0]?.toString() ?? '0', value?.[1]?.toString() ?? '0'];
    error = null;
  });

  function commit() {
    const x = Number(editing[0]);
    const y = Number(editing[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      error = 'must be finite numbers';
      return;
    }
    error = null;
    onCommit([x, y]);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  }
</script>

<label class="form-field vec-field" class:error={!!error} title={schema.doc}>
  <span>{schema.name}</span>
  <div class="vec-inputs">
    <input type="number" bind:value={editing[0]} onblur={commit} onkeydown={onKey} />
    <input type="number" bind:value={editing[1]} onblur={commit} onkeydown={onKey} />
  </div>
  {#if error}<small class="field-error">{error}</small>{/if}
</label>
```

- [ ] **Step 7: Vec3Field.svelte** — same shape as Vec2 with three inputs

```svelte
<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: [number, number, number] | undefined;
    onCommit: (value: [number, number, number]) => void;
  }

  let { schema, value, onCommit }: Props = $props();

  let editing = $state<[string, string, string]>([
    value?.[0]?.toString() ?? '0',
    value?.[1]?.toString() ?? '0',
    value?.[2]?.toString() ?? '0',
  ]);
  let error = $state<string | null>(null);

  $effect(() => {
    editing = [
      value?.[0]?.toString() ?? '0',
      value?.[1]?.toString() ?? '0',
      value?.[2]?.toString() ?? '0',
    ];
    error = null;
  });

  function commit() {
    const x = Number(editing[0]);
    const y = Number(editing[1]);
    const z = Number(editing[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      error = 'must be finite numbers';
      return;
    }
    error = null;
    onCommit([x, y, z]);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  }
</script>

<label class="form-field vec-field" class:error={!!error} title={schema.doc}>
  <span>{schema.name}</span>
  <div class="vec-inputs">
    <input type="number" bind:value={editing[0]} onblur={commit} onkeydown={onKey} />
    <input type="number" bind:value={editing[1]} onblur={commit} onkeydown={onKey} />
    <input type="number" bind:value={editing[2]} onblur={commit} onkeydown={onKey} />
  </div>
  {#if error}<small class="field-error">{error}</small>{/if}
</label>
```

- [ ] **Step 8: Append form styles to `apps/studio2/src/app.css`**

```css
.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}
.form-field > span {
  font-size: 0.85rem;
  color: var(--fg);
  opacity: 0.85;
}
.form-field input,
.form-field select {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--panel-border);
  padding: 0.25rem 0.4rem;
  font: inherit;
}
.form-field.error input,
.form-field.error select {
  border-color: var(--error);
}
.field-error {
  color: var(--error);
  font-size: 0.75rem;
}
.bool-field {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
}
.vec-inputs {
  display: grid;
  grid-auto-flow: column;
  gap: 0.25rem;
}
```

- [ ] **Step 9: Type check**

Run: `pnpm check:v2`
Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add apps/studio2/src
git commit -m "feat(studio2): form field components for every ParamDoc type"
```

---

## Task 13: `apps/studio2` — inspectors + dispatch

**Files:**
- Create: `apps/studio2/src/ui/inspectors/KernelInspector.svelte`
- Create: `apps/studio2/src/ui/inspectors/LuaInspector.svelte`
- Create: `apps/studio2/src/ui/inspectors/DecoderInspector.svelte`
- Create: `apps/studio2/src/ui/inspectors/InvalidatedInspector.svelte`
- Create: `apps/studio2/src/ui/InspectorPane.svelte`
- Modify: `apps/studio2/src/App.svelte`

- [ ] **Step 1: KernelInspector.svelte**

```svelte
<script lang="ts">
  import type { NodeDoc, ParamDoc } from '@yacad/dag';
  import { getKernelTypeDoc } from '@yacad/dag';
  import NumberField from '../forms/NumberField.svelte';
  import IntField from '../forms/IntField.svelte';
  import BoolField from '../forms/BoolField.svelte';
  import StringField from '../forms/StringField.svelte';
  import EnumField from '../forms/EnumField.svelte';
  import Vec2Field from '../forms/Vec2Field.svelte';
  import Vec3Field from '../forms/Vec3Field.svelte';

  interface Props {
    node: NodeDoc;
    onCommit: (paramName: string, value: unknown) => void;
  }

  let { node, onCommit }: Props = $props();
  const doc = $derived(getKernelTypeDoc(node.type));
</script>

{#if doc}
  <h3>{node.type}</h3>
  <p class="summary">{doc.summary}</p>
  {#each doc.paramSchema as schema (schema.name)}
    {@const value = (node.params ?? {})[schema.name]}
    {#if schema.enum}
      <EnumField {schema} value={value as string | undefined} onCommit={(v) => onCommit(schema.name, v)} />
    {:else if schema.type === 'number'}
      <NumberField {schema} value={value as number | undefined} onCommit={(v) => onCommit(schema.name, v)} />
    {:else if schema.type === 'int'}
      <IntField {schema} value={value as number | undefined} onCommit={(v) => onCommit(schema.name, v)} />
    {:else if schema.type === 'boolean'}
      <BoolField {schema} value={value as boolean | undefined} onCommit={(v) => onCommit(schema.name, v)} />
    {:else if schema.type === 'string'}
      <StringField {schema} value={value as string | undefined} onCommit={(v) => onCommit(schema.name, v)} />
    {:else if schema.type === 'vec2'}
      <Vec2Field {schema} value={value as [number, number] | undefined} onCommit={(v) => onCommit(schema.name, v)} />
    {:else if schema.type === 'vec3'}
      <Vec3Field {schema} value={value as [number, number, number] | undefined} onCommit={(v) => onCommit(schema.name, v)} />
    {/if}
  {/each}
{:else}
  <p><em>no kernel schema for "{node.type}"</em></p>
{/if}
```

- [ ] **Step 2: LuaInspector.svelte**

Note: `LuaDefinition.schema.params` is a `Readonly<Record<string, LuaParamDecl>>` (keyed by name), not an array. `LuaParamDecl` has fields `{ type, default?, min?, max? }` — no `name` (it's the key) and no `required`/`doc`. The inspector synthesizes a `ParamDoc` per entry for the form-field components.

```svelte
<script lang="ts">
  import type { NodeDoc, ParamDoc } from '@yacad/dag';
  import type { LuaDefinition, LuaParamDecl } from '@yacad/lua';
  import NumberField from '../forms/NumberField.svelte';
  import IntField from '../forms/IntField.svelte';
  import BoolField from '../forms/BoolField.svelte';
  import StringField from '../forms/StringField.svelte';
  import Vec3Field from '../forms/Vec3Field.svelte';

  interface Props {
    node: NodeDoc;
    definitionResolver: (hash: string) => unknown;
    onCommitValue: (paramName: string, value: unknown) => void;
  }

  let { node, definitionResolver, onCommitValue }: Props = $props();

  const definitionHash = $derived((node.params ?? {})['definitionHash'] as string | undefined);
  const definition = $derived.by(() => {
    if (!definitionHash) return undefined;
    const raw = definitionResolver(definitionHash);
    return raw as LuaDefinition | undefined;
  });
  const values = $derived(((node.params ?? {})['values'] ?? {}) as Record<string, unknown>);

  function commit(paramName: string, value: unknown) {
    const nextValues = { ...values, [paramName]: value };
    onCommitValue('values', nextValues);
  }

  function paramsEntries(def: LuaDefinition): [string, LuaParamDecl][] {
    return Object.entries(def.schema.params);
  }

  function toParamDoc(name: string, decl: LuaParamDecl): ParamDoc {
    return {
      name,
      type: decl.type,
      required: decl.default === undefined,
      doc: '',
      default: decl.default,
      min: decl.min,
      max: decl.max,
    };
  }
</script>

{#if definition}
  <h3>lua</h3>
  <p class="summary">definitionHash: <code>{definitionHash}</code></p>
  {#each paramsEntries(definition) as [name, decl] (name)}
    {@const schema = toParamDoc(name, decl)}
    {@const value = values[name] ?? decl.default}
    {#if decl.type === 'number'}
      <NumberField {schema} value={value as number | undefined} onCommit={(v) => commit(name, v)} />
    {:else if decl.type === 'int'}
      <IntField {schema} value={value as number | undefined} onCommit={(v) => commit(name, v)} />
    {:else if decl.type === 'boolean'}
      <BoolField {schema} value={value as boolean | undefined} onCommit={(v) => commit(name, v)} />
    {:else if decl.type === 'string'}
      <StringField {schema} value={value as string | undefined} onCommit={(v) => commit(name, v)} />
    {:else if decl.type === 'vec3'}
      <Vec3Field {schema} value={value as [number, number, number] | undefined} onCommit={(v) => commit(name, v)} />
    {/if}
  {/each}
{:else if definitionHash}
  <p><em>LuaDefinition <code>{definitionHash.slice(0, 8)}…</code> not loaded</em></p>
{:else}
  <p><em>no definitionHash on this node</em></p>
{/if}
```

- [ ] **Step 3: DecoderInspector.svelte**

```svelte
<script lang="ts">
  import type { NodeDoc } from '@yacad/dag';
  import type { DocSession } from '@yacad/doc-store';
  import { hashStlBlob } from '@yacad/import-stl';
  import { hashObjBlob } from '@yacad/import-obj';
  import { hashGltfBlob } from '@yacad/import-gltf';

  interface Props {
    node: NodeDoc;
    session: DocSession;
    onCommitHash: (hash: string) => void;
  }

  let { node, session, onCommitHash }: Props = $props();

  const blobHash = $derived((node.params ?? {})['blobHash'] as string | undefined);
  const sizeBytes = $derived(blobHash ? session.blobs.get(blobHash)?.length ?? 0 : 0);

  let fileInput: HTMLInputElement;

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash =
      node.type === 'import-stl'
        ? await hashStlBlob(bytes)
        : node.type === 'import-obj'
          ? await hashObjBlob(bytes)
          : await hashGltfBlob(bytes);
    await session.addBlob(bytes);
    onCommitHash(hash);
    input.value = '';
  }
</script>

<h3>{node.type}</h3>
<p class="summary">
  blob: <code>{blobHash ? blobHash.slice(0, 12) + '…' : '(none)'}</code>
  {#if sizeBytes}<small>({sizeBytes} bytes)</small>{/if}
</p>
<button onclick={() => fileInput.click()}>Replace…</button>
<input type="file" bind:this={fileInput} onchange={onFile} style="display: none" />
```

- [ ] **Step 4: InvalidatedInspector.svelte**

```svelte
<script lang="ts">
  interface Props {
    error: Error | undefined;
  }
  let { error }: Props = $props();
</script>

<h3 class="invalidated-title">document invalidated</h3>
{#if error}
  <p class="field-error">{error.message}</p>
{/if}
<p>
  <em>Reset to last valid is not yet implemented; please review the JSON outside the editor.</em>
</p>
```

- [ ] **Step 5: InspectorPane.svelte** — dispatch by node kind

```svelte
<script lang="ts">
  import { getAt } from '@yacad/mutations';
  import { getNodeType } from '@yacad/dag';
  import { setParam } from '@yacad/mutations';
  import KernelInspector from './inspectors/KernelInspector.svelte';
  import LuaInspector from './inspectors/LuaInspector.svelte';
  import DecoderInspector from './inspectors/DecoderInspector.svelte';
  import InvalidatedInspector from './inspectors/InvalidatedInspector.svelte';
  import { SessionState } from '../state/session.svelte';
  import { SelectionState } from '../state/selection.svelte';

  interface Props {
    session: SessionState;
    selection: SelectionState;
  }

  let { session, selection }: Props = $props();

  const selectedNode = $derived.by(() => {
    if (!selection.selectedId) return undefined;
    try {
      return getAt(session.doc, selection.selectedId);
    } catch {
      return undefined;
    }
  });

  const selectedDef = $derived(selectedNode ? getNodeType(selectedNode.type) : undefined);

  async function commitParam(name: string, value: unknown) {
    if (!selection.selectedId) return;
    try {
      await session.session.mutate((prev) => setParam(prev, selection.selectedId!, name, value));
    } catch (err) {
      // The form-field components surface their own validation errors.
      // Mutation rejection here is fine to surface in console for now.
      console.error('mutate rejected:', err);
    }
  }
</script>

{#if session.invalidationError}
  <InvalidatedInspector error={session.invalidationError} />
{:else if !selectedNode}
  <p><em>Select a node from the tree to edit its parameters.</em></p>
{:else if selectedDef?.kind === 'kernel'}
  <KernelInspector node={selectedNode} onCommit={commitParam} />
{:else if selectedDef?.kind === 'expandable'}
  <LuaInspector
    node={selectedNode}
    definitionResolver={(h) => session.session.blobs.get(h)}
    onCommitValue={commitParam}
  />
{:else if selectedDef?.kind === 'decoder'}
  <DecoderInspector
    node={selectedNode}
    session={session.session}
    onCommitHash={(h) => commitParam('blobHash', h)}
  />
{:else}
  <p><em>no inspector for type "{selectedNode.type}"</em></p>
{/if}
```

- [ ] **Step 6: Wire InspectorPane into `App.svelte`**

In `apps/studio2/src/App.svelte`, replace the `<aside class="inspector-pane">` content with:

```svelte
  <aside class="inspector-pane">
    {#if session && selection}
      <InspectorPane {session} {selection} />
    {:else}
      <em>loading…</em>
    {/if}
  </aside>
```

Add the import: `import InspectorPane from './ui/InspectorPane.svelte';`.

- [ ] **Step 7: Type check + smoke test**

Run: `pnpm check:v2`
Expected: 0 errors.

Run: `pnpm dev:v2`
Expected: tree shows the seeded box. Click root → inspector shows `box` with `size` (vec3) and `center` (boolean) fields. Edit a field, blur — viewport is empty (no ViewportPane yet), but no errors in console.

- [ ] **Step 8: Commit**

```bash
git add apps/studio2/src
git commit -m "feat(studio2): inspector pane with kernel/Lua/decoder dispatch"
```

---

## Task 14: `apps/studio2` — ToolPalette (wrap-with / add-child / delete)

**Files:**
- Create: `apps/studio2/src/ui/ToolPalette.svelte`
- Modify: `apps/studio2/src/ui/TreePane.svelte`

- [ ] **Step 1: Create `apps/studio2/src/ui/ToolPalette.svelte`**

```svelte
<script lang="ts">
  import { getAt } from '@yacad/mutations';
  import { getNodeType, listNodeTypes, type GeometryType } from '@yacad/dag';
  import { removeAt, wrapWith, addChild } from '@yacad/mutations';
  import { SessionState } from '../state/session.svelte';
  import { SelectionState } from '../state/selection.svelte';

  interface Props {
    session: SessionState;
    selection: SelectionState;
  }

  let { session, selection }: Props = $props();

  // Sensible wrapper defaults per type — what the user gets if they wrap with
  // translate/rotate/etc. Tooling-side curation; can be expanded.
  const WRAPPERS_3D: { type: string; params: Record<string, unknown> }[] = [
    { type: 'translate', params: { offset: [0, 0, 0] } },
    { type: 'rotate', params: { angles: [0, 0, 0] } },
  ];
  const WRAPPERS_2D: { type: string; params: Record<string, unknown> }[] = [
    { type: 'translate_2d', params: { offset: [0, 0] } },
    { type: 'rotate_2d', params: { angle: 0 } },
    { type: 'extrude', params: { height: 10 } },
  ];

  const selectedNode = $derived.by(() => {
    if (!selection.selectedId) return undefined;
    try {
      return getAt(session.doc, selection.selectedId);
    } catch {
      return undefined;
    }
  });

  const outputType = $derived.by<GeometryType | undefined>(() => {
    if (!selectedNode) return undefined;
    const def = getNodeType(selectedNode.type);
    if (!def) return undefined;
    if (def.kind === 'kernel') {
      return typeof def.output === 'function' ? def.output([]) : def.output;
    }
    // Expandable/decoder — best-effort.
    return undefined;
  });

  const wrappers = $derived(outputType === '2d' ? WRAPPERS_2D : WRAPPERS_3D);

  async function wrapWithType(type: string, params: Record<string, unknown>) {
    if (!selection.selectedId) return;
    try {
      await session.session.mutate((prev) => wrapWith(prev, selection.selectedId!, type, params));
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteSelected() {
    if (!selection.selectedId || selection.selectedId === '$') return;
    try {
      await session.session.mutate((prev) => removeAt(prev, selection.selectedId!));
      selection.clear();
    } catch (err) {
      console.error(err);
    }
  }

  async function addPrimitiveChild() {
    if (!selection.selectedId) return;
    const seed = { type: 'box', params: { size: [10, 10, 10], center: true } };
    try {
      await session.session.mutate((prev) => addChild(prev, selection.selectedId!, seed));
    } catch (err) {
      console.error(err);
    }
  }
</script>

<div class="tool-palette">
  <details>
    <summary>Wrap with…</summary>
    {#each wrappers as w (w.type)}
      <button onclick={() => wrapWithType(w.type, w.params)}>{w.type}</button>
    {/each}
  </details>
  <button onclick={addPrimitiveChild} disabled={!selectedNode}>+ child (box)</button>
  <button onclick={deleteSelected} disabled={!selection.selectedId || selection.selectedId === '$'}>
    delete
  </button>
</div>
```

- [ ] **Step 2: Modify `apps/studio2/src/ui/TreePane.svelte`** to render ToolPalette above the tree

```svelte
<script lang="ts">
  import { SessionState } from '../state/session.svelte';
  import { SelectionState } from '../state/selection.svelte';
  import TreeNode from './TreeNode.svelte';
  import ToolPalette from './ToolPalette.svelte';

  interface Props {
    session: SessionState;
    selection: SelectionState;
  }

  let { session, selection }: Props = $props();
</script>

<div class="tree-pane-inner">
  <ToolPalette {session} {selection} />
  <TreeNode doc={session.doc} path="$" {selection} />
</div>
```

- [ ] **Step 3: Append palette styles to `apps/studio2/src/app.css`**

```css
.tool-palette {
  display: flex;
  gap: 0.25rem;
  padding: 0.5rem;
  border-bottom: 1px solid var(--panel-border);
  align-items: center;
  flex-wrap: wrap;
}
.tool-palette button {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--panel-border);
  cursor: pointer;
  padding: 0.2rem 0.5rem;
  font: inherit;
}
.tool-palette button:disabled {
  opacity: 0.5;
  cursor: default;
}
.tool-palette details > summary {
  list-style: none;
  cursor: pointer;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--panel-border);
}
.tool-palette details[open] {
  background: var(--panel);
}
.tool-palette details > button {
  display: block;
  width: 100%;
  text-align: left;
}
```

- [ ] **Step 4: Type check + smoke test**

Run: `pnpm check:v2`
Expected: 0 errors.

Run: `pnpm dev:v2`
Expected: open the wrap-with dropdown → click "translate" → tree shows the wrapped structure. Click child → "delete" removes it.

- [ ] **Step 5: Commit**

```bash
git add apps/studio2/src
git commit -m "feat(studio2): tool palette — wrap-with, add child, delete"
```

---

## Task 15: `apps/studio2` — ViewportPane + live evaluation

**Files:**
- Create: `apps/studio2/src/ui/ViewportPane.svelte`
- Modify: `apps/studio2/src/App.svelte`

- [ ] **Step 1: Create `apps/studio2/src/ui/ViewportPane.svelte`**

This component owns the canvas + the Viewport instance from `@yacad/render`, and re-evaluates when the session's doc changes (mirroring v1's debounced evaluation).

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import type { WorkerClient, EvaluateOutcome } from '@yacad/worker';
  import { Viewport, geometryToObject3D } from '@yacad/render';
  import { loadManifold } from '@yacad/kernel-manifold';
  import wasmUrl from 'manifold-3d/manifold.wasm?url';
  import type { SessionState } from '../state/session.svelte';

  interface Props {
    session: SessionState;
    client: WorkerClient;
  }

  let { session, client }: Props = $props();

  let canvas: HTMLCanvasElement;
  let viewport: Viewport | undefined;
  let manifoldApi: Awaited<ReturnType<typeof loadManifold>> | undefined;
  let status = $state<'idle' | 'evaluating' | 'error'>('idle');
  let error = $state('');
  let stats = $state<EvaluateOutcome['stats'] | null>(null);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let evalSeq = 0;
  const STATUS_DEFER_MS = 50;
  const EVAL_DEBOUNCE_MS = 150;

  async function evaluate() {
    if (!viewport) return;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status = 'evaluating';
    }, STATUS_DEFER_MS);
    const seq = ++evalSeq;
    try {
      const outcome = await client.evaluate(session.doc, 'final');
      if (seq !== evalSeq) return;
      clearTimeout(statusTimer);
      if (outcome.geometry.kind === '2d') {
        manifoldApi ??= await loadManifold({ locateFile: () => wasmUrl });
        viewport.setGeometry(outcome.geometry, manifoldApi);
      } else {
        viewport.setMesh(outcome.geometry.mesh);
      }
      stats = outcome.stats;
      error = '';
      status = 'idle';
    } catch (e) {
      if (seq !== evalSeq) return;
      clearTimeout(statusTimer);
      status = 'error';
      error = (e as Error).message;
    }
  }

  function scheduleEvaluate() {
    clearTimeout(debounce);
    debounce = setTimeout(() => void evaluate(), EVAL_DEBOUNCE_MS);
  }

  onMount(() => {
    viewport = new Viewport(canvas);
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      viewport?.resize(rect.width, rect.height);
    });
    ro.observe(canvas);
    void evaluate();

    return () => {
      ro.disconnect();
      viewport?.dispose();
      clearTimeout(debounce);
      clearTimeout(statusTimer);
    };
  });

  // Re-evaluate when the doc changes.
  $effect(() => {
    void session.doc;
    if (viewport) scheduleEvaluate();
  });
</script>

<canvas bind:this={canvas} class="viewport-canvas"></canvas>
<div class="viewport-footer">
  <span class="status" data-status={status}>{status}</span>
  {#if stats}
    <span>nodes: {stats.nodes}, hits: {stats.hits}, misses: {stats.misses}</span>
  {/if}
  {#if error}<span class="field-error">{error}</span>{/if}
</div>
```

- [ ] **Step 2: Append viewport styles to `apps/studio2/src/app.css`**

```css
.viewport-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.viewport-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 0.4rem 0.75rem;
  background: rgba(20, 20, 20, 0.7);
  font-size: 0.85rem;
  display: flex;
  gap: 1rem;
  pointer-events: none;
}
.status[data-status='evaluating'] {
  color: var(--accent);
}
.status[data-status='error'] {
  color: var(--error);
}
```

- [ ] **Step 3: Wire ViewportPane into `App.svelte`**

In `apps/studio2/src/App.svelte`:
- Hold a reference to `client` after creating the WorkerClient.
- Replace the `<main class="viewport-pane">viewport</main>` block with:

```svelte
  <main class="viewport-pane">
    {#if session && client}
      <ViewportPane {session} {client} />
    {/if}
  </main>
```

Add the import + a `let client = $state<WorkerClient | undefined>(undefined);` declaration. In `onMount`, after constructing `client`, mark it as reactive: `client = newClient;`.

- [ ] **Step 4: Type check + smoke test**

Run: `pnpm check:v2`
Expected: 0 errors.

Run: `pnpm dev:v2`
Expected: viewport renders the seeded box. Edit `size` to `[20, 20, 20]` and blur — viewport updates within ~150ms. Footer shows "idle / nodes: 1 / hits: 0 / misses: 1".

- [ ] **Step 5: Commit**

```bash
git add apps/studio2/src
git commit -m "feat(studio2): viewport pane with live evaluation"
```

---

## Task 16: `apps/studio2` — first-run scene-library seeder

**Files:**
- Create: `apps/studio2/src/seed-scenes.ts`
- Modify: `apps/studio2/src/App.svelte`

- [ ] **Step 1: Create `apps/studio2/src/seed-scenes.ts`**

```typescript
import type { DocLibrary } from '@yacad/doc-store';
import type { NodeDoc } from '@yacad/dag';
import { defaultHasher } from '@yacad/hash';
import { canonicalBytes } from '@yacad/canonical';
import {
  GEAR_DEFINITION,
  ARRAY_ALONG_X_DEFINITION,
  FLOWER_DEFINITION,
} from '@yacad/e2e/fixtures';
import sceneBox from '../../../packages/e2e/scenes/primitives/box.json?raw';
import sceneSphere from '../../../packages/e2e/scenes/primitives/sphere.json?raw';
import sceneCylinder from '../../../packages/e2e/scenes/primitives/cylinder.json?raw';
import sceneTranslatedBox from '../../../packages/e2e/scenes/transforms/translated-box.json?raw';
import sceneRotatedCylinder from '../../../packages/e2e/scenes/transforms/rotated-cylinder.json?raw';
import sceneUnionStack from '../../../packages/e2e/scenes/booleans/union-stack.json?raw';
import sceneBoxMinusSphere from '../../../packages/e2e/scenes/booleans/box-minus-sphere.json?raw';
import sceneCoredBlock from '../../../packages/e2e/scenes/composite/cored-block.json?raw';
import sceneCircle from '../../../packages/e2e/scenes/2d/circle.json?raw';
import sceneSplineStar from '../../../packages/e2e/scenes/2d/spline-star.json?raw';
import sceneRoundedRect from '../../../packages/e2e/scenes/2d/rounded-rect.json?raw';
import sceneExtrudedGear from '../../../packages/e2e/scenes/composite/extruded-gear.json?raw';
import sceneRevolvedVase from '../../../packages/e2e/scenes/composite/revolved-vase.json?raw';
import sceneTangent from '../../../packages/e2e/scenes/edge-cases/tangent-sphere-box.json?raw';
import sceneSharedFace from '../../../packages/e2e/scenes/edge-cases/shared-face-cubes.json?raw';
import sceneInteriorVoid from '../../../packages/e2e/scenes/edge-cases/interior-void.json?raw';

interface StaticScene {
  name: string;
  json: string;
}

const STATIC_SCENES: StaticScene[] = [
  { name: 'Box', json: sceneBox },
  { name: 'Sphere', json: sceneSphere },
  { name: 'Cylinder', json: sceneCylinder },
  { name: 'Translated box', json: sceneTranslatedBox },
  { name: 'Rotated cylinder', json: sceneRotatedCylinder },
  { name: 'Union stack', json: sceneUnionStack },
  { name: 'Box minus sphere', json: sceneBoxMinusSphere },
  { name: 'Cored block', json: sceneCoredBlock },
  { name: 'Circle (2D)', json: sceneCircle },
  { name: 'Spline star (2D)', json: sceneSplineStar },
  { name: 'Rounded rect (2D)', json: sceneRoundedRect },
  { name: 'Extruded gear', json: sceneExtrudedGear },
  { name: 'Revolved vase', json: sceneRevolvedVase },
  { name: 'Tangent sphere/box', json: sceneTangent },
  { name: 'Shared face cubes', json: sceneSharedFace },
  { name: 'Interior void', json: sceneInteriorVoid },
];

interface LuaScene {
  name: string;
  defConstant: typeof GEAR_DEFINITION;
  buildDoc: (definitionHash: string) => NodeDoc;
}

/** Seed the library on first run. Idempotent — only runs when library.list() is empty. */
export async function seedSceneLibrary(library: DocLibrary): Promise<void> {
  if ((await library.list()).length > 0) return;

  for (const scene of STATIC_SCENES) {
    const doc = JSON.parse(scene.json) as NodeDoc;
    const session = await library.create(scene.name, doc);
    await session.close();
  }

  const luaScenes: LuaScene[] = [
    {
      name: 'Lua: parametric gear',
      defConstant: GEAR_DEFINITION,
      buildDoc: (hash) => ({
        type: 'lua',
        params: { definitionHash: hash, values: { teeth: 12, radius: 12 } },
      }),
    },
    {
      name: 'Lua: array along X',
      defConstant: ARRAY_ALONG_X_DEFINITION,
      buildDoc: (hash) => ({
        type: 'lua',
        params: { definitionHash: hash, values: { count: 4 } },
        children: [{ type: 'sphere', params: { radius: 3 } }],
      }),
    },
    {
      name: 'Lua: 2D flower (extruded)',
      defConstant: FLOWER_DEFINITION,
      buildDoc: (hash) => ({
        type: 'extrude',
        params: { height: 4 },
        children: [{ type: 'lua', params: { definitionHash: hash, values: {} } }],
      }),
    },
  ];

  for (const luaScene of luaScenes) {
    const defBytes = canonicalBytes(luaScene.defConstant);
    const hash = await defaultHasher.hash(defBytes);
    const session = await library.create(luaScene.name, luaScene.buildDoc(hash));
    await session.addBlob(defBytes);
    await session.save();
    await session.close();
  }

  // Stress-test scenes — captured at fixed sizes from v1's procedural
  // generators. Copy the function bodies verbatim from
  // `apps/studio/src/App.svelte` (transformChain, boolNest, procTree with
  // its TreeOpts type). The studio v1 file is the reference; the
  // generators are pure functions producing NodeDoc trees.
  // Place those helpers inline in this module above the seeder, then:
  const stressScenes: { name: string; doc: NodeDoc }[] = [
    { name: 'Stress: transform chain (×40)', doc: transformChain(40, 5) },
    { name: 'Stress: boolean nest (×5)', doc: boolNest(5) },
    { name: 'Stress: procedural tree', doc: procTree({ depth: 5, branches: 3, wobble: 1, seed: 42 }) },
  ];
  for (const scene of stressScenes) {
    const session = await library.create(scene.name, scene.doc);
    await session.close();
  }

  // Mesh-import sample: a hand-rolled cube encoded as binary STL, imported
  // and remixed. Copy the SAMPLE_STL_BYTES IIFE construction from v1's
  // App.svelte verbatim (meshToBinaryStl over a small cube Mesh). Then:
  const cubeBytes = SAMPLE_STL_BYTES;
  const cubeHash = await hashStlBlob(cubeBytes);

  const importSession = await library.create('Mesh import: STL cube', {
    type: 'import-stl',
    params: { blobHash: cubeHash },
  });
  await importSession.addBlob(cubeBytes);
  await importSession.save();
  await importSession.close();

  const remixSession = await library.create('Mesh remix: imported cube ∖ sphere', {
    type: 'difference',
    children: [
      { type: 'import-stl', params: { blobHash: cubeHash } },
      { type: 'sphere', params: { radius: 12, segments: 48 } },
    ],
  });
  await remixSession.addBlob(cubeBytes);
  await remixSession.save();
  await remixSession.close();
}
```

Note: `canonicalBytes` from `@yacad/canonical` produces the canonical serialisation of a LuaDefinition. The hash used as `definitionHash` matches what the worker's resolver looks up.

The procedural generators (`transformChain`, `boolNest`, `procTree` + its `TreeOpts` type) and the `SAMPLE_STL_BYTES` IIFE are duplicated from `apps/studio/src/App.svelte` into this module — paste them in at the top of `seed-scenes.ts` exactly as they appear in v1. Also import `hashStlBlob` from `@yacad/import-stl` and `meshToBinaryStl` from `@yacad/export-stl` (needed by the SAMPLE_STL_BYTES IIFE).

- [ ] **Step 2: Call the seeder in `App.svelte`'s `onMount`**

Replace the existing initial `void (async () => { … })()` block in `App.svelte`'s `onMount` with:

```typescript
    void (async () => {
      await refreshDocs();
      if (docs.length === 0) {
        await seedSceneLibrary(library);
        await refreshDocs();
      }
      if (docs.length > 0) {
        await openDoc(docs[0].id);
      }
    })();
```

Add the import at the top: `import { seedSceneLibrary } from './seed-scenes';`.

- [ ] **Step 3: Smoke test**

Run: `pnpm dev:v2`
Expected: on first load (clear IndexedDB if needed via DevTools), the picker shows 19 entries (16 static + 3 Lua). Switching between them updates the viewport. Reload → docs persist.

To clear IndexedDB between test runs: in DevTools → Application → Storage → IndexedDB → right-click `yacad-vfs` → Delete database. Or use a Playwright-isolated context (Task 17).

- [ ] **Step 4: Type check**

Run: `pnpm check:v2`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/studio2/src
git commit -m "feat(studio2): first-run scene-library seeder"
```

---

## Task 17: Playwright e2e + final gate

**Files:**
- Create: `apps/studio2/e2e/studio2.spec.ts`
- Create: `apps/studio2/playwright.config.ts`

- [ ] **Step 1: Copy `apps/studio/playwright.config.ts` to `apps/studio2/playwright.config.ts`**

The existing v1 config is a clean template. Update any port/baseURL references to match studio2 if v1 hardcodes them.

- [ ] **Step 2: Write the e2e suite in `apps/studio2/e2e/studio2.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

const FIRST_LOAD_TIMEOUT = 60_000;

test('app loads and seeds the scene library', async ({ page }) => {
  await page.goto('/');
  // The doc picker should populate with the seeded library.
  const picker = page.getByLabel('Document');
  await expect(picker).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  // At least the static box should be selectable.
  await expect(page.locator('option', { hasText: 'Box' })).toHaveCount(1);
});

test('selecting a tree node populates the inspector', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Document').selectOption({ label: 'Box minus sphere' });
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  await page.locator('.tree-row').first().click();
  // Inspector shows the difference node's summary.
  await expect(page.locator('.inspector-pane h3')).toHaveText('difference');
});

test('editing a param re-evaluates the viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Document').selectOption({ label: 'Sphere' });
  // Click into the tree to select the sphere.
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  await page.locator('.tree-row').first().click();
  // Edit radius.
  const radius = page.locator('.inspector-pane input[type="number"]').first();
  await radius.fill('15');
  await radius.blur();
  // Status indicates re-eval, then idle.
  await expect(page.locator('.status')).toHaveText('idle', { timeout: 10_000 });
});

test('wrap-with-translate adds a node and viewport stays valid', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Document').selectOption({ label: 'Box' });
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  await page.locator('.tree-row').first().click();
  // Open the wrap-with dropdown and click 'translate'.
  await page.locator('.tool-palette details summary').click();
  await page.locator('.tool-palette details button', { hasText: 'translate' }).click();
  // The tree now has two rows (translate → box).
  await expect(page.locator('.tree-row')).toHaveCount(2);
  // Viewport is still idle (eval succeeded).
  await expect(page.locator('.status')).toHaveText('idle', { timeout: 10_000 });
});

test('reload restores the open document', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Document').selectOption({ label: 'Cylinder' });
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  await page.reload();
  // The picker still lists the seeded library (no re-seeding).
  await expect(page.locator('option', { hasText: 'Cylinder' })).toHaveCount(1);
});
```

- [ ] **Step 3: Run the e2e suite locally**

Run: `pnpm --filter @yacad/studio2 test:e2e`
Expected: 5 tests pass. (You may need a `playwright install` for browsers on a fresh machine.)

- [ ] **Step 4: Final full-gate validation**

Run from the repo root:

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm check:v2
pnpm --filter @yacad/studio check
pnpm build:v2
```

Expected: all green. `pnpm test` should show ~25+ new tests beyond spec 1's baseline.

- [ ] **Step 5: Commit**

```bash
git add apps/studio2
git commit -m "test(studio2): playwright e2e covering load, edit, wrap-with, reload"
```

- [ ] **Step 6: Final summary commit if any format/cleanup remains**

Run: `git status`
If `pnpm format` produced changes, commit them:

```bash
git add -A
git commit -m "chore: format / cleanup after studio v2 tree-editor"
```

---

## Notes for the implementer

- **Worktree:** this plan continues on the `feat/studio-v2-foundation` branch in the existing worktree at `.claude/worktrees/studio-v2-foundation/`. Spec-1 commits and the spec-2 spec doc are already present.
- **Branch is behind `main`:** main now contains the `section` node (3D→2D bridge). Before merging this branch back, rebase onto current main and add `section` to the kernel registry's new `paramSchema` field (the test that requires every kernel type have a non-empty schema will catch it).
- **First-run state:** when smoke-testing in `pnpm dev:v2`, clear IndexedDB between runs via DevTools → Application → Storage → IndexedDB → delete `yacad-vfs`. Playwright tests use isolated contexts so this isn't a concern in CI.
- **Spec dependency:** this plan depends on the spec-1 foundation (`@yacad/vfs`, `@yacad/doc-store`) being available — they were implemented in tasks 1-11 of the foundation plan.
- **Phase 2.1 follow-up:** after this plan lands, run the audit + headline-examples pass described in the spec's "Phase 2.1" forward-looking note. That's a separate plan.
