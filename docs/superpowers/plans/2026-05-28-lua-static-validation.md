# Lua static validation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a luaparse-based static validator that rejects LuaDefinitions whose source references undeclared schema entries, violates the sandbox identifier whitelist, or malforms `geo.<type>` calls — closing the validation gap deferred from the LuaNode spec.

**Architecture:** New `static-analyze.ts` module in `@yacad/lua` exporting `validateLuaSource(def)` that throws a single `LuaValidationError` carrying every issue found in one AST pass. A new `sandbox-globals.ts` module is the single source of truth for the sandbox identifier set, consumed by both the validator and the existing `WasmoonLuaRuntime`. Wired into the put pipeline on three boundaries: studio inspector (live feedback), studio session (pre-put guard), worker `putLuaDefinition` handler (defense in depth, new `validation-error` reply variant).

**Tech Stack:** TypeScript strict mode; `luaparse@^0.3.x` + `@types/luaparse`; vitest for unit/integration tests; Playwright for studio2 smoke tests.

**Spec:** [`docs/superpowers/specs/2026-05-28-lua-static-validation-design.md`](../specs/2026-05-28-lua-static-validation-design.md)

**Prerequisite:** `feat/studio-v2-foundation` must be merged to `main` before starting. The validator depends on `getKernelTypeDoc` / `ParamDoc.required` / `apps/studio2` from that branch.

---

## File structure

**Create:**
- `packages/lua/src/sandbox-globals.ts` — `SANDBOX_GLOBALS` constant + derived `SANDBOX_STRIP_SCRIPT`.
- `packages/lua/src/sandbox-globals.test.ts` — pin whitelist contents; assert strip-script derivation correctness.
- `packages/lua/src/static-analyze.ts` — `validateLuaSource` + `LuaValidationError` + `ValidationIssue` + `ValidationCategory`. Single-pass AST walker with Phase-1 alias pre-walk.
- `packages/lua/src/static-analyze.test.ts` — per-category coverage; multi-issue collection; scope handling.

**Modify:**
- `packages/lua/package.json` — add `luaparse` runtime dep + `@types/luaparse` dev dep.
- `packages/lua/src/wasmoon-runtime.ts` — replace inline strip script with `engine.doString(SANDBOX_STRIP_SCRIPT)`.
- `packages/lua/src/wasmoon-runtime.test.ts` — new parity test: post-`installSandbox` `_G` equals `SANDBOX_GLOBALS.topLevel`.
- `packages/lua/src/index.ts` — re-export the validator surface and sandbox-globals.
- `packages/worker/src/host.ts` — validate in `handlePutLuaDefinition` before storing; reply with `validation-error` variant on failure.
- `packages/worker/src/protocol.ts` (whatever its exact name is — see Task 17) — add `ValidationErrorResponse` reply variant.
- `packages/worker/src/client.ts` — `putLuaDefinition` throws `LuaValidationError` on `validation-error` reply.
- `packages/worker/src/host.test.ts` — assert valid def stored / invalid def rejected with structured issues.
- `apps/studio2/src/state/session.svelte.ts` (or sibling) — wrap `addBlob` for LuaDefinitions with a pre-put `validateLuaSource` guard.
- `apps/studio2/src/ui/inspectors/LuaInspector.svelte` — render `ValidationIssue[]` from a `validateLuaSource` call on the current definition.
- `apps/studio2/e2e/lua-validation.spec.ts` — Playwright smoke test for the inspector wire-up.
- `packages/e2e/src/scenes.test.ts` (or wherever the existing scene-snapshot suite lives) — assert every Lua fixture's definition validates clean.

---

## Conventions

- **TDD per task**: write failing test → run it (verify fail) → write minimal impl → run test (verify pass) → commit. Each task ends in exactly one commit.
- **Commands run from repo root** unless noted: `pnpm --filter @yacad/lua test` for the Lua package, etc. The repo's `pnpm test` runs all packages; use the filtered form for fast feedback while iterating.
- **Commit messages** follow the existing repo style: `feat(lua-validate): …`, `refactor(lua-runtime): …`, `test(lua-validate): …`. The body is one short sentence; no `Co-Authored-By` trailers.
- **No emoji in commits or comments** (per project convention).

---

## Task 0: Pre-flight — verify foundation merged, branch, install deps

**Files:**
- Modify: `packages/lua/package.json`
- Modify: `pnpm-lock.yaml` (regenerated)

- [ ] **Step 1: Verify foundation merged**

Run from repo root:
```bash
git fetch origin
git checkout main
git pull --ff-only
grep -q 'getKernelTypeDoc' packages/dag/src/index.ts && echo "OK: foundation merged" || echo "MISSING: foundation not yet on main"
grep -q "required: boolean" packages/dag/src/schema-docs.ts && echo "OK: ParamDoc.required present" || echo "MISSING: ParamDoc.required"
test -d apps/studio2 && echo "OK: studio2 present" || echo "MISSING: apps/studio2"
```

All four lines should print `OK`. If any prints `MISSING`, the foundation merge isn't complete yet — stop and resolve before continuing.

- [ ] **Step 2: Create feature branch**

```bash
git checkout -b feat/lua-static-validation
```

- [ ] **Step 3: Add luaparse + type dep to `@yacad/lua`**

Edit `packages/lua/package.json` — add to `dependencies` and `devDependencies`:
```json
{
  "dependencies": {
    "luaparse": "^0.3.1"
  },
  "devDependencies": {
    "@types/luaparse": "^0.2.12"
  }
}
```
(Keep other entries unchanged. Sort keys alphabetically per existing convention.)

- [ ] **Step 4: Install**

Run from repo root:
```bash
pnpm install
```
Expected: `pnpm-lock.yaml` updates with `luaparse` and `@types/luaparse` entries. No errors.

- [ ] **Step 5: Verify type resolution**

```bash
pnpm --filter @yacad/lua exec tsc --noEmit
```
Expected: clean (no errors). luaparse types should resolve without needing the augmentation shim yet — we'll add that only if a real-world walker code path needs it.

- [ ] **Step 6: Commit**

```bash
git add packages/lua/package.json pnpm-lock.yaml
git commit -m "chore(lua): add luaparse dependency for static validation"
```

---

## Task 1: Sandbox globals constant — `topLevel` set

**Files:**
- Create: `packages/lua/src/sandbox-globals.ts`
- Create: `packages/lua/src/sandbox-globals.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/lua/src/sandbox-globals.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SANDBOX_GLOBALS } from './sandbox-globals';

describe('SANDBOX_GLOBALS.topLevel', () => {
  it('includes the three library tables', () => {
    expect(SANDBOX_GLOBALS.topLevel.has('math')).toBe(true);
    expect(SANDBOX_GLOBALS.topLevel.has('string')).toBe(true);
    expect(SANDBOX_GLOBALS.topLevel.has('table')).toBe(true);
  });

  it('includes the three injected APIs', () => {
    expect(SANDBOX_GLOBALS.topLevel.has('geo')).toBe(true);
    expect(SANDBOX_GLOBALS.topLevel.has('inputs')).toBe(true);
    expect(SANDBOX_GLOBALS.topLevel.has('params')).toBe(true);
  });

  it('includes base-library entries that survive the strip', () => {
    for (const name of [
      'assert', 'error', 'getmetatable', 'ipairs', 'next', 'pairs',
      'pcall', 'rawequal', 'rawget', 'rawlen', 'rawset', 'select',
      'setmetatable', 'tonumber', 'tostring', 'type', 'xpcall',
    ]) {
      expect(SANDBOX_GLOBALS.topLevel.has(name)).toBe(true);
    }
  });

  it('excludes stripped base-library entries', () => {
    for (const name of [
      'dofile', 'loadfile', 'load', 'loadstring', 'require',
      'print', 'collectgarbage',
    ]) {
      expect(SANDBOX_GLOBALS.topLevel.has(name)).toBe(false);
    }
  });

  it('excludes the dynamic-global escape hatches', () => {
    expect(SANDBOX_GLOBALS.topLevel.has('_G')).toBe(false);
    expect(SANDBOX_GLOBALS.topLevel.has('_ENV')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @yacad/lua vitest run sandbox-globals
```
Expected: FAIL — `Cannot find module './sandbox-globals'`.

- [ ] **Step 3: Implement `topLevel`**

`packages/lua/src/sandbox-globals.ts`:
```ts
/**
 * Single source of truth for the Lua sandbox's allowed identifiers.
 * Consumed by both WasmoonLuaRuntime (to derive the strip script that nils
 * impure entries) and the static validator (to reject references to anything
 * outside this set).
 */
export const SANDBOX_GLOBALS: {
  /** Identifiers visible at the top level of user Lua after installSandbox. */
  readonly topLevel: ReadonlySet<string>;
  /** Per-library allowed member names. Library names absent from this map
   *  carry no member restrictions beyond existence (geo.* is registry-driven). */
  readonly libraryMembers: ReadonlyMap<string, ReadonlySet<string>>;
} = {
  topLevel: new Set<string>([
    // Library tables
    'math', 'string', 'table',
    // Injected APIs
    'geo', 'inputs', 'params',
    // Surviving base-library entries (Lua 5.1-ish base as exposed by Wasmoon)
    'assert', 'error', 'getmetatable', 'ipairs', 'next', 'pairs',
    'pcall', 'rawequal', 'rawget', 'rawlen', 'rawset', 'select',
    'setmetatable', 'tonumber', 'tostring', 'type', 'unpack', 'xpcall',
    '_VERSION',
  ]),
  libraryMembers: new Map(), // filled in Task 2
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @yacad/lua vitest run sandbox-globals
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/sandbox-globals.ts packages/lua/src/sandbox-globals.test.ts
git commit -m "feat(lua): SANDBOX_GLOBALS topLevel constant + tests"
```

---

## Task 2: Sandbox globals — `libraryMembers` map

**Files:**
- Modify: `packages/lua/src/sandbox-globals.ts`
- Modify: `packages/lua/src/sandbox-globals.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `sandbox-globals.test.ts`:
```ts
describe('SANDBOX_GLOBALS.libraryMembers', () => {
  it('math allows common functions but excludes randomseed', () => {
    const math = SANDBOX_GLOBALS.libraryMembers.get('math');
    expect(math).toBeDefined();
    for (const name of ['abs', 'ceil', 'cos', 'floor', 'max', 'min', 'pi', 'random', 'sin', 'sqrt']) {
      expect(math!.has(name)).toBe(true);
    }
    expect(math!.has('randomseed')).toBe(false);
  });

  it('string allows common functions but excludes dump', () => {
    const str = SANDBOX_GLOBALS.libraryMembers.get('string');
    expect(str).toBeDefined();
    for (const name of ['byte', 'char', 'find', 'format', 'gmatch', 'gsub', 'len', 'sub']) {
      expect(str!.has(name)).toBe(true);
    }
    expect(str!.has('dump')).toBe(false);
  });

  it('table allows all standard members', () => {
    const tbl = SANDBOX_GLOBALS.libraryMembers.get('table');
    expect(tbl).toBeDefined();
    for (const name of ['concat', 'insert', 'remove', 'sort', 'unpack']) {
      expect(tbl!.has(name)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @yacad/lua vitest run sandbox-globals
```
Expected: 3 new tests FAIL — `libraryMembers.get('math')` returns undefined.

- [ ] **Step 3: Populate `libraryMembers`**

Edit `packages/lua/src/sandbox-globals.ts` — replace `libraryMembers: new Map()` with:

```ts
  libraryMembers: new Map<string, ReadonlySet<string>>([
    ['math', new Set([
      // Lua 5.3+ math, minus randomseed (seeded by the runtime, then nilled)
      'abs', 'acos', 'asin', 'atan', 'ceil', 'cos', 'deg', 'exp', 'floor',
      'fmod', 'huge', 'log', 'max', 'maxinteger', 'min', 'mininteger',
      'modf', 'pi', 'rad', 'random', 'sin', 'sqrt', 'tan', 'tointeger',
      'type', 'ult',
    ])],
    ['string', new Set([
      // Lua 5.3+ string, minus dump (bytecode export — sandbox escape risk)
      'byte', 'char', 'find', 'format', 'gmatch', 'gsub', 'len', 'lower',
      'match', 'pack', 'packsize', 'rep', 'reverse', 'sub', 'unpack', 'upper',
    ])],
    ['table', new Set([
      'concat', 'insert', 'move', 'pack', 'remove', 'sort', 'unpack',
    ])],
  ]),
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @yacad/lua vitest run sandbox-globals
```
Expected: PASS (8 tests total now).

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/sandbox-globals.ts packages/lua/src/sandbox-globals.test.ts
git commit -m "feat(lua): SANDBOX_GLOBALS libraryMembers (math/string/table)"
```

---

## Task 3: `SANDBOX_STRIP_SCRIPT` derivation

**Files:**
- Modify: `packages/lua/src/sandbox-globals.ts`
- Modify: `packages/lua/src/sandbox-globals.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `sandbox-globals.test.ts`:
```ts
import { SANDBOX_STRIP_SCRIPT } from './sandbox-globals';

describe('SANDBOX_STRIP_SCRIPT', () => {
  it('nils out every base-library entry NOT in topLevel that Wasmoon loads', () => {
    // Wasmoon's Base lib brings in these unwanted entries; verify each is stripped.
    for (const name of [
      'dofile', 'loadfile', 'load', 'loadstring', 'require',
      'print', 'collectgarbage',
    ]) {
      expect(SANDBOX_STRIP_SCRIPT).toMatch(new RegExp(`^${name}\\s*=\\s*nil\\s*$`, 'm'));
    }
  });

  it('nils math.randomseed (stripped after the runtime seeds it)', () => {
    expect(SANDBOX_STRIP_SCRIPT).toMatch(/^math\.randomseed\s*=\s*nil\s*$/m);
  });

  it('nils string.dump', () => {
    expect(SANDBOX_STRIP_SCRIPT).toMatch(/^string\.dump\s*=\s*nil\s*$/m);
  });

  it('does NOT nil anything in topLevel', () => {
    for (const name of SANDBOX_GLOBALS.topLevel) {
      // Top-level name = nil would obviously kill the sandbox; assert absent.
      expect(SANDBOX_STRIP_SCRIPT).not.toMatch(new RegExp(`^${name}\\s*=\\s*nil`, 'm'));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @yacad/lua vitest run sandbox-globals
```
Expected: FAIL — `SANDBOX_STRIP_SCRIPT` is not exported.

- [ ] **Step 3: Implement strip-script derivation**

Append to `packages/lua/src/sandbox-globals.ts`:

```ts
/**
 * Lua source executed by the runtime AFTER loadLibrary(Base|Math|String|Table)
 * to nil out every identifier brought in by those libraries that is NOT in the
 * whitelist. Derived once at module load from SANDBOX_GLOBALS so the runtime
 * and validator cannot drift.
 *
 * The script does NOT nil entries that aren't in the loaded libraries to begin
 * with (e.g., `os` isn't loaded so doesn't need stripping).
 */
export const SANDBOX_STRIP_SCRIPT: string = (() => {
  // Entries that Wasmoon's LuaLibraries.Base brings in. Pinned here rather than
  // discovered at runtime because the validator runs without Wasmoon.
  const baseLibrary = new Set<string>([
    'assert', 'collectgarbage', 'dofile', 'error', 'getmetatable',
    'ipairs', 'load', 'loadfile', 'loadstring', 'next', 'pairs',
    'pcall', 'print', 'rawequal', 'rawget', 'rawlen', 'rawset',
    'require', 'select', 'setmetatable', 'tonumber', 'tostring',
    'type', 'unpack', 'xpcall', '_G', '_VERSION',
  ]);

  // Library member sets as opened by loadLibrary, minus our whitelist.
  const libraryAvailable = new Map<string, ReadonlySet<string>>([
    ['math', new Set([
      'abs', 'acos', 'asin', 'atan', 'ceil', 'cos', 'deg', 'exp', 'floor',
      'fmod', 'huge', 'log', 'max', 'maxinteger', 'min', 'mininteger',
      'modf', 'pi', 'rad', 'random', 'randomseed', 'sin', 'sqrt', 'tan',
      'tointeger', 'type', 'ult',
    ])],
    ['string', new Set([
      'byte', 'char', 'dump', 'find', 'format', 'gmatch', 'gsub', 'len',
      'lower', 'match', 'pack', 'packsize', 'rep', 'reverse', 'sub',
      'unpack', 'upper',
    ])],
    ['table', new Set([
      'concat', 'insert', 'move', 'pack', 'remove', 'sort', 'unpack',
    ])],
  ]);

  const lines: string[] = [];

  // Strip top-level base entries not in the whitelist.
  for (const name of baseLibrary) {
    if (!SANDBOX_GLOBALS.topLevel.has(name)) {
      lines.push(`${name} = nil`);
    }
  }

  // Strip per-library members not in the per-library whitelist.
  for (const [libName, available] of libraryAvailable) {
    const allowed = SANDBOX_GLOBALS.libraryMembers.get(libName) ?? new Set();
    for (const member of available) {
      if (!allowed.has(member)) {
        lines.push(`${libName}.${member} = nil`);
      }
    }
  }

  return lines.join('\n');
})();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @yacad/lua vitest run sandbox-globals
```
Expected: PASS (12 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/sandbox-globals.ts packages/lua/src/sandbox-globals.test.ts
git commit -m "feat(lua): SANDBOX_STRIP_SCRIPT derived from whitelist"
```

---

## Task 4: Refactor `WasmoonLuaRuntime` to consume `SANDBOX_STRIP_SCRIPT`

**Files:**
- Modify: `packages/lua/src/wasmoon-runtime.ts`

- [ ] **Step 1: Verify the existing runtime tests pass**

```bash
pnpm --filter @yacad/lua vitest run wasmoon-runtime
```
Expected: PASS — the existing tests are the safety net for this refactor.

- [ ] **Step 2: Refactor the strip-script call**

Edit `packages/lua/src/wasmoon-runtime.ts`. At the top of the file, add:
```ts
import { SANDBOX_STRIP_SCRIPT } from './sandbox-globals';
```

In `installSandbox`, find the block beginning with `// 3. Strip impure / unwanted entries AFTER seeding.` and replace the inline `doString` block:

**Before:**
```ts
  // 3. Strip impure / unwanted entries AFTER seeding.
  //    Base library brings in load/loadfile/dofile/require/print which can escape the sandbox.
  //    We remove them explicitly here.
  await engine.doString(`
    math.randomseed = nil
    string.dump = nil
    dofile = nil
    loadfile = nil
    load = nil
    loadstring = nil
    require = nil
    print = nil
    collectgarbage = nil
  `);
```

**After:**
```ts
  // 3. Strip impure / unwanted entries AFTER seeding.
  //    Single source of truth: SANDBOX_STRIP_SCRIPT is derived from
  //    SANDBOX_GLOBALS, so runtime and validator cannot drift.
  await engine.doString(SANDBOX_STRIP_SCRIPT);
```

- [ ] **Step 3: Run the runtime tests**

```bash
pnpm --filter @yacad/lua vitest run wasmoon-runtime
```
Expected: PASS — behavior is identical because `SANDBOX_STRIP_SCRIPT` produces a superset of what the old inline script stripped (no behavioral regression possible; we strip every old-script entry plus any additional library members not in the whitelist).

- [ ] **Step 4: Commit**

```bash
git add packages/lua/src/wasmoon-runtime.ts
git commit -m "refactor(lua): runtime consumes SANDBOX_STRIP_SCRIPT (single source of truth)"
```

---

## Task 5: Runtime/validator parity test

**Files:**
- Modify: `packages/lua/src/wasmoon-runtime.test.ts`

- [ ] **Step 1: Find an existing test to model after**

Read `packages/lua/src/wasmoon-runtime.test.ts` and the sibling `wasmoon.smoke.test.ts`. The smoke test exercises a real Wasmoon engine; copy its setup pattern (factory, fresh engine, dispose).

- [ ] **Step 2: Write the failing parity test**

Append to `packages/lua/src/wasmoon-runtime.test.ts`:
```ts
import { SANDBOX_GLOBALS } from './sandbox-globals';

describe('sandbox-runtime parity', () => {
  it('post-installSandbox _G matches SANDBOX_GLOBALS.topLevel', async () => {
    const runtime = new WasmoonLuaRuntime();
    const def: LuaDefinition = {
      schema: { inputs: [], params: {}, output: '3d' },
      code: [
        'local names = {}',
        'for k, v in pairs(_G) do',
        '  if v ~= nil then names[#names + 1] = k end',
        'end',
        'table.sort(names)',
        'return { type = "box", params = { size = { 1, 1, 1 } }, children = {}, __sandbox_keys = names }',
      ].join('\n'),
    };
    const result = await runtime.evaluate(def, [], {}) as Record<string, unknown>;
    const actual = new Set(result['__sandbox_keys'] as string[]);

    // Parity: every name in actual must be in topLevel, and vice versa.
    const extras = [...actual].filter((n) => !SANDBOX_GLOBALS.topLevel.has(n));
    const missing = [...SANDBOX_GLOBALS.topLevel].filter((n) => !actual.has(n));
    expect({ extras, missing }).toEqual({ extras: [], missing: [] });
  });
});
```

Note: `unwrapNodeDoc` requires a `type` string, so the test wraps its enumerated names in a valid NodeDoc shell. The harmless `__sandbox_keys` extra field rides through the unwrap.

- [ ] **Step 3: Run the test**

```bash
pnpm --filter @yacad/lua vitest run wasmoon-runtime
```

Expected outcomes:
- **If parity holds**: PASS.
- **If `_G` contains entries not in `topLevel`**: FAIL with the extras listed. Update `SANDBOX_GLOBALS.topLevel` to include them (verify each is safe; if any is a sandbox-escape risk, add it to the strip script via `libraryMembers`/`baseLibrary` instead).
- **If `topLevel` claims entries that aren't in `_G`**: FAIL with the missing list. Either the strip script over-strips, or the whitelist over-claims — investigate.

This test is the drift-detection gate; getting it green now ensures any future change to either side is caught.

- [ ] **Step 4: Resolve any parity gap**

If Step 3 surfaced extras/missing, fix `sandbox-globals.ts` to match Wasmoon's actual base library content (whichever direction needs to change). Re-run until green.

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/wasmoon-runtime.test.ts packages/lua/src/sandbox-globals.ts
git commit -m "test(lua): runtime/validator parity test for SANDBOX_GLOBALS"
```

---

## Task 6: `static-analyze.ts` skeleton — types and error class

**Files:**
- Create: `packages/lua/src/static-analyze.ts`
- Create: `packages/lua/src/static-analyze.test.ts`

- [ ] **Step 1: Write failing tests for the error class**

`packages/lua/src/static-analyze.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { LuaValidationError, type ValidationIssue } from './static-analyze';

describe('LuaValidationError', () => {
  const sample = (over: Partial<ValidationIssue> = {}): ValidationIssue => ({
    category: 'sandbox-violation',
    message: 'unknown identifier',
    line: 1,
    column: 0,
    ...over,
  });

  it('exposes the issues array unchanged', () => {
    const issues = [sample({ message: 'A' }), sample({ message: 'B' })];
    const err = new LuaValidationError(issues);
    expect(err.issues).toEqual(issues);
    expect(err.name).toBe('LuaValidationError');
    expect(err).toBeInstanceOf(Error);
  });

  it('summarizes first three issues in the message', () => {
    const issues = [
      sample({ message: 'first', line: 2 }),
      sample({ message: 'second', line: 5 }),
      sample({ message: 'third', line: 9 }),
    ];
    const err = new LuaValidationError(issues);
    expect(err.message).toContain('first');
    expect(err.message).toContain('second');
    expect(err.message).toContain('third');
    expect(err.message).toMatch(/line 2/);
    expect(err.message).not.toMatch(/and \d+ more/);
  });

  it('truncates after three issues with "and N more"', () => {
    const issues = Array.from({ length: 7 }, (_, i) =>
      sample({ message: `m${i}`, line: i + 1 })
    );
    const err = new LuaValidationError(issues);
    expect(err.message).toContain('m0');
    expect(err.message).toContain('m1');
    expect(err.message).toContain('m2');
    expect(err.message).not.toContain('m3');
    expect(err.message).toMatch(/and 4 more/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the skeleton**

`packages/lua/src/static-analyze.ts`:
```ts
import type { LuaDefinition } from './schema';

export type ValidationCategory =
  | 'unparseable'
  | 'unsupported-syntax'
  | 'undeclared-param'
  | 'undeclared-input'
  | 'sandbox-violation'
  | 'unknown-geo-type'
  | 'unknown-geo-param'
  | 'missing-geo-param'
  | 'unanalyzable-alias'
  | 'unanalyzable-access';

export interface ValidationIssue {
  readonly category: ValidationCategory;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly identifier?: string;
  readonly validNames?: readonly string[];
}

export class LuaValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(formatSummary(issues));
    this.name = 'LuaValidationError';
    this.issues = issues;
  }
}

function formatSummary(issues: readonly ValidationIssue[]): string {
  if (issues.length === 0) return 'LuaValidationError: 0 issues';
  const head = issues
    .slice(0, 3)
    .map((i) => `line ${i.line}: ${i.message}`)
    .join('; ');
  const more = issues.length > 3 ? `; and ${issues.length - 3} more` : '';
  return `${issues.length} validation issue${issues.length === 1 ? '' : 's'}: ${head}${more}`;
}

/** Static validation of a LuaDefinition. Throws LuaValidationError if any
 *  issues are found; otherwise returns normally. Deterministic, pure, safe
 *  for editor-time use. Full implementation lands across subsequent tasks. */
export function validateLuaSource(_def: LuaDefinition): void {
  // Stub — real implementation lands in Task 7+.
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/static-analyze.ts packages/lua/src/static-analyze.test.ts
git commit -m "feat(lua-validate): error class + types skeleton"
```

---

## Task 7: Parse-error handling — `unparseable` and `unsupported-syntax`

**Files:**
- Modify: `packages/lua/src/static-analyze.ts`
- Modify: `packages/lua/src/static-analyze.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `static-analyze.test.ts`:
```ts
import { validateLuaSource } from './static-analyze';
import type { LuaDefinition } from './schema';

const emptySchema = { inputs: [], params: {}, output: '3d' as const };
const def = (code: string): LuaDefinition => ({ schema: emptySchema, code });

describe('parse errors', () => {
  it('catches syntax errors as unparseable', () => {
    try {
      validateLuaSource(def('local x = '));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(LuaValidationError);
      const err = e as LuaValidationError;
      expect(err.issues.length).toBe(1);
      expect(err.issues[0]!.category).toBe('unparseable');
      expect(err.issues[0]!.line).toBeGreaterThan(0);
    }
  });

  it('flags Lua 5.4 <const> as unsupported-syntax', () => {
    try {
      validateLuaSource(def('local x <const> = 1\nreturn { type = "box" }'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues[0]!.category).toBe('unsupported-syntax');
      expect(err.issues[0]!.message).toMatch(/Lua 5\.4|<const>|attribute/i);
    }
  });

  it('passes well-formed empty programs without throwing', () => {
    expect(() => validateLuaSource(def('return { type = "box" }'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: the three new tests FAIL — `validateLuaSource` is still a stub.

- [ ] **Step 3: Implement parse-error handling**

Edit `packages/lua/src/static-analyze.ts`. Add at the top:
```ts
import * as luaparse from 'luaparse';
```

Replace the stub `validateLuaSource` body with:
```ts
export function validateLuaSource(def: LuaDefinition): void {
  const issues: ValidationIssue[] = [];

  let ast: luaparse.Chunk;
  try {
    ast = luaparse.parse(def.code, {
      luaVersion: '5.3',
      locations: true,
      comments: false,
      scope: false,
    });
  } catch (e) {
    issues.push(mapParseError(e));
    throw new LuaValidationError(issues);
  }

  // AST-walk phases land in Task 8+. For now, a well-parsed program produces
  // no issues.
  void ast;

  if (issues.length > 0) {
    throw new LuaValidationError(issues);
  }
}

function mapParseError(e: unknown): ValidationIssue {
  const err = e as { message?: string; line?: number; column?: number };
  const message = err.message ?? 'parse error';
  const line = typeof err.line === 'number' ? err.line : 1;
  // luaparse columns are 0-indexed; normalize to 1-indexed.
  const column = typeof err.column === 'number' ? err.column + 1 : 1;

  // Heuristic: detect Lua 5.4 attribute syntax. luaparse 5.3 mode rejects
  // `local x <const> = ...` with a message containing "<" near a local
  // declaration. The pattern is narrow enough to avoid false positives.
  if (/<\s*(const|close)\s*>/.test(message) || /unexpected symbol near '<'/.test(message)) {
    return {
      category: 'unsupported-syntax',
      message: `Lua 5.4 attributes (<const>/<close>) are not supported; use a plain local. (${message})`,
      line,
      column,
    };
  }

  return {
    category: 'unparseable',
    message,
    line,
    column,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: PASS. If the 5.4-attribute test fails, inspect luaparse's actual error message and adjust the heuristic. If luaparse rejects `<const>` with a different message shape, broaden the regex to match what it actually produces.

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/static-analyze.ts packages/lua/src/static-analyze.test.ts
git commit -m "feat(lua-validate): parse-error categorization (unparseable + unsupported-syntax)"
```

---

## Task 8: Scope tracker + Phase 1 alias pre-walk (direct aliases)

**Files:**
- Modify: `packages/lua/src/static-analyze.ts`
- Modify: `packages/lua/src/static-analyze.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `static-analyze.test.ts`:
```ts
describe('Phase 1 — direct aliases', () => {
  it('rejects local p = params', () => {
    try {
      validateLuaSource(def('local p = params\nreturn { type = "box" }'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const aliases = err.issues.filter((i) => i.category === 'unanalyzable-alias');
      expect(aliases.length).toBe(1);
      expect(aliases[0]!.identifier).toBe('p');
      expect(aliases[0]!.line).toBe(1);
    }
  });

  it('rejects local i = inputs and local g = geo', () => {
    try {
      validateLuaSource(def([
        'local i = inputs',
        'local g = geo',
        'return { type = "box" }',
      ].join('\n')));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const aliases = err.issues.filter((i) => i.category === 'unanalyzable-alias');
      expect(aliases.length).toBe(2);
      expect(aliases.map((a) => a.identifier).sort()).toEqual(['g', 'i']);
    }
  });

  it('does NOT flag local p = params.teeth (field read, not table alias)', () => {
    const d: LuaDefinition = {
      schema: { inputs: [], params: { teeth: { type: 'int', default: 8 } }, output: '3d' },
      code: 'local p = params.teeth\nreturn { type = "box" }',
    };
    expect(() => validateLuaSource(d)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: the three alias tests FAIL — Phase 1 not implemented yet.

- [ ] **Step 3: Implement Phase 1 + scope tracker**

Edit `packages/lua/src/static-analyze.ts`. Add a `Scope` class and Phase 1 walker. Replace the body of `validateLuaSource` (after the parse step) with:

```ts
  const scope = new Scope();
  const tainted = new Set<string>();
  walkPhase1(ast, scope, tainted, issues);

  // Phase 2 walker lands in subsequent tasks. For now, only Phase 1 issues
  // are collected.

  if (issues.length > 0) {
    throw new LuaValidationError(issues);
  }
```

Add below `mapParseError`:

```ts
/** Lexical scope tracker. Each frame is a Map<name, true> of locals declared
 *  in that frame. Functions and blocks push new frames. Lookup walks the
 *  stack from innermost outward; falls through to SANDBOX_GLOBALS.topLevel
 *  for the global tier. */
class Scope {
  private readonly frames: Set<string>[] = [new Set()];

  push(): void { this.frames.push(new Set()); }
  pop(): void {
    if (this.frames.length <= 1) throw new Error('scope underflow');
    this.frames.pop();
  }
  declareLocal(name: string): void {
    this.frames[this.frames.length - 1]!.add(name);
  }
  isLocal(name: string): boolean {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i]!.has(name)) return true;
    }
    return false;
  }
}

interface LocNode {
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
}

function locOf(n: LocNode): { line: number; column: number } {
  return n.loc
    ? { line: n.loc.start.line, column: n.loc.start.column + 1 }
    : { line: 1, column: 1 };
}

const SENTINEL_TABLES = new Set(['params', 'inputs', 'geo']);

function walkPhase1(
  ast: luaparse.Chunk,
  scope: Scope,
  tainted: Set<string>,
  issues: ValidationIssue[],
): void {
  visit(ast);

  function visit(node: any): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    switch (node.type) {
      case 'Chunk':
        for (const s of node.body) visit(s);
        return;

      case 'LocalStatement': {
        // For each `local name = init`, decide taint based on init expression.
        for (let i = 0; i < node.variables.length; i++) {
          const variable = node.variables[i];
          const init = node.init?.[i];
          if (init && isAliasExpr(init)) {
            issues.push({
              category: 'unanalyzable-alias',
              message: aliasMessage(init),
              ...locOf(variable),
              identifier: variable.name,
            });
            tainted.add(variable.name);
          }
          scope.declareLocal(variable.name);
        }
        return;
      }

      case 'FunctionDeclaration': {
        // Parameter names become locals in a new frame.
        scope.push();
        for (const p of node.parameters ?? []) {
          if (p.type === 'Identifier') scope.declareLocal(p.name);
        }
        for (const s of node.body ?? []) visit(s);
        scope.pop();
        return;
      }

      case 'DoStatement':
      case 'WhileStatement':
      case 'RepeatStatement':
      case 'IfStatement':
      case 'ForNumericStatement':
      case 'ForGenericStatement': {
        scope.push();
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'loc') continue;
          visit(node[key]);
        }
        scope.pop();
        return;
      }

      default: {
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'loc') continue;
          visit(node[key]);
        }
      }
    }
  }
}

function isAliasExpr(expr: any): boolean {
  if (!expr) return false;
  if (expr.type === 'Identifier' && SENTINEL_TABLES.has(expr.name)) return true;
  // Phase 1 catches `local b = geo.something` too — handled in Task 9.
  return false;
}

function aliasMessage(expr: any): string {
  const name = expr.name ?? 'sentinel';
  return `aliasing '${name}' to a local defeats static analysis; use direct access instead`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: PASS (the three alias tests plus the earlier ones).

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/static-analyze.ts packages/lua/src/static-analyze.test.ts
git commit -m "feat(lua-validate): Phase 1 direct aliases + scope tracker"
```

---

## Task 9: Phase 1 — geo-rooted MemberExpression aliases

**Files:**
- Modify: `packages/lua/src/static-analyze.ts`
- Modify: `packages/lua/src/static-analyze.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `static-analyze.test.ts`:
```ts
describe('Phase 1 — geo.X aliases', () => {
  it('rejects local b = geo.box', () => {
    try {
      validateLuaSource(def('local b = geo.box\nreturn { type = "box" }'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const aliases = err.issues.filter((i) => i.category === 'unanalyzable-alias');
      expect(aliases.length).toBe(1);
      expect(aliases[0]!.identifier).toBe('b');
    }
  });

  it('rejects local r = geo.rotate (any geo member, not just kernel types)', () => {
    try {
      validateLuaSource(def('local r = geo.rotate\nreturn { type = "box" }'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues.some((i) => i.category === 'unanalyzable-alias')).toBe(true);
    }
  });

  it('rejects local n = geo.node (the dynamic-dispatch primitive)', () => {
    try {
      validateLuaSource(def('local n = geo.node\nreturn { type = "box" }'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues.some((i) => i.category === 'unanalyzable-alias')).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: the three new tests FAIL — geo-rooted aliases not detected yet.

- [ ] **Step 3: Extend `isAliasExpr`**

In `packages/lua/src/static-analyze.ts`, replace `isAliasExpr` and `aliasMessage`:

```ts
function isAliasExpr(expr: any): boolean {
  if (!expr) return false;
  if (expr.type === 'Identifier' && SENTINEL_TABLES.has(expr.name)) return true;
  if (
    expr.type === 'MemberExpression' &&
    expr.indexer === '.' &&
    expr.base?.type === 'Identifier' &&
    expr.base.name === 'geo'
  ) {
    return true;
  }
  return false;
}

function aliasMessage(expr: any): string {
  if (expr.type === 'Identifier') {
    return `aliasing '${expr.name}' to a local defeats static analysis; use direct access instead`;
  }
  if (expr.type === 'MemberExpression') {
    const member = expr.identifier?.name ?? '?';
    return `aliasing 'geo.${member}' to a local defeats call-shape checks; call 'geo.${member}{...}' directly instead`;
  }
  return 'unanalyzable alias';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/static-analyze.ts packages/lua/src/static-analyze.test.ts
git commit -m "feat(lua-validate): Phase 1 geo-rooted MemberExpression aliases"
```

---

## Task 10: Phase 2 walker — sandbox identifier check

**Files:**
- Modify: `packages/lua/src/static-analyze.ts`
- Modify: `packages/lua/src/static-analyze.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `static-analyze.test.ts`:
```ts
describe('Phase 2 — sandbox identifier check', () => {
  it('flags os/io/require/load/dofile/print/_G/_ENV as sandbox-violation', () => {
    for (const id of ['os', 'io', 'require', 'load', 'dofile', 'print', '_G', '_ENV']) {
      try {
        validateLuaSource(def(`return ${id}`));
        throw new Error(`expected throw for ${id}`);
      } catch (e) {
        const err = e as LuaValidationError;
        const sv = err.issues.filter((i) => i.category === 'sandbox-violation');
        expect(sv.length).toBeGreaterThan(0);
        expect(sv.some((i) => i.identifier === id)).toBe(true);
      }
    }
  });

  it('allows whitelisted identifiers', () => {
    for (const id of ['math', 'string', 'table', 'pairs', 'ipairs', 'pcall', 'tostring', 'type']) {
      const d = def(`local x = ${id}\nreturn { type = "box" }`);
      // `local x = math` — math is a top-level whitelisted table, but x is now
      // a local. This will NOT trip Phase 1 (not in SENTINEL_TABLES) and
      // identifier resolution finds math in topLevel. No issue.
      expect(() => validateLuaSource(d)).not.toThrow();
    }
  });

  it('does not double-report on tainted locals', () => {
    try {
      validateLuaSource(def('local p = params\nreturn p.foo'));
    } catch (e) {
      const err = e as LuaValidationError;
      // Exactly one issue (the alias), not two (alias + sandbox-violation on p).
      const aliases = err.issues.filter((i) => i.category === 'unanalyzable-alias');
      const sv = err.issues.filter((i) => i.category === 'sandbox-violation');
      expect(aliases.length).toBe(1);
      expect(sv.length).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: the sandbox-identifier tests FAIL.

- [ ] **Step 3: Add Phase 2 walker**

In `packages/lua/src/static-analyze.ts`, add the import at the top:
```ts
import { SANDBOX_GLOBALS } from './sandbox-globals';
```

After the Phase 1 implementation, add the Phase 2 walker entry point. Replace the validator body's `// Phase 2 walker lands in subsequent tasks.` block with:

```ts
  walkPhase2(ast, scope, tainted, issues);
```

Append a `walkPhase2` function:

```ts
function walkPhase2(
  ast: luaparse.Chunk,
  scope: Scope,
  tainted: Set<string>,
  issues: ValidationIssue[],
): void {
  // Re-walk; scope state is shared with Phase 1's stack but rebuilt as we
  // descend (Phase 1 left it at the root frame).
  visit(ast);

  function visit(node: any): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }

    switch (node.type) {
      case 'Chunk':
        for (const s of node.body) visit(s);
        return;

      case 'LocalStatement': {
        // Locals are added to scope; init expressions are visited so nested
        // sandbox checks still happen (e.g., `local x = print()` flags print).
        for (let i = 0; i < node.variables.length; i++) {
          if (node.init?.[i]) visit(node.init[i]);
          scope.declareLocal(node.variables[i].name);
        }
        return;
      }

      case 'FunctionDeclaration': {
        scope.push();
        for (const p of node.parameters ?? []) {
          if (p.type === 'Identifier') scope.declareLocal(p.name);
        }
        for (const s of node.body ?? []) visit(s);
        scope.pop();
        return;
      }

      case 'DoStatement':
      case 'WhileStatement':
      case 'RepeatStatement':
      case 'IfStatement':
      case 'ForNumericStatement':
      case 'ForGenericStatement': {
        scope.push();
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'loc') continue;
          visit(node[key]);
        }
        scope.pop();
        return;
      }

      case 'Identifier': {
        // Free identifier (not part of MemberExpression base / LocalStatement
        // declarator — those cases skip this by handling Identifier inline).
        checkIdentifier(node);
        return;
      }

      default: {
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'loc') continue;
          visit(node[key]);
        }
      }
    }
  }

  function checkIdentifier(node: any): void {
    const name = node.name as string;
    if (scope.isLocal(name)) return; // tainted locals included — Phase 1 already reported
    if (SANDBOX_GLOBALS.topLevel.has(name)) return;
    issues.push({
      category: 'sandbox-violation',
      message: `'${name}' is not in the sandbox`,
      ...locOf(node),
      identifier: name,
    });
  }
}
```

Note: this initial walker visits `Identifier` nodes anywhere they appear, including inside MemberExpressions (where the base might also be an Identifier). That's correct: `os.time()` → the `os` Identifier is flagged. But `params.foo` → the `params` Identifier resolves to topLevel and passes; the `.foo` member is a separate concern handled in Task 11.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/static-analyze.ts packages/lua/src/static-analyze.test.ts
git commit -m "feat(lua-validate): Phase 2 sandbox identifier check"
```

---

## Task 11: Phase 2 — `params.X` / `inputs.X` MemberExpression checks

**Files:**
- Modify: `packages/lua/src/static-analyze.ts`
- Modify: `packages/lua/src/static-analyze.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `static-analyze.test.ts`:
```ts
describe('Phase 2 — params/inputs member checks', () => {
  const teethSchema = {
    inputs: [],
    params: { teeth: { type: 'int' as const, default: 8 }, radius: { type: 'number' as const, default: 5 } },
    output: '3d' as const,
  };

  it('allows declared params', () => {
    expect(() =>
      validateLuaSource({ schema: teethSchema, code: 'return { type = "box", params = { size = { params.teeth, params.radius, 1 } } }' })
    ).not.toThrow();
  });

  it('flags undeclared params with validNames', () => {
    try {
      validateLuaSource({ schema: teethSchema, code: 'return { type = "box", params = { x = params.tooth } }' });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const u = err.issues.find((i) => i.category === 'undeclared-param');
      expect(u).toBeDefined();
      expect(u!.identifier).toBe('tooth');
      expect(u!.validNames).toEqual(['teeth', 'radius']);
    }
  });

  const bodySchema = {
    inputs: [{ name: 'body', type: '3d' as const }],
    params: {},
    output: '3d' as const,
  };

  it('allows declared inputs', () => {
    expect(() =>
      validateLuaSource({ schema: bodySchema, code: 'return { type = "translate", params = {}, children = { inputs.body } }' })
    ).not.toThrow();
  });

  it('flags undeclared inputs with validNames', () => {
    try {
      validateLuaSource({ schema: bodySchema, code: 'return { type = "translate", children = { inputs.head } }' });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const u = err.issues.find((i) => i.category === 'undeclared-input');
      expect(u).toBeDefined();
      expect(u!.identifier).toBe('head');
      expect(u!.validNames).toEqual(['body']);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: the four new tests FAIL.

- [ ] **Step 3: Handle MemberExpression in Phase 2**

In `walkPhase2`'s `visit` function, add a case for `MemberExpression` BEFORE the default case:

```ts
      case 'MemberExpression': {
        // Walk base normally for nested checks (e.g., os.time → os is flagged
        // by the Identifier case).
        visit(node.base);
        // Special handling for params.X / inputs.X / geo.X.
        if (node.base?.type === 'Identifier' && !scope.isLocal(node.base.name)) {
          const baseName = node.base.name as string;
          const member = node.identifier?.name as string | undefined;
          if (member !== undefined) {
            if (baseName === 'params') checkParamMember(member, node);
            else if (baseName === 'inputs') checkInputMember(member, node);
            // geo.X handled in Task 13.
            else if (SANDBOX_GLOBALS.libraryMembers.has(baseName)) {
              checkLibraryMember(baseName, member, node);
            }
          }
        }
        return;
      }
```

Also pass `def` into `walkPhase2` so the checks can read `def.schema`. Update the call site:
```ts
  walkPhase2(ast, scope, tainted, issues, def);
```

Update the signature:
```ts
function walkPhase2(
  ast: luaparse.Chunk,
  scope: Scope,
  tainted: Set<string>,
  issues: ValidationIssue[],
  def: LuaDefinition,
): void {
```

Add the helper functions inside `walkPhase2`:

```ts
  function checkParamMember(name: string, node: any): void {
    const valid = Object.keys(def.schema.params);
    if (valid.includes(name)) return;
    issues.push({
      category: 'undeclared-param',
      message: `param '${name}' is not declared in schema.params`,
      ...locOf(node.identifier ?? node),
      identifier: name,
      validNames: valid,
    });
  }

  function checkInputMember(name: string, node: any): void {
    const valid = def.schema.inputs.map((i) => i.name);
    if (valid.includes(name)) return;
    issues.push({
      category: 'undeclared-input',
      message: `input '${name}' is not declared in schema.inputs`,
      ...locOf(node.identifier ?? node),
      identifier: name,
      validNames: valid,
    });
  }

  function checkLibraryMember(libName: string, member: string, node: any): void {
    const allowed = SANDBOX_GLOBALS.libraryMembers.get(libName);
    if (allowed && allowed.has(member)) return;
    issues.push({
      category: 'sandbox-violation',
      message: `'${libName}.${member}' is not allowed`,
      ...locOf(node.identifier ?? node),
      identifier: `${libName}.${member}`,
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/static-analyze.ts packages/lua/src/static-analyze.test.ts
git commit -m "feat(lua-validate): params/inputs/library member checks"
```

---

## Task 12: Phase 2 — `params[K]` / `inputs[K]` IndexExpression handling

**Files:**
- Modify: `packages/lua/src/static-analyze.ts`
- Modify: `packages/lua/src/static-analyze.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `static-analyze.test.ts`:
```ts
describe('Phase 2 — params[K] / inputs[K] index access', () => {
  const teethSchema = {
    inputs: [],
    params: { teeth: { type: 'int' as const, default: 8 } },
    output: '3d' as const,
  };

  it('allows literal-key bracket access on params', () => {
    expect(() =>
      validateLuaSource({ schema: teethSchema, code: 'return { type = "box", params = { x = params["teeth"] } }' })
    ).not.toThrow();
  });

  it('flags non-literal-key bracket access as unanalyzable-access', () => {
    try {
      validateLuaSource({ schema: teethSchema, code: 'local k = "teeth"\nreturn { type = "box", params = { x = params[k] } }' });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues.some((i) => i.category === 'unanalyzable-access')).toBe(true);
    }
  });

  it('flags literal bracket key not in schema as undeclared-param', () => {
    try {
      validateLuaSource({ schema: teethSchema, code: 'return { type = "box", params = { x = params["tooth"] } }' });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues.some((i) => i.category === 'undeclared-param')).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```

- [ ] **Step 3: Handle `IndexExpression` in Phase 2**

In `walkPhase2`'s `visit`, add a case before the default:

```ts
      case 'IndexExpression': {
        visit(node.base);
        visit(node.index);
        if (node.base?.type === 'Identifier' && !scope.isLocal(node.base.name)) {
          const baseName = node.base.name as string;
          if (baseName === 'params' || baseName === 'inputs' || baseName === 'geo') {
            if (node.index?.type === 'StringLiteral') {
              // Literal key — treat as MemberExpression with that name.
              const member = (node.index.value as string);
              if (baseName === 'params') checkParamMember(member, node.index);
              else if (baseName === 'inputs') checkInputMember(member, node.index);
              // geo[<literal>] handled in Task 13's geo-member dispatch.
            } else {
              issues.push({
                category: 'unanalyzable-access',
                message: `'${baseName}[...]' with a non-literal key cannot be statically checked`,
                ...locOf(node),
              });
            }
          }
        }
        return;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/static-analyze.ts packages/lua/src/static-analyze.test.ts
git commit -m "feat(lua-validate): params/inputs literal-key index access; reject dynamic keys"
```

---

## Task 13: Phase 2 — `geo.X` MemberExpression: unknown-geo-type

**Files:**
- Modify: `packages/lua/src/static-analyze.ts`
- Modify: `packages/lua/src/static-analyze.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `static-analyze.test.ts`:
```ts
describe('Phase 2 — geo.X member checks', () => {
  it('allows a registered kernel type', () => {
    expect(() => validateLuaSource(def('return geo.box({ size = { 1, 1, 1 } })'))).not.toThrow();
  });

  it('flags an unknown geo.X as unknown-geo-type', () => {
    try {
      validateLuaSource(def('return geo.bogus({})'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const u = err.issues.find((i) => i.category === 'unknown-geo-type');
      expect(u).toBeDefined();
      expect(u!.identifier).toBe('bogus');
    }
  });

  it('allows geo.node (the dynamic-dispatch primitive)', () => {
    // geo.node({...}) is the underlying primitive; it's a real geo entry
    // even though it's not in the registry. Don't flag it.
    expect(() => validateLuaSource(def('return geo.node("box", { size = { 1, 1, 1 } })'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```

- [ ] **Step 3: Extend MemberExpression handling for geo**

In `packages/lua/src/static-analyze.ts`, add the import:
```ts
import { getKernelTypeDoc, listNodeTypes } from '@yacad/dag';
```

In `walkPhase2`'s MemberExpression case, replace the `// geo.X handled in Task 13.` comment with:
```ts
            else if (baseName === 'geo' && member !== 'node') {
              checkGeoType(member, node);
            }
```

Add a helper inside `walkPhase2`:
```ts
  function checkGeoType(typeName: string, node: any): void {
    if (getKernelTypeDoc(typeName) !== undefined) return;
    issues.push({
      category: 'unknown-geo-type',
      message: `'geo.${typeName}' is not a registered kernel node type`,
      ...locOf(node.identifier ?? node),
      identifier: typeName,
      validNames: listNodeTypes()
        .filter((d) => d.kind === 'kernel' && !d.type.startsWith('__'))
        .map((d) => d.type),
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/static-analyze.ts packages/lua/src/static-analyze.test.ts
git commit -m "feat(lua-validate): geo.X unknown-geo-type check"
```

---

## Task 14: Phase 2 — `geo.<type>(params)` CallExpression: unknown/missing/unanalyzable

**Files:**
- Modify: `packages/lua/src/static-analyze.ts`
- Modify: `packages/lua/src/static-analyze.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `static-analyze.test.ts`:
```ts
describe('Phase 2 — geo.<type> call shape', () => {
  it('allows a valid call', () => {
    expect(() => validateLuaSource(def('return geo.box({ size = { 1, 1, 1 } })'))).not.toThrow();
  });

  it('flags unknown param keys with validNames', () => {
    try {
      validateLuaSource(def('return geo.box({ size = { 1, 1, 1 }, bogus = 5 })'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const u = err.issues.find((i) => i.category === 'unknown-geo-param');
      expect(u).toBeDefined();
      expect(u!.identifier).toBe('bogus');
      expect(u!.validNames!.length).toBeGreaterThan(0);
      expect(u!.validNames!).toContain('size');
    }
  });

  it('flags missing required params', () => {
    try {
      // box requires `size`; omitting it should fire missing-geo-param.
      validateLuaSource(def('return geo.box({})'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const u = err.issues.find((i) => i.category === 'missing-geo-param');
      expect(u).toBeDefined();
      expect(u!.validNames!).toContain('size');
    }
  });

  it('flags non-table first arg as unanalyzable-access', () => {
    try {
      validateLuaSource(def('local p = { size = { 1, 1, 1 } }\nreturn geo.box(p)'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues.some((i) => i.category === 'unanalyzable-access')).toBe(true);
    }
  });

  it('passes loop-built children (children arg is unchecked)', () => {
    const d = def([
      'local parts = {}',
      'for i = 1, 3 do',
      '  parts[#parts + 1] = geo.box({ size = { 1, 1, 1 } })',
      'end',
      'return geo.union({}, parts)',
    ].join('\n'));
    expect(() => validateLuaSource(d)).not.toThrow();
  });

  it('handles table-call syntax geo.box{...}', () => {
    expect(() => validateLuaSource(def('return geo.box{ size = { 1, 1, 1 } }'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```

- [ ] **Step 3: Handle CallExpression / TableCallExpression for geo.<type>**

In `walkPhase2`'s `visit`, add cases before the default:

```ts
      case 'CallExpression':
      case 'TableCallExpression':
      case 'StringCallExpression': {
        // Walk base (e.g., geo.box → checked as MemberExpression above) and args.
        visit(node.base);
        const args = argsOf(node);
        for (const a of args) visit(a);
        // Inspect geo.<type> calls for shape.
        if (isGeoTypeCall(node)) {
          checkGeoCallShape(node, args);
        }
        return;
      }
```

Add helpers inside `walkPhase2`:

```ts
  function argsOf(node: any): any[] {
    if (node.type === 'CallExpression') return node.arguments ?? [];
    if (node.type === 'TableCallExpression') return [node.arguments];
    if (node.type === 'StringCallExpression') return [node.argument];
    return [];
  }

  function isGeoTypeCall(node: any): boolean {
    const base = node.base;
    return (
      base?.type === 'MemberExpression' &&
      base.indexer === '.' &&
      base.base?.type === 'Identifier' &&
      base.base.name === 'geo' &&
      !scope.isLocal('geo') &&
      base.identifier?.name !== 'node'
    );
  }

  function checkGeoCallShape(node: any, args: any[]): void {
    const typeName = node.base.identifier.name as string;
    const doc = getKernelTypeDoc(typeName);
    if (!doc) return; // already reported as unknown-geo-type
    const paramsArg = args[0];
    const required = doc.paramSchema.filter((p) => p.required).map((p) => p.name);
    const all = doc.paramSchema.map((p) => p.name);

    if (paramsArg === undefined) {
      // No args at all — every required param is missing.
      if (required.length > 0) {
        issues.push({
          category: 'missing-geo-param',
          message: `geo.${typeName} missing required param${required.length === 1 ? '' : 's'}: ${required.join(', ')}`,
          ...locOf(node),
          validNames: required,
        });
      }
      return;
    }
    if (paramsArg.type !== 'TableConstructorExpression') {
      issues.push({
        category: 'unanalyzable-access',
        message: `geo.${typeName}(...) first argument must be a table literal so its keys can be checked statically`,
        ...locOf(paramsArg),
      });
      return;
    }
    const presentKeys = new Set<string>();
    for (const field of paramsArg.fields ?? []) {
      if (field.type === 'TableKeyString') {
        const key = field.key?.name as string | undefined;
        if (key === undefined) continue;
        presentKeys.add(key);
        if (!all.includes(key)) {
          issues.push({
            category: 'unknown-geo-param',
            message: `geo.${typeName} has no param '${key}'`,
            ...locOf(field.key ?? field),
            identifier: key,
            validNames: all,
          });
        }
      }
      // TableKey (`[expr] = ...`) and TableValue (positional) are not
      // statically resolvable to param names; treat presence as nothing.
    }
    const missing = required.filter((r) => !presentKeys.has(r));
    if (missing.length > 0) {
      issues.push({
        category: 'missing-geo-param',
        message: `geo.${typeName} missing required param${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
        ...locOf(paramsArg),
        validNames: missing,
      });
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/static-analyze.ts packages/lua/src/static-analyze.test.ts
git commit -m "feat(lua-validate): geo.<type> call-shape checks (unknown/missing/unanalyzable)"
```

---

## Task 15: Scope handling — shadowing + multi-issue ordering

**Files:**
- Modify: `packages/lua/src/static-analyze.test.ts`

- [ ] **Step 1: Add tests for shadowing + ordering**

Append to `static-analyze.test.ts`:
```ts
describe('scope handling', () => {
  it('shadowing: local params silently overrides the sandbox params', () => {
    const d = def([
      'local params = { teeth = 8 }',
      'return { type = "box", params = { size = { params.teeth, 1, 1 } } }',
    ].join('\n'));
    // Inner `params.teeth` resolves to the local shadow, not the schema.
    // No issue should fire even though schema.params is empty.
    expect(() => validateLuaSource(d)).not.toThrow();
  });

  it('nested function params shadow correctly', () => {
    const d = def([
      'local function f(params)',
      '  return params.x',
      'end',
      'return { type = "box", params = { size = { f({ x = 1 }), 1, 1 } } }',
    ].join('\n'));
    expect(() => validateLuaSource(d)).not.toThrow();
  });

  it('for-loop variable scoped to the loop body', () => {
    const d = def([
      'for i = 1, 3 do',
      '  local x = i',
      'end',
      // After the loop, i is out of scope. Referencing it should hit
      // sandbox-violation (no such global).
      'return { type = "box", params = { size = { i, 1, 1 } } }',
    ].join('\n'));
    try {
      validateLuaSource(d);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues.some((iss) => iss.category === 'sandbox-violation' && iss.identifier === 'i')).toBe(true);
    }
  });
});

describe('multi-issue collection', () => {
  it('collects issues across categories in source order', () => {
    const teethSchema = {
      inputs: [{ name: 'body', type: '3d' as const }],
      params: { teeth: { type: 'int' as const, default: 8 } },
      output: '3d' as const,
    };
    const code = [
      'local p = params',                             // line 1 — unanalyzable-alias
      'local bad = os.time()',                        // line 2 — sandbox-violation 'os'
      'local bogus = inputs.head',                    // line 3 — undeclared-input
      'return geo.bogus({ size = { params.tooth, 1, 1 } })',  // line 4 — unknown-geo-type + undeclared-param
    ].join('\n');
    try {
      validateLuaSource({ schema: teethSchema, code });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      // Expect at least one issue per category present in the source.
      const cats = new Set(err.issues.map((i) => i.category));
      expect(cats.has('unanalyzable-alias')).toBe(true);
      expect(cats.has('sandbox-violation')).toBe(true);
      expect(cats.has('undeclared-input')).toBe(true);
      expect(cats.has('unknown-geo-type')).toBe(true);
      // Issues appear in source order (by line).
      const lines = err.issues.map((i) => i.line);
      const sorted = [...lines].sort((a, b) => a - b);
      expect(lines).toEqual(sorted);
    }
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @yacad/lua vitest run static-analyze
```

If they pass, the existing walker already handles these correctly (the recursive visit naturally produces source-ordered issues, and `Scope.push/pop` handles shadowing).

If any fail, the fix is in the walker:
- **Shadowing**: ensure `LocalStatement` adds the local to scope BEFORE visiting subsequent statements (Task 10's walker does this in-order). If `local params = ...` then `return params.x` reports `undeclared-param`, the bug is that `params.x` is checked against schema even though `params` is now a local. Fix: in the MemberExpression case, gate the `params`/`inputs`/`geo` dispatch on `!scope.isLocal(baseName)`.
- **For-loop scoping**: ensure `ForNumericStatement`/`ForGenericStatement` push a frame, declare the loop variable, recurse into the body, then pop. Both Phase 1 and Phase 2 walkers should do this (Task 10 includes them).
- **Source order**: a depth-first recursive walk produces source order naturally; no sort needed.

Apply minimal fixes until all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/lua/src/static-analyze.ts packages/lua/src/static-analyze.test.ts
git commit -m "test(lua-validate): scope handling + multi-issue ordering"
```

---

## Task 16: Re-export validator surface from `@yacad/lua`

**Files:**
- Modify: `packages/lua/src/index.ts`

- [ ] **Step 1: Check the current exports**

Read `packages/lua/src/index.ts`. It currently re-exports `schema`, `canonical`, `validate`, `runtime`, `geo`, `wasmoon-runtime`, `node-type`, `geo-docs`.

- [ ] **Step 2: Add the validator + sandbox-globals exports**

Edit `packages/lua/src/index.ts`. Add at the bottom (alphabetical with the rest):
```ts
export * from './sandbox-globals';
export * from './static-analyze';
```

- [ ] **Step 3: Verify package builds**

```bash
pnpm --filter @yacad/lua exec tsc --noEmit
```
Expected: clean. If any external consumer accidentally re-exported a colliding name, the build catches it; fix at the colliding site (rename or use explicit re-export).

- [ ] **Step 4: Run all `@yacad/lua` tests**

```bash
pnpm --filter @yacad/lua test
```
Expected: PASS (every test from Tasks 1–15 plus existing).

- [ ] **Step 5: Commit**

```bash
git add packages/lua/src/index.ts
git commit -m "feat(lua): export validator + sandbox-globals from index"
```

---

## Task 17: Worker `putLuaDefinition` validates before storing

**Files:**
- Modify: `packages/worker/src/host.ts`
- Modify: `packages/worker/src/protocol.ts` (or wherever request/response types live — discover via grep)
- Modify: `packages/worker/src/host.test.ts`
- Modify: `packages/worker/src/client.ts`

- [ ] **Step 1: Locate the protocol types**

```bash
grep -rn 'PutLuaDefinitionRequest\|OkResponse' packages/worker/src/ | head -10
```
This will name the file holding the request/response unions (likely `protocol.ts`). All edits below assume that file; substitute the real path if it differs.

- [ ] **Step 2: Add failing test for worker rejection**

Append to `packages/worker/src/host.test.ts` (study the existing `putLuaDefinition` test for harness setup):

```ts
import { LuaValidationError } from '@yacad/lua';

describe('putLuaDefinition validation', () => {
  it('rejects a definition with an undeclared param reference', async () => {
    const scope = makeScope(); // use the same factory the other tests use
    const host = createHost(scope);
    // ... init step exactly as other tests do (resolve manifold url, etc.) ...

    const bad: LuaDefinition = {
      schema: { inputs: [], params: {}, output: '3d' },
      code: 'return { type = "box", params = { size = { params.teeth, 1, 1 } } }',
    };
    const hash = await hashLuaDefinition(bad, defaultHasher);

    const reply = await new Promise<any>((resolve) => {
      scope.postMessage = (msg: any) => { if (msg.id === 99) resolve(msg); };
      scope.onmessage!({ data: { id: 99, kind: 'putLuaDefinition', hash, definition: bad } });
    });

    expect(reply.kind).toBe('validation-error');
    expect(reply.issues).toBeDefined();
    expect(Array.isArray(reply.issues)).toBe(true);
    expect(reply.issues.length).toBeGreaterThan(0);
    expect(reply.issues[0].category).toBe('undeclared-param');
  });

  it('still accepts a valid definition', async () => {
    // Mirror the existing "responds ok to putLuaDefinition" test exactly.
    // No new behavior expected.
  });
});
```

(Adapt to match the actual harness pattern in `host.test.ts` — the helper names and scope setup likely differ in detail; use the existing tests as the canonical pattern.)

- [ ] **Step 3: Run tests to verify the new one fails**

```bash
pnpm --filter @yacad/worker vitest run host
```
Expected: the new test FAILS with `reply.kind === 'ok'` instead of `'validation-error'`.

- [ ] **Step 4: Add `ValidationErrorResponse` to the protocol**

In `packages/worker/src/protocol.ts` (or the equivalent), add:
```ts
import type { ValidationIssue } from '@yacad/lua';

export interface ValidationErrorResponse {
  readonly id: number;
  readonly kind: 'validation-error';
  readonly issues: readonly ValidationIssue[];
}
```

Include `ValidationErrorResponse` in whatever discriminated `Response` union the file exports.

- [ ] **Step 5: Wire validation into the handler**

In `packages/worker/src/host.ts`, modify `handlePutLuaDefinition`:
```ts
import { validateLuaSource, LuaValidationError, type LuaDefinition } from '@yacad/lua';

function handlePutLuaDefinition(
  scope: WorkerScope,
  luaDefs: Map<string, LuaDefinition>,
  req: PutLuaDefinitionRequest,
): void {
  try {
    validateLuaSource(req.definition);
  } catch (err) {
    if (err instanceof LuaValidationError) {
      const res: ValidationErrorResponse = { id: req.id, kind: 'validation-error', issues: err.issues };
      scope.postMessage(res);
      return;
    }
    throw err;
  }
  luaDefs.set(req.hash, req.definition);
  const res: OkResponse = { id: req.id, kind: 'ok' };
  scope.postMessage(res);
}
```

- [ ] **Step 6: Update `WorkerClient.putLuaDefinition` to surface the error**

In `packages/worker/src/client.ts`, change `putLuaDefinition` to detect the `validation-error` reply and throw a reconstituted `LuaValidationError`:
```ts
import { LuaValidationError, type LuaDefinition } from '@yacad/lua';

async putLuaDefinition(hash: string, definition: LuaDefinition): Promise<void> {
  const res = await this.send({ id: 0, kind: 'putLuaDefinition', hash, definition });
  if (res.kind === 'validation-error') {
    throw new LuaValidationError(res.issues);
  }
  // res.kind === 'ok' → fall through; other kinds shouldn't appear here.
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
pnpm --filter @yacad/worker vitest run host
pnpm --filter @yacad/worker test
```
Expected: PASS (including the existing client tests, which still see `ok` for valid definitions).

- [ ] **Step 8: Commit**

```bash
git add packages/worker/src/host.ts packages/worker/src/protocol.ts packages/worker/src/client.ts packages/worker/src/host.test.ts
git commit -m "feat(worker): validate LuaDefinitions in putLuaDefinition handler"
```

---

## Task 18: Studio session — pre-put guard on Lua definitions

**Files:**
- Discover: how studio2 stores LuaDefinitions (likely a method on `DocSession` or a helper around `addBlob` + `client.putLuaDefinition`)
- Modify: the code path that turns a LuaDefinition into bytes + calls `addBlob` + `client.putLuaDefinition`
- Modify: relevant tests

- [ ] **Step 1: Find the studio-side definition store path**

```bash
grep -rn 'putLuaDefinition\|hashLuaDefinition\|canonicalizeDefinition' apps/studio2/src/ packages/doc-store/src/ | head -20
```

The call to `client.putLuaDefinition` will be wired up somewhere in studio2's session or worker-client glue. The flow is: studio constructs a `LuaDefinition` → hashes it → `addBlob(canonicalBytes)` writes to the doc-store → `client.putLuaDefinition(hash, def)` syncs to the worker.

- [ ] **Step 2: Add the guard at the source of LuaDefinition introduction**

Wherever the studio constructs a `LuaDefinition` before sending it to the worker (likely a helper like `addLuaDefinition` on a session adapter, or inline in `seed-scenes.ts` / an inspector commit handler), call `validateLuaSource(def)` first.

If the validation throws `LuaValidationError`, do not proceed with `addBlob`/`putLuaDefinition` — re-throw so the caller surfaces it.

Concrete location: most likely a new method on `SessionState` (file `apps/studio2/src/state/session.svelte.ts`) or a sibling helper. If no such method exists yet, add one:
```ts
async addLuaDefinition(def: LuaDefinition): Promise<Hash> {
  validateLuaSource(def);  // throws LuaValidationError
  const bytes = new TextEncoder().encode(canonicalizeDefinition(def));
  const hash = await this.session.addBlob(bytes);
  return hash;
}
```

Use the existing `canonicalizeDefinition` from `@yacad/lua` for the byte form. The worker-side `putLuaDefinition` is triggered by the existing session/library plumbing when blobs sync to the worker — confirm by reading the existing pattern in `seed-scenes.ts:282` and `packages/doc-store/src/session.ts:181`. If `addBlob` doesn't already trigger `putLuaDefinition`, this task's helper additionally calls `client.putLuaDefinition(hash, def)` after `addBlob` succeeds.

- [ ] **Step 3: Write a test**

If `SessionState` (or whatever owner) has a tests file, add a test that:
- Constructs an invalid LuaDefinition.
- Calls the new `addLuaDefinition` (or equivalent guarded path).
- Asserts it throws `LuaValidationError`.
- Asserts the session's blob store does NOT contain the definition's hash afterward.

Example pattern (adapt to actual test harness):
```ts
it('rejects invalid LuaDefinitions before storing', async () => {
  const session = await openTestSession();
  const bad: LuaDefinition = {
    schema: { inputs: [], params: {}, output: '3d' },
    code: 'return { type = "box", params = { size = { params.teeth, 1, 1 } } }',
  };
  await expect(session.addLuaDefinition(bad)).rejects.toBeInstanceOf(LuaValidationError);
  // Also assert nothing was added to the blob store.
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @yacad/studio2 test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio2/src apps/studio2/test
git commit -m "feat(studio2): validate LuaDefinitions before addBlob"
```

---

## Task 19: Studio `LuaInspector` — live validation feedback

**Files:**
- Modify: `apps/studio2/src/ui/inspectors/LuaInspector.svelte`
- Create (optional): a small `ValidationIssueList.svelte` helper component

- [ ] **Step 1: Run validation against the live definition**

In `apps/studio2/src/ui/inspectors/LuaInspector.svelte`, after the `definition` `$derived`, add:

```ts
import { validateLuaSource, LuaValidationError, type ValidationIssue } from '@yacad/lua';

const validationIssues = $derived.by<readonly ValidationIssue[]>(() => {
  if (!definition) return [];
  try {
    validateLuaSource(definition);
    return [];
  } catch (e) {
    if (e instanceof LuaValidationError) return e.issues;
    throw e;
  }
});
```

- [ ] **Step 2: Render the issue list**

Inside the inspector's `{#if definition}` block, before the params loop, add:

```svelte
{#if validationIssues.length > 0}
  <section class="validation-issues">
    <h4>{validationIssues.length} validation issue{validationIssues.length === 1 ? '' : 's'}</h4>
    <ul>
      {#each validationIssues as issue (issue.line + ':' + issue.column + ':' + issue.category)}
        <li class="issue issue-{issue.category}">
          <code>line {issue.line}:{issue.column}</code>
          <span class="category">{issue.category}</span>
          <span class="message">{issue.message}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}
```

Add matching CSS at the bottom of the file:
```svelte
<style>
  .validation-issues {
    background: var(--issue-bg, #fff3f3);
    border: 1px solid var(--issue-border, #f3aaaa);
    border-radius: 4px;
    padding: 0.5em 0.75em;
    margin: 0.5em 0;
    font-size: 0.9em;
  }
  .validation-issues h4 { margin: 0 0 0.5em; color: #a30000; }
  .validation-issues ul { list-style: none; padding: 0; margin: 0; }
  .validation-issues li { display: flex; gap: 0.5em; padding: 0.15em 0; }
  .validation-issues code { color: #555; }
  .validation-issues .category { color: #a30000; font-weight: 600; }
</style>
```

(Match the existing studio2 visual conventions — read `apps/studio2/src/app.css` or one of the other inspectors first and adapt.)

- [ ] **Step 3: Manual smoke-check**

Start the dev server:
```bash
pnpm dev
```
Open the studio, load a scene with a Lua definition (e.g., the gear), edit the source to introduce a known issue (`return geo.bogus({})`), and verify the inspector shows the issue inline.

- [ ] **Step 4: Commit**

```bash
git add apps/studio2/src/ui/inspectors/LuaInspector.svelte
git commit -m "feat(studio2): live validation issues in LuaInspector"
```

---

## Task 20: Playwright smoke test for inspector wire-up

**Files:**
- Create: `apps/studio2/e2e/lua-validation.spec.ts`

- [ ] **Step 1: Inspect existing Playwright setup**

```bash
ls apps/studio2/e2e/ apps/studio2/playwright.config.ts 2>/dev/null
```
Read the existing config to see how scenes are loaded and how selectors are usually written.

- [ ] **Step 2: Write the smoke test**

`apps/studio2/e2e/lua-validation.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test('LuaInspector surfaces validation issues for an undeclared param', async ({ page }) => {
  await page.goto('/');
  // Open the seeded gear scene.
  await page.getByRole('button', { name: /procedural gear/i }).click();
  // Select the Lua node in the tree (selector depends on the tree-pane implementation;
  // adapt to the actual data-testid/role pattern in studio2).
  await page.getByText(/lua/i).first().click();
  // Edit the definition through whatever editing affordance the inspector exposes.
  // For v1 there's no code editor — this test is a placeholder that asserts the
  // validation-issues UI renders when issues exist. If a code editor lands later,
  // this test should be extended to drive an edit.
  // Today: at minimum, assert the inspector mounts without console errors.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.getByText(/definitionHash/)).toBeVisible();
  expect(errors).toEqual([]);
});
```

This test is intentionally light per the spec — the validator's logic is covered in unit tests; the e2e check is wire-up only. If the studio2 code editor lands later, extend this test to type an invalid edit and assert the issue list updates.

- [ ] **Step 3: Run Playwright**

```bash
pnpm --filter @yacad/studio2 test:e2e
```
(Or whatever the studio2 playwright runner script is — check `apps/studio2/package.json` for the script name.)

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/studio2/e2e/lua-validation.spec.ts
git commit -m "test(studio2): playwright smoke test for LuaInspector validation"
```

---

## Task 21: E2E corpus — assert existing Lua fixtures validate clean

**Files:**
- Modify: `packages/e2e/src/scenes.test.ts` (or wherever the existing per-scene snapshot suite lives — discover via grep)

- [ ] **Step 1: Locate the scene-snapshot test**

```bash
grep -rn 'lua-gear\|lua-with-input\|FLOWER' packages/e2e/src/ | head -10
```
Identify the test file that iterates over scenes. The validation assertion will live in the same suite.

- [ ] **Step 2: Add a per-Lua-fixture validation assertion**

In the appropriate test file, add:
```ts
import { validateLuaSource } from '@yacad/lua';
import { GEAR_DEFINITION, ARRAY_ALONG_X_DEFINITION, FLOWER_DEFINITION } from './fixtures';

describe('existing Lua fixtures validate clean', () => {
  it.each([
    ['gear', GEAR_DEFINITION],
    ['array-along-x', ARRAY_ALONG_X_DEFINITION],
    ['flower', FLOWER_DEFINITION],
  ])('%s', (_, def) => {
    expect(() => validateLuaSource(def)).not.toThrow();
  });
});
```

If `fixtures.ts` doesn't export `FLOWER_DEFINITION` etc. directly, import the canonical paths discovered in Step 1.

- [ ] **Step 3: Run e2e tests**

```bash
pnpm --filter @yacad/e2e test
```
Expected: PASS. If any fixture fails:
- If the failure surfaces a real bug in the validator (e.g., the walker mis-handles a real-world pattern), fix the validator (and add a unit test that reproduces it).
- If the failure surfaces a real bug in the fixture, fix the fixture.
- Do not silence the failure.

- [ ] **Step 4: Commit**

```bash
git add packages/e2e/src/scenes.test.ts
git commit -m "test(e2e): assert all Lua fixtures pass validateLuaSource"
```

---

## Task 22: Full-repo verification + PR

**Files:** none (verification + PR creation)

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```
Expected: PASS across every package.

- [ ] **Step 2: Lint + format**

```bash
pnpm lint
pnpm format
```
Expected: clean. Address any issues with appropriate fixes (not by disabling rules).

- [ ] **Step 3: Type-check via project build**

```bash
pnpm build
```
Expected: clean.

- [ ] **Step 4: Studio production build**

```bash
pnpm build:app
```
Expected: clean.

- [ ] **Step 5: Update ROADMAP**

Edit `docs/ROADMAP.md` — move the "AST validation of Lua code against schema" entry from the Deferred section into the Shipped phases list, with a link to this spec:

Under "Shipped phases", add:
```markdown
- **Lua static validation** — AST-level rejection of undeclared schema refs, sandbox violations, and malformed `geo.<type>` calls before `putLuaDefinition`. See [specs/2026-05-28-lua-static-validation-design.md](superpowers/specs/2026-05-28-lua-static-validation-design.md).
```

Remove the corresponding line from the "Deferred — kernel / engine" section.

- [ ] **Step 6: Commit roadmap update**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): mark Lua static validation as shipped"
```

- [ ] **Step 7: Push + open PR**

```bash
git push -u origin feat/lua-static-validation
gh pr create --title "Lua static validation: AST-level checks against schema + sandbox + registry" --body "$(cat <<'EOF'
## Summary

- New `validateLuaSource(def)` in `@yacad/lua` rejects LuaDefinitions whose source references undeclared schema entries, violates the sandbox identifier whitelist, or malforms `geo.<type>` calls.
- Sandbox identifier list extracted into `sandbox-globals.ts` as single source of truth — `wasmoon-runtime` and the validator both consume it; a runtime/validator parity test catches future drift.
- Wired into `worker.putLuaDefinition` with a new `validation-error` reply variant; studio2's session guards `addBlob` for LuaDefinitions; the LuaInspector renders issues inline.

## Spec

[docs/superpowers/specs/2026-05-28-lua-static-validation-design.md](docs/superpowers/specs/2026-05-28-lua-static-validation-design.md)

## Test plan

- [ ] `pnpm test` passes (unit + integration + e2e + parity)
- [ ] `pnpm lint && pnpm format` clean
- [ ] `pnpm build && pnpm build:app` clean
- [ ] Manual: studio2 LuaInspector shows red issue list when editing a known-bad definition
- [ ] Manual: worker rejects an invalid `putLuaDefinition` via `validation-error` reply
EOF
)"
```

---

## Self-review checklist

Run this before marking the plan done. Don't move on until all four pass:

1. **Spec coverage** — each section of the spec maps to at least one task:
   - §Architecture / module placement → Tasks 6, 16
   - §Public surface → Tasks 6, 16
   - §Sandbox-globals extraction → Tasks 1, 2, 3, 4
   - §Validation algorithm Phase 1 → Tasks 8, 9
   - §Validation algorithm Phase 2 → Tasks 10, 11, 12, 13, 14
   - §Scope tracking / shadowing → Task 15
   - §Error model → Tasks 6 (skeleton), spread across 8–14 (each adds categories)
   - §Worker put-time wiring → Task 17
   - §Studio put-time wiring → Task 18
   - §Inspector live feedback → Task 19
   - §Testing strategy (unit / integration / studio / e2e / parity) → Tasks 1–5, 17, 20, 21
   - §Restrictions (Lua 5.4 attributes) → Task 7

2. **No placeholders** — every "TBD" / "fill in" / "add appropriate" replaced with concrete content.

3. **Type consistency** — `ValidationIssue` shape, `LuaValidationError` constructor, `validateLuaSource` signature, `ValidationCategory` union members are referenced identically across Tasks 6–14 and Tasks 17–21.

4. **Dependency ordering** — luaparse added in Task 0 before first use in Task 7. `SANDBOX_GLOBALS` defined in Task 1 before Phase 2 uses it in Task 10. `@yacad/lua` exports updated in Task 16 before worker/studio import the validator in Tasks 17–19.
