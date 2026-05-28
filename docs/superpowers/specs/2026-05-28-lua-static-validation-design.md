# Lua static validation design

**Status**: design approved 2026-05-28. Implementation pending.
**Date**: 2026-05-28
**Scope**: AST-level static validation of `LuaDefinition.code` against the declared schema, the sandbox identifier whitelist, and the kernel-node registry's `paramSchema`. Closes the "AST validation of Lua code against schema" item deferred by the [LuaNode design](2026-05-27-luanode-design.md) and tracked in [docs/ROADMAP.md](../../ROADMAP.md).

## Context

`@yacad/lua` today validates a LuaDefinition's *runtime contract*: `normalizeValues` checks `values` against `schema.params`; `checkInputsAgainstSchema` checks child arity and output types against `schema.inputs`. The Lua **source code** is never inspected statically — sandbox violations, references to undeclared schema entries, and malformed `geo.<type>` calls all surface as Lua runtime errors during `Engine.walk` (`LuaError{phase: 'runtime'}`). This is correct but lossy: the user pays the round-trip-to-evaluation cost to learn that `params.tooth` is a typo for `params.teeth`.

This spec adds a static-analysis module that catches these classes of error before the LuaDefinition is stored. The module runs at every boundary that introduces a definition (studio inspector, studio session, worker `putLuaDefinition` handler) so that invalid definitions are rejected at the door and never reach the cache.

The spec depends on the `paramSchema` refactor that ships with the studio-v2-foundation work — see [§Dependencies](#dependencies).

## Goals

- Static rejection of three categories of LuaDefinition source-level bugs: undeclared `params.*`/`inputs.*` references, sandbox-whitelist violations, and malformed `geo.<type>{…}` calls (unknown type, unknown param key, required param missing).
- Single source of truth for the sandbox identifier set, shared by `WasmoonLuaRuntime` and the new validator — no drift possible.
- Editor-time feedback: `validateLuaSource` is a pure, deterministic, main-thread-safe function so the studio can call it on every keystroke commit for inline inspector errors.
- Defense in depth: the worker independently re-validates on `putLuaDefinition`, so non-studio callers (CLI, agents, test harnesses) can't pollute the cache.
- All issues collected in a single pass — users fix N problems with one round trip, not N round trips.

## Non-goals

- **Value-level type inference on `geo.<type>` calls.** `geo.box{size = "oops"}` is not caught statically by v1; the runtime catches it. Tracked as a follow-up spike.
- **Dead-param / dead-input warnings.** Detecting that `schema.params.foo` is declared but never read in source is a real footgun, but it requires a warnings channel orthogonal to the error model and is deferred.
- **Retroactive validation of existing IndexedDB definitions.** Definitions stored before this change bypass validation on read; they continue to surface problems at evaluation time as today.
- **Lua 5.4 attribute syntax (`<const>` / `<close>`).** Wasmoon runs Lua 5.4 but luaparse maxes at 5.3; v1 restricts LuaDefinitions to 5.3 syntax. See [§Restrictions](#restrictions).
- **CPU / wall-clock budgets, infinite-loop detection.** Already deferred per the LuaNode spec; no overlap.

## Decisions and rationale

### Validation runs at `putLuaDefinition`, not in `buildGraph`

The validator is a property of the definition, not of the document. A definition is parsed and analyzed exactly once per content hash — at the put boundary — and known-good thereafter. _Rejected:_ running validation inside `buildGraph` on every document load. Two problems with that: (1) the hot path (every commit, every page reload) would re-parse every LuaNode's source; (2) old IndexedDB-resident definitions would fail buildGraph indefinitely until manually re-saved. Put-time scoping isolates the new check to the introduction boundary.

### Strict mode: un-analyzable patterns are rejected

The validator treats sandbox code as a contract: it must be statically analyzable. Aliasing `params`, `inputs`, or `geo` (or any `geo.<type>`) to a local is rejected; non-literal bracket-key access on those tables is rejected; `_G[...]` is rejected. Direct dot-access (`params.foo`) and literal-key bracket-access (`params["foo"]`) are accepted. _Rejected:_ lenient mode (would silently let `local p = params; p.bad` pass, giving false confidence) and the mid-strict "ad-hoc list of bypass patterns" option (harder to explain, harder to keep consistent as the validator grows). The strictness is a feature — it makes the contract enforceable rather than aspirational. Real-world cost is low: the existing fixtures (`GEAR_DEFINITION`, `ARRAY_ALONG_X_DEFINITION`, `FLOWER_DEFINITION`) all use direct-access style already.

### Collect all issues, throw once

`validateLuaSource` walks the entire AST, accumulating a `ValidationIssue[]`, and throws a single `LuaValidationError` carrying the full list. Fail-fast was rejected because re-submit churn on multi-error definitions is bad UX, and the implementation cost of "continue past first error" is negligible.

### luaparse for parsing

luaparse is the only mature pure-JS Lua parser with a stable AST shape and `locations: true` output. Wasmoon's own parser is in-engine and doesn't expose an AST. A hand-rolled parser is not justifiable scope. luaparse's 5.3 ceiling drives the [Lua 5.4 restriction](#restrictions); accepted as a v1 tradeoff.

### Three call sites, one shared validator

Every boundary that can introduce an unvalidated definition runs the validator: studio inspector (editor feedback), studio session pre-put (don't pollute the local cache), worker `putLuaDefinition` (don't pollute the durable cache). The validator is pure and deterministic; running it three times is sub-millisecond and bought in exchange for defense in depth.

## Architecture

### Layered placement

```text
@yacad/dag         — getKernelTypeDoc(type): KernelTypeDocSummary | undefined
                     KernelTypeDocSummary.paramSchema: readonly ParamDoc[]
                     ParamDoc.required: boolean      [exists in studio-v2-foundation]

@yacad/lua         — sandbox-globals.ts    NEW
                     static-analyze.ts     NEW
                     wasmoon-runtime.ts    REFACTORED to import SANDBOX_STRIP_SCRIPT
                     index.ts              re-exports the new surface

@yacad/worker      — putLuaDefinition handler gains a validate-before-store step
                     and a new 'validation-error' reply variant

apps/studio2       — LuaInspector renders ValidationIssue[] inline against the
                     code view; session's add-definition path runs the validator
                     before issuing putLuaDefinition
```

Dependency flow is unchanged. The validator reads kernel `paramSchema` directly from `@yacad/dag` via `getKernelTypeDoc`; no injection seam.

### Public surface

```ts
// packages/lua/src/static-analyze.ts

import type { LuaDefinition } from './schema';

export type ValidationCategory =
  | 'unparseable'           // luaparse rejected the source
  | 'unsupported-syntax'    // Lua 5.4-only feature recognized in the parse error
  | 'undeclared-param'      // params.X where X is not in schema.params
  | 'undeclared-input'      // inputs.X where X is not in schema.inputs
  | 'sandbox-violation'     // global identifier not in SANDBOX_GLOBALS.topLevel,
                            //   or member access disallowed by libraryMembers
  | 'unknown-geo-type'      // geo.X where X is not a registered kernel type
  | 'unknown-geo-param'     // geo.X{Y = ...} where Y is not in X's paramSchema
  | 'missing-geo-param'     // required ParamDoc never set in a geo.X{...} call
  | 'unanalyzable-alias'    // local p = params / local g = geo / local b = geo.box
  | 'unanalyzable-access';  // params[varName], geo.X(nonTableArg), etc.

export interface ValidationIssue {
  readonly category: ValidationCategory;
  readonly message: string;
  readonly line: number;       // 1-indexed, from luaparse loc.start.line
  readonly column: number;     // 1-indexed, from luaparse loc.start.column
  /** The identifier or member name at fault, when applicable. Lets UIs
   *  highlight it without re-parsing the message. Absent for 'unparseable'. */
  readonly identifier?: string;
  /** Valid names from the relevant schema or registry. Populated for the
   *  four categories where "did you mean…" suggestions make sense:
   *  undeclared-param, undeclared-input, unknown-geo-param, missing-geo-param. */
  readonly validNames?: readonly string[];
}

export class LuaValidationError extends Error {
  readonly issues: readonly ValidationIssue[];
  constructor(issues: readonly ValidationIssue[]);
}

/** Throws LuaValidationError with the full list of issues if any are found;
 *  otherwise returns normally. Deterministic; pure; safe for editor use. */
export function validateLuaSource(def: LuaDefinition): void;
```

`LuaValidationError` extends `Error` directly, not `LuaError`. The two represent different lifecycles — `LuaError` is for runtime failures inside Wasmoon, `LuaValidationError` is for static problems before execution. Inheriting would muddy `instanceof` checks at the engine and worker boundaries.

`LuaValidationError.message` summarizes the first three issues inline (`"line 4: undeclared param 'tooth'; line 7: …; line 12: …; …and 2 more"`); consumers that want structured handling use `.issues`.

### Sandbox-globals extraction

A new module `packages/lua/src/sandbox-globals.ts`:

```ts
export const SANDBOX_GLOBALS: {
  /** Identifiers visible at the top level of the user's Lua program after
   *  installSandbox completes. */
  readonly topLevel: ReadonlySet<string>;
  /** Per-library allowlist for member access. Library names absent from
   *  this map have no member restrictions beyond existence (geo.* is
   *  registry-driven, not whitelisted here). */
  readonly libraryMembers: ReadonlyMap<string, ReadonlySet<string>>;
};

/** Lua source string executed by the runtime after loading stdlibs, to nil
 *  out every entry brought in by loadLibrary that is NOT in the whitelist.
 *  Derived once at module load from SANDBOX_GLOBALS. */
export const SANDBOX_STRIP_SCRIPT: string;
```

Contents:

- `topLevel` includes the four library tables (`math`, `string`, `table`), the three injected APIs (`geo`, `inputs`, `params`), and every base-library entry that survives the strip (`pairs`, `ipairs`, `next`, `select`, `pcall`, `xpcall`, `error`, `assert`, `tostring`, `tonumber`, `type`, `unpack`, `rawget`, `rawset`, `rawequal`, `rawlen`, `setmetatable`, `getmetatable`). The exact base set is pinned to what Wasmoon's `LuaLibraries.Base` brings in at the version pinned in the package.
- `libraryMembers` declares the post-strip surface: `math.*` minus `randomseed`; `string.*` minus `dump`; `table.*` complete. `geo` is intentionally absent (validator dispatches to the kernel registry instead).
- `SANDBOX_STRIP_SCRIPT` is generated by diffing the set of identifiers brought in by `loadLibrary(Base|Math|String|Table)` against the whitelist. The diff is computed at module-load time, deterministic, and produces the same script today: `math.randomseed = nil; string.dump = nil; dofile = nil; loadfile = nil; load = nil; loadstring = nil; require = nil; print = nil; collectgarbage = nil`. Adding an entry to the whitelist automatically removes it from the strip script next build. No drift possible.

`wasmoon-runtime.ts` is refactored to import `SANDBOX_STRIP_SCRIPT` and `engine.doString(SANDBOX_STRIP_SCRIPT)` instead of carrying the strip script as a hardcoded inline string. The seed call (`math.randomseed(seedLo, seedHi)`) is unchanged and still ordered before the strip — explicit comment retained at the call site.

Special identifiers the validator handles separately:
- `params`, `inputs`, `geo` — in `topLevel` (so they pass identifier resolution) but the validator applies category-specific rules to them.
- `_G`, `_ENV` — explicitly **not** in `topLevel`. Reference to either is a `sandbox-violation`, which closes the dynamic-global loophole.

### Validation algorithm

Single pass with a Phase-1 pre-walk for alias detection. Shared scope state across both phases.

```text
validateLuaSource(def):
  let ast
  try { ast = luaparse.parse(def.code, {
          luaVersion: '5.3', locations: true, comments: false, scope: false
        })
  } catch (e) {
    issues.push(mapParseError(e))   // 'unparseable' or 'unsupported-syntax'
    throw new LuaValidationError(issues)
  }

  // Phase 1 — scope pre-walk for tainted-alias detection
  walkLocals(ast, frames, taintedLocals, issues):
    for each LocalStatement `local name = expr`:
      if expr is Identifier matching 'params' / 'inputs' / 'geo'
         OR MemberExpression rooted at 'geo':
        issues.push({ category: 'unanalyzable-alias', line/col of name,
                      identifier: name, message: ... })
        taintedLocals.add(name)
      else:
        bind name in current frame  (regular local; not tainted)

  // Phase 2 — full AST walk with identifier resolution and category checks
  walk(ast, frames, taintedLocals, issues):
    for each Identifier in expression position:
      if resolves to a local: pass (tainted locals are silent — Phase 1
        already reported the alias declaration; no double-report)
      else if name in SANDBOX_GLOBALS.topLevel: pass
      else: issues.push({ category: 'sandbox-violation', ... })

    for each MemberExpression `T.X`:
      if T resolves to 'params': check X against schema.params keys
        → 'undeclared-param' with validNames on miss
      if T resolves to 'inputs': check X against schema.inputs[].name
        → 'undeclared-input' with validNames on miss
      if T resolves to 'geo': X must be a registered kernel type
        → 'unknown-geo-type' on miss (call-shape check happens at the
        enclosing CallExpression)
      if T is a library in SANDBOX_GLOBALS.libraryMembers: X must be in the
        member set → 'sandbox-violation' on miss

    for each IndexExpression `T[K]`:
      if T resolves to 'params'/'inputs' and K is StringLiteral: treat as
        MemberExpression with key = K.value
      if T resolves to 'params'/'inputs'/'geo' and K is not a string literal:
        → 'unanalyzable-access'

    for each CallExpression where callee is `geo.<type>`:
      if <type> not registered: (already reported by MemberExpression
        handler; skip)
      else:
        if arg[0] absent: every required ParamDoc → 'missing-geo-param'
          (with validNames = list of required param names)
        elif arg[0] is TableConstructorExpression:
          for each TableKeyString in arg[0]:
            if key.name not in paramSchema: 'unknown-geo-param' with
              validNames = paramSchema entry names
          for each required ParamDoc not present as TableKeyString:
            'missing-geo-param' with validNames = required names
        else (variable, function call, anything non-literal):
          → 'unanalyzable-access' on arg[0]
        arg[1] (children) is NOT inspected — arbitrary table construction
          (loop-built `parts`) is statically unanalyzable by design.

  if issues.length > 0:
    throw new LuaValidationError(issues)
```

**Scope tracking**: a stack of `Map<name, declSite>` frames. Push on function enter, block enter (`do..end`, `if`, `while`, `repeat`, numeric/generic `for`). Pop on exit. `function foo()` adds `foo` to the outer frame; `local function foo()` adds `foo` to the current frame. Identifier resolution walks the stack outward, falling through to `SANDBOX_GLOBALS.topLevel`.

**Shadowing**: `local params = {}` shadows the sandbox `params` for its scope. Subsequent `params.foo` references resolve to the shadow, not the schema, and produce no issue. This is correct Lua semantics; future ergonomic warnings about shadowing are out of v1 scope.

**Tainted-locals**: Phase 1 reports `unanalyzable-alias` on the declaration line. Phase 2 treats the tainted name as a normal local for resolution purposes but emits no further issues from its uses — single-source reporting per alias, no downstream noise.

### Put-time wiring

#### Worker (`@yacad/worker`)

```ts
case 'putLuaDefinition':
  try {
    validateLuaSource(msg.definition);
  } catch (err) {
    if (err instanceof LuaValidationError) {
      reply({ kind: 'validation-error', issues: err.issues });
      return;
    }
    throw err;  // transport-level failure path unchanged
  }
  await putDefinition(store, msg.hash, msg.definition);
  reply({ kind: 'ok' });
```

Atomicity: `validateLuaSource` runs before any `store.put`; invalid definitions are never written. If a subsequent `evaluate` references a hash that was rejected, `buildGraph` raises the existing `DagError` ("definition not found") — the user sees the validation error and the missing-definition error in sequence as they edit. Tightening this to "the rejection is sticky and surfaces on evaluate" is a follow-up.

`buildGraph` does **not** re-run `validateLuaSource`. Two reasons: (1) it would re-parse every LuaNode's source on every commit, breaking the hot-path budget; (2) IndexedDB-resident definitions from prior sessions would fail buildGraph indefinitely until manually re-saved.

#### Studio (`apps/studio2`)

Two call sites:

1. **Inspector live feedback.** `LuaInspector.svelte` (or the future schema/code editor) calls `validateLuaSource` on every committed source edit. `issues` render inline against the code view with line/column highlights. Pure main-thread; no worker round trip.
2. **Session pre-put guard.** Before the session's `addLuaDefinition` (concrete API name pending studio v2 foundation) sends `putLuaDefinition` to the worker, the studio runs `validateLuaSource` and short-circuits on failure. The doc transaction rolls back; the local cache stays clean.

Failure UX:
- Inspector: red gutter + line/col highlight + message per issue. Maps directly to Monaco-style markers if/when that editor lands.
- Pre-put: toast or inline banner listing the issues; doc transaction rolls back.
- Worker `validation-error` reply: identical UX to pre-put; only fires if a non-studio caller bypassed the pre-put gate.

### Worker reply variant

The `putLuaDefinition` reply union expands:

```ts
type PutLuaDefinitionReply =
  | { kind: 'ok' }
  | { kind: 'validation-error'; issues: ValidationIssue[] };
```

`ValidationIssue` is plain data (string fields, number fields, optional `readonly string[]`) — structured-clone-safe across `postMessage`. The main thread reconstitutes a `LuaValidationError` from the array for any UI that wants the typed surface.

## Dependencies

This work assumes the following are in place (all true on the `feat/studio-v2-foundation` branch, pending merge to `main`):

- `@yacad/dag` exports `getKernelTypeDoc(type): KernelTypeDocSummary | undefined`.
- `KernelTypeDocSummary.paramSchema: readonly ParamDoc[]`.
- `ParamDoc.required: boolean`.
- `apps/studio2` exists with a session layer that can host the inspector + pre-put call sites.

Implementation lands **after** `feat/studio-v2-foundation` merges. The spec can be reviewed and planned now, but execution waits for the merge.

New runtime dependency on the `@yacad/lua` package: `luaparse@^0.3.x` (latest at implementation time; pinned). `@types/luaparse` is added as a dev dependency; a minimal augmentation `.d.ts` covers any gaps in its coverage of `locations: true` AST nodes.

## Restrictions

- **Lua 5.4 attribute syntax is rejected.** `local x <const> = 1` and `local x <close> = obj` raise `unsupported-syntax` if luaparse's parse error message matches the attribute pattern; otherwise `unparseable`. Real-world impact is small; none of the existing fixtures use these features. If a definition genuinely needs `<const>` for clarity, the user uses a plain `local`.
- **`geo.<type>(arg)` must pass a table literal as `arg[0]`.** Variable references, function returns, and other non-literal expressions cannot be statically inspected for keys, so the call is rejected as `unanalyzable-access`. Users compose param tables inline. (Future: a constant-folding pre-pass could lift trivial `local p = { ... }; geo.box(p)` into the literal-key check, but that's a separate improvement.)
- **`geo.<type>(params, children)`'s children argument is unchecked.** Arbitrary loop-built tables are explicitly supported (`parts[#parts + 1] = ...; return geo.union({}, parts)` is the canonical pattern). The validator does not attempt to verify per-element children shape.

## Testing strategy

### Unit tests in `@yacad/lua` (no Wasmoon, no worker)

`static-analyze.test.ts` — bulk of coverage. Each category gets explicit happy/sad cases driven by inline `LuaDefinition` fixtures:

- **Parse errors**: empty source, syntax error, `local x <const> = 1` → `unsupported-syntax` with the hint; everything else → `unparseable`.
- **Sandbox whitelist**: every banned identifier referenced standalone (`os`, `io`, `package`, `require`, `dofile`, `loadfile`, `load`, `loadstring`, `print`, `collectgarbage`, `debug`, `coroutine`, `_G`, `_ENV`) → `sandbox-violation`. Every allowed identifier (`math`, `string`, `table`, `pairs`, `ipairs`, `pcall`, `tostring`, `type`, `setmetatable`, …) passes. Stripped member access (`math.randomseed`, `string.dump`) → `sandbox-violation`.
- **Param refs**: schema `{teeth, radius}` — `params.teeth` passes; `params.tooth` → `undeclared-param` with `validNames: ['teeth','radius']`. Literal bracket: `params["teeth"]` passes; non-literal `params[someVar]` → `unanalyzable-access`.
- **Input refs**: same matrix against `schema.inputs[].name`.
- **`geo.<type>` calls**: every registered kernel type round-trips; `geo.bogus{...}` → `unknown-geo-type`; `geo.box{size = {1,2,3}, bogusKey = 1}` → `unknown-geo-param` with `validNames`; `geo.box{}` (required `size` missing) → `missing-geo-param` with `validNames` of required names; non-table first arg (`geo.box(someVar)`) → `unanalyzable-access`; loop-built `parts` children (`geo.union({}, parts)`) passes.
- **Aliasing (Phase 1)**: `local p = params`, `local i = inputs`, `local g = geo`, `local b = geo.box` — each → `unanalyzable-alias` on the declaration; downstream uses produce no additional issues.
- **Scope handling**: shadowing (`local params = {}; return params.anything`) is silently fine; nested function `local function foo(params) return params.x end` — inner `params` shadows correctly, no `undeclared-param`; `for` loop variables don't leak past `end`.
- **Multi-issue collection**: a single source with one of each category produces an `issues` array containing all of them in source order; the throw happens once.
- **`LuaValidationError.message`**: contains the first three issue summaries plus "…and N more" when N > 3.

`sandbox-globals.test.ts` — pins the contents of `SANDBOX_GLOBALS.topLevel` and `libraryMembers`; asserts that `SANDBOX_STRIP_SCRIPT` strips exactly the difference between what `loadLibrary(Base|Math|String|Table)` brings in and the whitelist. Catches drift if someone updates one without the other.

`wasmoon-runtime.test.ts` (existing) — new parity test: after `installSandbox`, enumerate `_G` from inside Lua, compare to `SANDBOX_GLOBALS.topLevel`. Equality required. This is the runtime-validator parity gate — if Wasmoon's stdlib content ever drifts, this fails first and forces an explicit `SANDBOX_GLOBALS` update.

### Integration tests in `@yacad/worker`

The worker-host test suite gains:

- `putLuaDefinition` with a valid definition replies `{ kind: 'ok' }`; the store receives the put.
- `putLuaDefinition` with an invalid definition replies `{ kind: 'validation-error', issues: [...] }`; the store does **not** receive the put.
- `ValidationIssue[]` round-trips through `postMessage` losslessly (structured-clone safety check).

### Studio tests (`apps/studio2`)

One Playwright smoke test (lands when the LuaDefinition editor wire-up does): an edit producing a known-invalid definition surfaces the issue inline in the inspector and prevents the worker put. The heavy logic is unit-tested in `@yacad/lua`; the studio test only verifies the wire-up.

### E2E corpus (`packages/e2e`)

The existing `lua-gear.json`, `lua-with-input.json`, and `lua-2d-flower.json` definitions pass `validateLuaSource`. Assert this in the e2e harness as a regression check — if a future code change accidentally tightens validation in a way that rejects current fixtures, this fails immediately. No new scenes required.

### Performance

`validateLuaSource` is a single AST pass bounded by definition size; expected microseconds even on `procTree`-sized definitions. No perf-bench entry for v1; revisit only on complaint.

## Open questions

- **Sticky validation errors.** Today, if `putLuaDefinition` rejects a definition, a subsequent `evaluate` referencing that hash fails with "definition not found" (the existing `DagError`). A future improvement: the worker remembers the validation error per hash and surfaces it on `evaluate` so the user sees the actionable message instead of "missing." Out of v1 scope.
- **Const-folding pre-pass.** Lifting `local p = { size = 5 }; geo.box(p)` to a literal-key check would relax the "non-literal first arg" restriction without weakening static analysis. Possible if the restriction proves to bite real users; not done in v1.
- **Dead-param / dead-input warnings.** Surfacing declared-but-unused schema entries as warnings (not errors) requires a warnings channel orthogonal to the issues list. Deferred until a real footgun surfaces.
- **Value-level type inference on `geo.<type>` calls.** A best-effort type-checker for literal table values against `ParamDoc.type` is the obvious next step. Tracked as a follow-up spike per the brainstorming session.
