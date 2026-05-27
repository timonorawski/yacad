# LuaNode design

**Status**: design approved, awaiting implementation plan
**Date**: 2026-05-27
**Scope**: Phase 1 of the roadmap in [docs/vision.md](../../vision.md) — introduce a sandboxed, sub-DAG-emitting LuaNode plus the general `ExpandableNodeType` abstraction it specializes.

## Goals

- Add `LuaNode` as a code-driven, parametric node type that participates fully in the Merkle-DAG cache (vision §Evaluation Engine, §LuaNode escape hatch).
- Generalize evaluation: split node types into kernel-backed (existing) and expansion-based (new). LuaNode is the first expansion-based node type; future code-node languages (JS/Python) and pure-TS procedural library nodes use the same machinery.
- Preserve every existing architectural invariant ([CLAUDE.md](../../../CLAUDE.md) §Architectural invariants): structured cache keys, deterministic evaluation, canonical hashing, dual type system, scope discipline.

## Non-goals

- Studio UI for editing LuaDefinitions (Monaco integration, schema editor) — covered by a separate design.
- A library/sharing layer for definitions beyond what content-addressing gives us for free.
- A textual DSL projecting the entire DAG to Lua (vision §Authoring Surfaces, longer-term).
- Other code-node languages (JS, Python). The design must accommodate them; this spec doesn't implement them.
- CPU/wall-clock quotas inside Lua. See [Error handling](#error-handling) for rationale.
- AST-level validation of Lua code against the declared schema. Forward-compatible but out of scope here.

## Decisions and rationale

The brainstorming session locked in the following choices. Each is recorded with the alternative considered and why it lost.

### LuaNode connects to the DAG via declared inputs + params

A LuaNode declares zero-or-more typed inputs (matched positionally to the DAG node's `children`) and a `params` schema, and produces output of a declared type. Generators (no children) and transformers (one child) are special cases of the general shape. _Rejected:_ restricting to pure generators initially — it would force a redesign of the node-type machinery when we add transformer-style code nodes, which is imminent.

### Lua emits a sub-DAG; expansion happens at evaluation time on cache miss

LuaNode appears in the document as a single opaque node whose `Node.params` is literally `{ definitionHash, values }`. The standard semantic-hash recipe (`hash(type, canonical(normalizedParams), child_hashes)`) therefore produces `hash("lua", canonical({definitionHash, values}), child_hashes)` without any LuaNode-specific override.

The engine caches the LuaNode's output mesh under that hash. On cache miss, Lua runs and emits a sub-DAG of primitives; the engine walks that sub-DAG, with each emitted node going through the normal cache path. _Rejected:_ expanding at `buildGraph` time (forces Lua to run on every document load, loses the outer cache benefit) and direct kernel calls from Lua (forfeits all inner cache benefits, couples Lua to the kernel API). The chosen design gives two-level caching: outer hit means Lua never runs; outer miss still benefits from inner hits across LuaNodes and against hand-authored content.

### The LuaDefinition is a structured object, not parsed-out-of-source

```text
LuaDefinition = { schema: { inputs, params, output }, code: "<lua source>" }
```

Schema and code live side by side as a single content-addressable artifact. The schema is queryable by inspectors and type-checkers without running Lua. A future AST validator cross-checks code against schema; until then, mismatches surface as Lua runtime errors at evaluation. _Rejected:_ declaring schema inline in Lua source (requires extracting it via either a Lua run or an AST pass before tooling can introspect — extra dependency, more failure modes) and declaring schema and code as independent document fields (silent drift between them).

### Lua sees opaque input handles with computed properties on demand

`inputs.foo` is a reference Lua composes into the emitted sub-DAG. Computed properties — initially just `outputType`, later `bbox` once that's a first-class cached artifact — trigger lazy child evaluation through the normal cache path. _Rejected:_ eagerly evaluating children to meshes before running Lua (breaks the lazy story, forces evaluation even when Lua wouldn't use the input) and pure-opaque (too restrictive: cannot write bbox-driven layout).

### `geo.*` API generated from the kernel-node registry, `geo.node` as primitive

Lua's only side effect is producing a `NodeDoc` tree. The API surface is a `geo` table containing one wrapper per registered kernel-backed node type (`geo.box`, `geo.union`, ...), generated from the registry. `geo.node(type, params, children)` is the underlying primitive — Lua can drop to it for dynamic dispatch or for types not yet wrapped. _Rejected:_ bare global functions (pollutes `_G`, fragile to user variables, harder to evolve) and `geo.node` only (verbose enough that every user would write their own wrappers — better to ship one canonical set).

**LuaNode emitting another LuaNode is disallowed in v1.** Representable but introduces a recursive-definition-hash problem better deferred. The wrapper layer only exposes kernel-backed node types.

### Wasmoon as the Lua runtime

Real Lua 5.4 compiled to WASM. Runs in the worker. Sandboxing strategy: build a custom `_G` containing only whitelisted modules (`math`, `string`, `table` minus impure entries; `geo`; `inputs`; `params`). _Rejected:_ Fengari (pure-JS Lua 5.3, smaller bundle but slower and bus-factor concern) and a custom DSL (substantial implementation cost, loses Lua's ecosystem and familiarity).

`math.random` is seeded deterministically from the LuaNode-instance hash (derived from definition hash + canonical(values); see [Evaluation](#evaluation-worker) for the Lua 5.4-specific seeding mechanics). Same instance → same random sequence across evaluations.

### Evaluation abstraction: `ExpandableNodeType`

The discriminator between "node types whose evaluation invokes a kernel" and "node types whose evaluation emits a sub-DAG that the engine then walks" is general, not Lua-specific. The same mechanism will host future code-node languages, ML-driven generators, and hand-rolled TS procedural library nodes. Reified as a discriminated union in `NodeTypeDef`.

## Architecture

### Layered placement

```text
@yacad/dag        — NodeTypeDef discriminated union: KernelNodeType | ExpandableNodeType
                    Registers builtins (kernel-backed); accepts external registrations.
                    buildGraph gains an optional `resolver` parameter for definition-driven
                    node types.

@yacad/lua  NEW   — LuaDefinition model, hashing, validation.
                    LuaRuntime interface; WasmoonLuaRuntime implementation.
                    makeLuaNodeType(runtime, resolver) -> ExpandableNodeType.

@yacad/engine     — Engine.walk branches on def.kind: kernel-backed nodes use the existing
                    kernel path; expandable nodes call def.expand(...), resolve input refs,
                    buildGraph the result, recursively walk.
                    Per-node failure isolation, scoped to expandable nodes in v1
                    (kernel-node failures keep current throw-out-of-walk behavior).

@yacad/worker     — Hosts LuaRuntime alongside the kernel.
                    Protocol gains putLuaDefinition(hash, def) and a definition cache.

@yacad/cache      — Artifact union gains { kind: 'luaDefinition', definition: LuaDefinition }.

@yacad/studio     — (out of scope) Schema+code editor panel, definition synchronization
                    to the worker, error surfacing on the offending node.
```

Dependency flow (adds `@yacad/lua` as a peer of `@yacad/kernel-manifold`; `lua` depends on `dag`, `canonical`, `hash`):

```text
canonical → hash ┐
geometry ────────┼→ dag ┬→ kernel-manifold ┐
                 │      └→ lua ────────────┤
                 └→ cache ─────────────────┼→ engine → worker → studio
                    render ────────────────┘            render ─┘
```

### `NodeTypeDef` discriminated union

```ts
// existing path — primitives, transforms, booleans. Signature unchanged from
// the current `NodeTypeDef`; only the `kind` discriminator is added.
interface KernelNodeType {
  readonly kind: 'kernel';
  readonly type: string;
  readonly output: GeometryType;
  checkChildren(children: readonly Node[], path: string): void;
  normalizeParams(params: unknown, path: string): Record<string, unknown>;
}

// new path — code-driven, sub-DAG-emitting. Wider signature: needs the
// resolver because output type and child checks may depend on a stored
// definition. The widening lives ONLY on this branch — kernel nodes keep
// their original signature so the seven existing builtins compile unchanged.
interface ExpandableNodeType {
  readonly kind: 'expandable';
  readonly type: string;
  resolveOutput(params: Record<string, unknown>, resolver: DefinitionResolver): GeometryType;
  checkChildren(
    children: readonly Node[],
    params: Record<string, unknown>,
    resolver: DefinitionResolver,
    path: string,
  ): void;
  normalizeParams(
    params: unknown,
    resolver: DefinitionResolver,
    path: string,
  ): Record<string, unknown>;
  /**
   * Pure function of normalized params + input refs. The contract is:
   *   - deterministic given identical inputs (cache correctness)
   *   - returns a NodeDoc tree which may contain `__input_ref` sentinels
   *     whose params.name matches one of the declared inputs
   *   - the engine resolves sentinels to child nodes during walk
   */
  expand(params: Record<string, unknown>, inputs: InputRef[]): Promise<NodeDoc>;
}

type NodeTypeDef = KernelNodeType | ExpandableNodeType;
```

The seven existing POC node types remain `kind: 'kernel'` and are behaviorally unchanged — `buildGraph` dispatches on `def.kind` and uses the appropriate signature for each branch. `DefinitionResolver` is a thin generic interface (`{ get(hash): unknown | undefined }`); each expandable node type narrows the return to its own definition shape (`LuaDefinitionResolver` returns `LuaDefinition`).

### `__input_ref` reserved sentinel

A reserved internal node type used only inside the sub-DAGs emitted by `expand`:

```ts
{ type: '__input_ref', params: { name: '<input name>' } }
```

Not registered in the public node registry. `buildGraph` actively rejects any authored document containing `type === '__input_ref'` (raises `DagError` with a message identifying the reserved prefix) — only the sub-DAG-splicing path inside `Engine.walk` may produce or resolve these. The reserved prefix `__` is documented as off-limits for user-defined node types; future internal sentinels follow the same convention.

### LuaDefinition

Content-addressable artifact, stored in the same object store as meshes/bboxes. The `Artifact` discriminated union (today `{ kind: 'mesh' } | { kind: 'bbox' }`) gains `{ kind: 'luaDefinition'; definition: LuaDefinition }` — camelCase to match the existing `ArtifactKind` style.

Stored under a synthetic cache key:

```ts
key = {
  semanticHash:   <definitionHash>,
  producedBy:     { kernel: 'lua-definition', kernelVersion: '0',
                    engineVersion: '0', qualityTier: 'definition' }
}
```

The `kernel: 'lua-definition'` slot is just a fixed string sentinel — it's not a real kernel — chosen so the structured-key shape is reused without special-casing the store. A "library" of LuaDefinitions is just whichever definitions happen to persist in IndexedDB (or, later, a remote tier).

### `@yacad/lua` public surface

```ts
// schema model — GeometryType is RE-EXPORTED from @yacad/dag, not redeclared,
// so 2d/3d is the same nominal type across the codebase.
import type { GeometryType, Node, NodeDoc } from '@yacad/dag';
import type { Hasher, Hash } from '@yacad/hash';

export interface LuaInputDecl {
  name: string;
  type: GeometryType;
  optional?: boolean;
}
export interface LuaParamDecl {
  type: 'int' | 'number' | 'boolean' | 'string' | 'vec3';
  default?: unknown;
  min?: number;
  max?: number;
}
export interface LuaSchema {
  inputs: LuaInputDecl[];
  params: Record<string, LuaParamDecl>;
  output: GeometryType;
}
export interface LuaDefinition {
  schema: LuaSchema;
  code: string;
}

// identity + validation
export function canonicalizeDefinition(def: LuaDefinition): string;
export function hashLuaDefinition(def: LuaDefinition, hasher: Hasher): Promise<Hash>;
export function normalizeValues(
  schema: LuaSchema,
  values: unknown,
  path: string,
): Record<string, unknown>;
export function checkInputsAgainstSchema(
  schema: LuaSchema,
  children: readonly Node[],
  path: string,
): void;

// resolver — supplied by the host (studio main thread or worker side)
export interface LuaDefinitionResolver {
  get(hash: Hash): LuaDefinition | undefined;
}

// runtime — engine talks to this, not to Wasmoon directly
export interface InputRef {
  readonly name: string;
  readonly type: GeometryType;
  /**
   * Sync: read directly from the already-built child Node — no async work,
   * no cache hit needed. The child's outputType is set by buildGraph before
   * the engine ever calls expand().
   */
  outputType(): GeometryType;
  /**
   * Future: bbox() and other computed properties that DO require cached
   * artifact lookup will be async. Their absence from this interface in v1
   * is intentional.
   */
}
export interface LuaRuntime {
  evaluate(
    def: LuaDefinition,
    inputs: InputRef[],
    values: Record<string, unknown>,
  ): Promise<NodeDoc>;
  dispose(): void;
}
export class WasmoonLuaRuntime implements LuaRuntime {
  /* ... */
}

// factory — wires the runtime + resolver into an ExpandableNodeType
export function makeLuaNodeType(
  runtime: LuaRuntime,
  resolver: LuaDefinitionResolver,
): ExpandableNodeType;
```

### Engine changes

`Engine`'s constructor gains a `resolver` parameter:

```ts
new Engine(store, kernel, resolver, engineVersion?)
```

`resolver` is a `DefinitionResolver` — required when the document contains expandable nodes, but cheap to supply an empty resolver for pure-kernel use (keeps the API uniform). The worker constructs its `Engine` with a resolver backed by the worker-side definition cache.

`Engine.walk` branches once on `def.kind`:

```ts
async walk(node, tier, perNode) {
  // unchanged: compute key, cache lookup, return on hit
  const def = getNodeType(node.type)
  let mesh: Mesh
  if (def.kind === 'kernel') {
    const childMeshes: Mesh[] = []
    for (const child of node.children) {
      childMeshes.push(await this.walk(child, tier, perNode))
    }
    mesh = this.kernel.evaluate(node, childMeshes)
  } else {
    const inputRefs = makeInputRefs(node, this.store, this.kernel)
    const subDoc = await def.expand(node.params, inputRefs)
    const resolved = resolveInputRefs(subDoc, node.children)
    const subRoot = buildGraph(resolved, this.resolver)
    mesh = await this.walk(subRoot, tier, perNode)
  }
  // unchanged: cache write, perNode push, return
}
```

**Per-node failure isolation — scoped to expandable nodes for v1.** A LuaNode that throws at expand time records its error on `NodeEval.error` (new optional field, shape `{ phase: 'expand'; message: string; cause?: string }`); the engine continues evaluating other subtrees. Ancestors that depend on the failed expandable node propagate failure upward via the same `error` channel, but unrelated subtrees evaluate normally. Only a root-level failure throws `EvaluationError` to the caller; on partial failure the engine returns `EvaluateResult` with the root mesh (if the root succeeded) plus per-node error annotations.

Kernel-node failures retain today's behavior in v1 (throw out of `walk`, abort the evaluation). This intentionally narrows the behavioral change — generalizing isolation to kernel nodes is a separate, larger change deferred to its own spec.

`EvaluateResult`'s shape is unchanged for happy paths; the addition is `NodeEval.error?` and a new `EvalStats.errors` counter alongside `hits`/`misses`. When a non-root expandable node fails, `EvaluateResult.mesh` reflects the root's actual output (which may itself depend on the failed subtree — in which case the root will also be in error state and the engine throws).

### Worker integration

Protocol additions:

```ts
{ kind: 'putLuaDefinition', hash: Hash, definition: LuaDefinition }
  → { kind: 'ok' }

{ kind: 'hasLuaDefinition', hash: Hash }
  → { kind: 'ok', present: boolean }
```

The studio collects all `definitionHash`es referenced by the document, calls `hasLuaDefinition` for each (cheap), `putLuaDefinition` for any the worker doesn't have, then sends the existing `evaluate` message. The worker holds a `LuaDefinitionResolver` backed by the cache; both `buildGraph` and the LuaRuntime read from it.

**Wasmoon loading.** Wasmoon's `LuaFactory` accepts a custom WASM URL via its constructor (`new LuaFactory(customWasmUri)`). Same pattern as the kernel: the main thread resolves the asset via `import wasmUrl from 'wasmoon/dist/glue.wasm?url'` (or whichever artifact ships with the installed Wasmoon version), passes it through the existing `init` message under a new `luaWasmUrl` field, and the worker calls `new LuaFactory(luaWasmUrl)` on first need. Implementation note for the planner: verify the exact asset name shipped by Wasmoon at install time — `glue.wasm` is the historical name but version-dependent — and pin to a known version in the package's dependencies.

**Lua state lifecycle — fresh state per `expand` call in v1.** Each `LuaRuntime.evaluate(...)` call instantiates a new Lua engine via `factory.createEngine()`, runs the user's code, captures the result, and disposes the engine. Rationale: pooled/reused states risk cross-call leakage (globals, registry, metatables) that would silently break determinism — a single misbehaving definition could poison subsequent evaluations, and the resulting cache entries would be wrong-but-cached. Per-call instantiation is unambiguously deterministic. The cost is engine creation latency per LuaNode evaluation, which is acceptable for v1 given that outer cache hits skip the runtime entirely; if first-eval latency becomes a problem after measurement, pooling is a follow-up optimization with its own correctness story.

## Data flow

### Authoring (main thread)

1. User edits a LuaNode in the studio. Panel shows the structured `LuaDefinition`: input ports, param schema, output type, and the code editor — one panel, one canonical object.
2. Each edit produces a new `LuaDefinition`. The studio canonicalizes it, computes `definitionHash`, `put`s it into the object store.
3. The DAG document references it: `{ type: "lua", params: { definitionHash, values }, children: [...] }`. Structural edits (reorder/replace children, change param values) work as for any other node.
4. On document-change, the studio collects referenced `definitionHash`es, sends `putLuaDefinition` for any new ones, then sends the document for evaluation.

### Evaluation (worker)

1. Worker-side `buildGraph` validates the document. For each LuaNode: resolves `definitionHash` (`DagError` if missing), normalizes `values` against `schema.params`, checks children against `schema.inputs`, sets `outputType` from `schema.output`, computes the semantic hash.
2. `Engine.walk` reaches the LuaNode, queries cache. Outer hit → return mesh.
3. On miss, calls `def.expand(node.params, inputRefs)`. Lua runtime fetches definition from the worker-side cache, instantiates a sandboxed Lua state, runs the user's code, captures the returned NodeDoc.
4. Sandbox specifics:
   - `_G` whitelist: `math` (minus `randomseed`; `random` is replaced — see below), `string`, `table`, `geo`, `inputs`, `params`. Everything else absent.
   - `geo.*` generated from the `KernelNodeType` registry once per `WasmoonLuaRuntime` instance (at construction); `geo.node(type, params, children)` underneath. New kernel node types added to the registry require runtime re-construction or an explicit refresh call — in v1, runtime is constructed once per worker init, so this is fine.
   - **`math.random` seeding (Lua 5.4 specifics).** Lua 5.4's `math.random` uses a per-state xoshiro256** seeded by `math.randomseed`. The runtime, before stripping `randomseed` from `_G`, calls `math.randomseed(seed_lo, seed_hi)` where the 128-bit seed is derived from `hash(definitionHash || canonical(values))` truncated/split appropriately. After seeding, `randomseed` is removed from the exposed `_G`. Because each `expand` call uses a fresh Lua state (see worker integration), seeding happens once per evaluation — sequences cannot leak across calls.
5. Engine resolves `__input_ref` sentinels in the emitted NodeDoc by name against `node.children`, calls `buildGraph` on the resolved tree (same validation path as authored content), recursively walks. Inner cache hits possible for any matching sub-tree.
6. Final mesh stored under the LuaNode's outer cache key. Returned upward.

## Error handling

Three failure layers, each with its own error class:

### Build-time — `DagError` (existing)

Thrown by `buildGraph`. Path-annotated, never reaches the engine.

- `definitionHash` missing, malformed, or not resolvable
- `values` fails schema validation (type, range, missing required, unknown key)
- Child count or output types don't match `schema.inputs`
- Definition shape itself malformed

### Expand-time — `LuaError` (new, in `@yacad/lua`)

```ts
class LuaError extends Error {
  readonly phase: 'compile' | 'runtime' | 'output';
  readonly line?: number;
  readonly column?: number;
  readonly cause?: Error; // populated when phase === 'output' and the cause is a DagError
}
```

- `phase: 'compile'` — Lua failed to parse. Line/col from Wasmoon's trace.
- `phase: 'runtime'` — Lua threw at runtime. Includes sandbox-violation attempts (`os.time()` → "attempt to index nil value 'os'").
- `phase: 'output'` — Lua returned something other than a valid NodeDoc, or the emitted sub-DAG failed `buildGraph` (wraps the inner `DagError` via `cause`).

### Engine isolation

`Engine.walk` catches errors only at expandable-node boundaries (see [Engine changes](#engine-changes) for rationale on narrowing the scope). For an expandable node that fails, `NodeEval.error` is populated; ancestors that transitively depend on it propagate failure upward via the same channel, but unrelated subtrees evaluate normally. Root failure throws `EvaluationError`. Kernel-node failures retain pre-v1 behavior (throw out of `walk`).

### Deliberately out of scope

- **Infinite-loop / runaway-CPU detection inside Lua.** A wall-clock budget per `expand` call is a property of `ExpandableNodeType`, not of Lua specifically; if/when needed, add it once at the engine level rather than burying it inside the Lua runtime.
- **Partial-output recovery.** Lua's contract is "return the full tree or throw." No salvage.

## Testing strategy

### Unit tests in `@yacad/lua` (no Wasmoon)

- `canonicalizeDefinition`: stable under key reorderings in `schema`, `inputs`, `params`.
- `hashLuaDefinition`: matches `hash(canonicalizeDefinition(def))`, deterministic across runs.
- `normalizeValues`: every declared param type — happy path, default fill, missing required, type mismatch, out-of-range (`min`/`max`), unknown keys dropped, `vec3` validation matches existing geometry validators.
- `checkInputsAgainstSchema`: arity mismatch, output-type mismatch (2D vs 3D), optional input present + absent.
- `__input_ref` collision: `buildGraph` rejects an authored document containing a node with `type === '__input_ref'` (returns `DagError` flagging the reserved-prefix violation). Same test covers any other `__`-prefixed type.

### Runtime tests in `@yacad/lua` (with `WasmoonLuaRuntime`)

- Determinism: two evaluations of the same `(definition, inputs, values)` produce identical canonical NodeDoc.
- Seeded RNG: `math.random()` sequence reproducible across runs of the same instance; different `values` → different sequence.
- Sandbox: enumerate `_G` after init, assert exact match against the whitelist; assert `os`, `io`, `package`, `require`, `dofile`, `loadfile`, `debug`, `coroutine` all `nil`; assert `math.randomseed` absent.
- Error mapping: syntax error → `LuaError{phase:'compile'}`; runtime throw → `LuaError{phase:'runtime'}` with non-empty `line`; return `nil` or malformed table → `LuaError{phase:'output'}`.
- `geo.*` generation: register a synthetic `KernelNodeType` in a test registry, assert its wrapper appears under `geo.*`.

### Engine integration tests in `@yacad/engine`

- LuaNode end-to-end to a mesh equivalent to a hand-authored DAG (compare via existing geometry-summary helpers).
- Outer cache hit: evaluate twice, assert `LuaRuntime.evaluate` called once (instrumented test runtime).
- Inner cache hit: two distinct LuaNodes whose emitted sub-trees share a primitive — assert kernel called once for the shared sub-tree.
- Isolation: a non-root LuaNode that throws at expand → `NodeEval.error` populated, other unrelated subtrees still evaluate; same LuaNode at the root → `EvaluationError` thrown.

### End-to-end scenes in `packages/e2e`

- `lua-gear.json` — procedural gear LuaNode + captured geometry summary.
- `lua-with-input.json` — Lua "array along X" taking a single 3D child.

Treated as the canonical "LuaNode works" gate via the existing snapshot corpus.

### Studio Playwright (smoke only)

- Load a scene with a LuaNode, assert viewport renders, assert inspector shows schema params as editable controls. No deep editor coverage — that's a separate design.

### Performance guards

Land alongside the v1 implementation, joining the existing perf-bench suite (introduced in commit `929c0d4`):

- Cold expand of a small LuaNode under a calibrated bound.
- Warm (outer cache hit) under a bound matching non-Lua nodes — Lua must not run on the hot path.
- A LuaNode-bearing scene in `bench/` so the perf-report script picks it up.
- Numbers calibrated after first runs land; the guard thresholds are committed as part of the implementation PR, not deferred.

## Open questions

- **Computed-property surface for `inputs.*` beyond `outputType`.** `bbox` is the obvious next addition once bbox becomes a first-class cached artifact (already planned per vision §VFS / Object Store). Until then, restricted to `outputType`.
- **Schema editor vs. JSON for LuaDefinitions.** The studio panel design will decide. The data model in this spec is independent of the editing UI.
- **Library / sharing of LuaDefinitions.** Content addressing gives us deduplication and remote sharing for free; an explicit library concept is deferred until usage patterns inform it.
- **Wall-clock budget on `expand`.** Not in v1. If reintroduced, lives on `ExpandableNodeType`, not in Lua specifically.
