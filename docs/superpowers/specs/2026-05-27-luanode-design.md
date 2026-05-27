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

A LuaNode declares zero-or-more typed inputs (matched positionally to the DAG node's `children`) and a `params` schema, and produces output of a declared type. Generators (no children) and transformers (one child) are special cases of the general shape. *Rejected:* restricting to pure generators initially — it would force a redesign of the node-type machinery when we add transformer-style code nodes, which is imminent.

### Lua emits a sub-DAG; expansion happens at evaluation time on cache miss

LuaNode appears in the document as a single opaque node. Its semantic hash =
`hash("lua", canonical({definitionHash, values}), child_hashes)`.
The engine caches its output mesh under that hash. On cache miss, Lua runs and emits a sub-DAG of primitives; the engine walks that sub-DAG, with each emitted node going through the normal cache path. *Rejected:* expanding at `buildGraph` time (forces Lua to run on every document load, loses the outer cache benefit) and direct kernel calls from Lua (forfeits all inner cache benefits, couples Lua to the kernel API). The chosen design gives two-level caching: outer hit means Lua never runs; outer miss still benefits from inner hits across LuaNodes and against hand-authored content.

### The LuaDefinition is a structured object, not parsed-out-of-source

```
LuaDefinition = { schema: { inputs, params, output }, code: "<lua source>" }
```

Schema and code live side by side as a single content-addressable artifact. The schema is queryable by inspectors and type-checkers without running Lua. A future AST validator cross-checks code against schema; until then, mismatches surface as Lua runtime errors at evaluation. *Rejected:* declaring schema inline in Lua source (requires extracting it via either a Lua run or an AST pass before tooling can introspect — extra dependency, more failure modes) and declaring schema and code as independent document fields (silent drift between them).

### Lua sees opaque input handles with computed properties on demand

`inputs.foo` is a reference Lua composes into the emitted sub-DAG. Computed properties — initially just `outputType`, later `bbox` once that's a first-class cached artifact — trigger lazy child evaluation through the normal cache path. *Rejected:* eagerly evaluating children to meshes before running Lua (breaks the lazy story, forces evaluation even when Lua wouldn't use the input) and pure-opaque (too restrictive: cannot write bbox-driven layout).

### `geo.*` API generated from the kernel-node registry, `geo.node` as primitive

Lua's only side effect is producing a `NodeDoc` tree. The API surface is a `geo` table containing one wrapper per registered kernel-backed node type (`geo.box`, `geo.union`, ...), generated from the registry. `geo.node(type, params, children)` is the underlying primitive — Lua can drop to it for dynamic dispatch or for types not yet wrapped. *Rejected:* bare global functions (pollutes `_G`, fragile to user variables, harder to evolve) and `geo.node` only (verbose enough that every user would write their own wrappers — better to ship one canonical set).

**LuaNode emitting another LuaNode is disallowed in v1.** Representable but introduces a recursive-definition-hash problem better deferred. The wrapper layer only exposes kernel-backed node types.

### Wasmoon as the Lua runtime

Real Lua 5.4 compiled to WASM. Runs in the worker. Sandboxing strategy: build a custom `_G` containing only whitelisted modules (`math`, `string`, `table` minus impure entries; `geo`; `inputs`; `params`). *Rejected:* Fengari (pure-JS Lua 5.3, smaller bundle but slower and bus-factor concern) and a custom DSL (substantial implementation cost, loses Lua's ecosystem and familiarity).

`math.random` is seeded deterministically from the LuaNode-instance hash (definition hash XOR canonical(values) truncated to 32 bits). Same instance → same random sequence across evaluations.

### Evaluation abstraction: `ExpandableNodeType`

The discriminator between "node types whose evaluation invokes a kernel" and "node types whose evaluation emits a sub-DAG that the engine then walks" is general, not Lua-specific. The same mechanism will host future code-node languages, ML-driven generators, and hand-rolled TS procedural library nodes. Reified as a discriminated union in `NodeTypeDef`.

## Architecture

### Layered placement

```
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
                    Per-node failure isolation (engine no longer aborts on a single
                    node's exception unless the failed node is the root).

@yacad/worker     — Hosts LuaRuntime alongside the kernel.
                    Protocol gains putLuaDefinition(hash, def) and a definition cache.

@yacad/cache      — Artifact union gains { kind: 'luaDefinition', definition: LuaDefinition }.

@yacad/studio     — (out of scope) Schema+code editor panel, definition synchronization
                    to the worker, error surfacing on the offending node.
```

Dependency flow (unchanged at the package-graph level, just adds `@yacad/lua` as a peer of `@yacad/kernel-manifold`):

```
canonical → hash ┐
geometry ────────┼→ dag → kernel-manifold ┐
                 ├→ lua  ────────────────┤
                 └→ cache ────────────────┼→ engine → worker → studio
                    render ───────────────┘            render ─┘
```

### `NodeTypeDef` discriminated union

```ts
// existing path — primitives, transforms, booleans
interface KernelNodeType {
  readonly kind: 'kernel'
  readonly type: string
  readonly output: GeometryType
  checkChildren(children: readonly Node[], path: string): void
  normalizeParams(params: unknown, path: string): Record<string, unknown>
}

// new path — code-driven, sub-DAG-emitting
interface ExpandableNodeType {
  readonly kind: 'expandable'
  readonly type: string
  resolveOutput(
    params: Record<string, unknown>,
    resolver: DefinitionResolver,
  ): GeometryType
  checkChildren(
    children: readonly Node[],
    params: Record<string, unknown>,
    resolver: DefinitionResolver,
    path: string,
  ): void
  normalizeParams(
    params: unknown,
    resolver: DefinitionResolver,
    path: string,
  ): Record<string, unknown>
  /**
   * Pure function of normalized params + input refs. The contract is:
   *   - deterministic given identical inputs (cache correctness)
   *   - returns a NodeDoc tree which may contain `__input_ref` sentinels
   *     whose params.name matches one of the declared inputs
   *   - the engine resolves sentinels to child nodes during walk
   */
  expand(
    params: Record<string, unknown>,
    inputs: InputRef[],
  ): Promise<NodeDoc>
}

type NodeTypeDef = KernelNodeType | ExpandableNodeType
```

The seven existing POC node types remain `kind: 'kernel'` and are behaviorally unchanged.

### `__input_ref` reserved sentinel

A reserved internal node type used only inside the sub-DAGs emitted by `expand`:

```
{ type: '__input_ref', params: { name: '<input name>' } }
```

Not registered in the public node registry; never appears in authored documents. `Engine.walk` substitutes each sentinel with the corresponding child of the LuaNode (or other expander) before continuing the walk.

### LuaDefinition

Content-addressable artifact, stored in the same object store as meshes/bboxes under a synthetic cache key:

```
key = {
  semanticHash:   <definitionHash>,
  producedBy:     { kernel: 'lua-definition', kernelVersion: '0',
                    engineVersion: '0', qualityTier: 'definition' }
}
```

Reusing the structured key shape avoids special-casing the store. A "library" of LuaDefinitions is just whichever definitions happen to persist in IndexedDB (or, later, a remote tier).

### `@yacad/lua` public surface

```ts
// schema model
export type GeometryType = '2d' | '3d'
export interface LuaInputDecl  { name: string; type: GeometryType; optional?: boolean }
export interface LuaParamDecl  {
  type: 'int' | 'number' | 'boolean' | 'string' | 'vec3'
  default?: unknown
  min?: number
  max?: number
}
export interface LuaSchema     {
  inputs: LuaInputDecl[]
  params: Record<string, LuaParamDecl>
  output: GeometryType
}
export interface LuaDefinition { schema: LuaSchema; code: string }

// identity + validation
export function canonicalizeDefinition(def: LuaDefinition): string
export function hashLuaDefinition(def: LuaDefinition, hasher: Hasher): Promise<Hash>
export function normalizeValues(
  schema: LuaSchema,
  values: unknown,
  path: string,
): Record<string, unknown>
export function checkInputsAgainstSchema(
  schema: LuaSchema,
  children: readonly Node[],
  path: string,
): void

// resolver — supplied by the host (studio main thread or worker side)
export interface LuaDefinitionResolver {
  get(hash: Hash): LuaDefinition | undefined
}

// runtime — engine talks to this, not to Wasmoon directly
export interface InputRef {
  readonly name: string
  readonly type: GeometryType
  /** Computed properties resolved lazily through cached artifacts. */
  outputType(): GeometryType
  // bbox(), etc. added when those become first-class cached artifacts.
}
export interface LuaRuntime {
  evaluate(
    def: LuaDefinition,
    inputs: InputRef[],
    values: Record<string, unknown>,
  ): Promise<NodeDoc>
  dispose(): void
}
export class WasmoonLuaRuntime implements LuaRuntime { /* ... */ }

// factory — wires the runtime + resolver into an ExpandableNodeType
export function makeLuaNodeType(
  runtime: LuaRuntime,
  resolver: LuaDefinitionResolver,
): ExpandableNodeType
```

### Engine changes

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

Per-node failure isolation: `walk` catches errors at the node boundary. The `NodeEval` for that node carries an `error?: { kind: 'lua' | 'kernel' | 'dag'; message: string }`. The walk continues for siblings/ancestors as much as possible. Only a root-node failure surfaces as a thrown `EvaluationError` to the caller; non-root failures degrade gracefully (parent nodes that depend on the failed child still report failure upward, but other unrelated subtrees evaluate normally). Behavioral change applies to both branches.

### Worker integration

Protocol additions:

```
{ kind: 'putLuaDefinition', hash: Hash, definition: LuaDefinition }
  → { kind: 'ok' }

{ kind: 'hasLuaDefinition', hash: Hash }
  → { kind: 'ok', present: boolean }
```

The studio collects all `definitionHash`es referenced by the document, calls `hasLuaDefinition` for each (cheap), `putLuaDefinition` for any the worker doesn't have, then sends the existing `evaluate` message. The worker holds a `LuaDefinitionResolver` backed by the cache; both `buildGraph` and the LuaRuntime read from it.

Worker init carries the existing `manifold.wasm` URL plus a new `lua.wasm` (Wasmoon) URL — same pattern: main thread resolves the asset, sends the URL to the worker, worker loads it once on first need.

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
   - `_G` whitelist: `math` (minus `randomseed`; `random` is seeded), `string`, `table`, `geo`, `inputs`, `params`. Everything else absent.
   - `geo.*` generated from the `KernelNodeType` registry; `geo.node(type, params, children)` underneath.
   - `math.random` seed: `definitionHash` XOR `canonical(values)` hashed and truncated to 32 bits.
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
  readonly phase: 'compile' | 'runtime' | 'output'
  readonly line?: number
  readonly column?: number
  readonly cause?: Error // populated when phase === 'output' and the cause is a DagError
}
```

- `phase: 'compile'` — Lua failed to parse. Line/col from Wasmoon's trace.
- `phase: 'runtime'` — Lua threw at runtime. Includes sandbox-violation attempts (`os.time()` → "attempt to index nil value 'os'").
- `phase: 'output'` — Lua returned something other than a valid NodeDoc, or the emitted sub-DAG failed `buildGraph` (wraps the inner `DagError` via `cause`).

### Engine isolation

`Engine.walk` catches errors at each node boundary and records them on `NodeEval.error`. Non-root failures degrade locally: dependent ancestors fail, unrelated subtrees evaluate fine. Root failure throws `EvaluationError` to the caller. Behavioral change applies to both kernel and expandable nodes.

### Deliberately out of scope

- **Infinite-loop / runaway-CPU detection inside Lua.** A wall-clock budget per `expand` call is a property of `ExpandableNodeType`, not of Lua specifically; if/when needed, add it once at the engine level rather than burying it inside the Lua runtime.
- **Partial-output recovery.** Lua's contract is "return the full tree or throw." No salvage.

## Testing strategy

### Unit tests in `@yacad/lua` (no Wasmoon)

- `canonicalizeDefinition`: stable under key reorderings in `schema`, `inputs`, `params`.
- `hashLuaDefinition`: matches `hash(canonicalizeDefinition(def))`, deterministic across runs.
- `normalizeValues`: every declared param type — happy path, default fill, missing required, type mismatch, out-of-range (`min`/`max`), unknown keys dropped, `vec3` validation matches existing geometry validators.
- `checkInputsAgainstSchema`: arity mismatch, output-type mismatch (2D vs 3D), optional input present + absent.

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

- Cold expand of a small LuaNode under a calibrated bound.
- Warm (outer cache hit) under a bound matching non-Lua nodes — Lua must not run on the hot path.
- Numbers calibrated after first runs land.

## Open questions

- **Computed-property surface for `inputs.*` beyond `outputType`.** `bbox` is the obvious next addition once bbox becomes a first-class cached artifact (already planned per vision §VFS / Object Store). Until then, restricted to `outputType`.
- **Schema editor vs. JSON for LuaDefinitions.** The studio panel design will decide. The data model in this spec is independent of the editing UI.
- **Library / sharing of LuaDefinitions.** Content addressing gives us deduplication and remote sharing for free; an explicit library concept is deferred until usage patterns inform it.
- **Wall-clock budget on `expand`.** Not in v1. If reintroduced, lives on `ExpandableNodeType`, not in Lua specifically.
