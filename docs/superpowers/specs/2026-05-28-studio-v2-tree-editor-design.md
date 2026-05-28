# Studio v2 — Tree Editor + Selection + Property Inspector

**Status:** design approved 2026-05-28. Implementation pending.

This is the second of three planned specs for studio v2:

1. **Foundation** — VFS + document store (`docs/superpowers/specs/2026-05-28-studio-v2-foundation-design.md`, implemented).
2. **Tree editor** (this spec) — Svelte app with tree pane + per-node property inspector + structural-mutation tools, atop the foundation.
3. **WYSIWYG** — 3D click→node hit-testing, bounding-box widget, contextual 3D tools. Consumes spec 2's `@yacad/selection`.

The existing `apps/studio` remains untouched as a historical reference.

## Context

Spec 1 landed `@yacad/vfs` and `@yacad/doc-store`. A document is loadable, mutable (via immutable transformer fns through `session.mutate`), persisted, and reactive. No UI yet.

This spec lands the editor on top: an `apps/studio2` Svelte app that replaces v1's JSON textarea with a tree view + per-node property forms + curated structural-mutation tools. Layout is three-pane (tree / viewport / inspector), familiar from Houdini and Blender.

The decision to ship full node-type coverage (kernel + Lua + decoder) from day one matches v1's expressiveness — none of v1's scenes need to fall back to a JSON editor in studio v2.

## Scope

### In scope

- `apps/studio2` (Svelte 5, separate from `apps/studio`).
- `@yacad/selection` — small framework-agnostic package: selected-node state + subscribers.
- `@yacad/mutations` — pure NodeDoc → NodeDoc transformer primitives.
- Promote kernel param-schema metadata into `@yacad/dag` as a first-class registry field. `@yacad/lua`'s `KERNEL_TYPE_DOCS` becomes a thin reader over the registry.
- Tree view with collapse / select / single-select highlighting.
- Property inspector dispatching by node-type kind (kernel / Lua / decoder).
- Curated structural-mutation tool palette (wrap-with, add-child, delete, duplicate).
- Document picker (open / create / rename / delete via `DocLibrary`).
- First-run seeding: when the VFS is empty, seed it with v1's example library (static scene JSON files, Lua-parametric definitions, sample mesh blobs, stress-test generators) so the picker starts populated.
- Live evaluation mirroring v1 (debounced commit → worker.evaluate → viewport update).

### Out of scope (deferred)

- 3D click→node hit-testing, bounding-box widget, contextual 3D tools — spec 3.
- Drag-and-drop file upload for decoder nodes — spec 2 ships a `<input type="file">` button.
- Multi-node selection — single-select API today; multi is an additive extension.
- Persistent layout state (resizable splitters with saved sizes).
- Per-keystroke debounced commits with adaptive timing (current model: commit on blur / Enter).
- Auto-generated tool palette from the registry — needs richer "what's a sensible wrap?" metadata on node-types first.
- Command-log architecture — `@yacad/mutations` exports pure transformer functions; the named-command wrapper is a forward-looking note.

## Architecture

```text
@yacad/dag (existing, refactored)
  + paramSchema as a first-class KernelNodeType field
  + KERNEL_TYPE_DOCS content migrated in
@yacad/lua (existing, refactored)
  - geo-docs no longer holds the kernel schemas; reads from the registry instead
@yacad/selection (new)
  Selection class: select / clear / isSelected / subscribe
@yacad/mutations (new)
  pure functions: setParam, addChild, removeAt, replaceAt, wrapWith, moveChild
apps/studio2 (new)
  Svelte 5 app consuming all of the above + the spec-1 foundation
```

Dependency graph stays acyclic. The three new units are testable in isolation. `apps/studio2` is the only Svelte / DOM consumer.

## `@yacad/dag` — schema refactor

The `KernelNodeType` interface gains three new fields — `paramSchema`, `summary`, `outputDoc` — that document the node type in a surface-agnostic way (used by the property inspector, the future-spec WYSIWYG hover tooltip, and any other introspection tool). The existing `ParamDoc` shape moves into `@yacad/dag`, with three additive fields (`min`/`max` for numeric ranges, `enum` for string enums) so the property editor can drive sliders and dropdowns from schema alone.

```ts
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

export interface KernelNodeType {
  // ... existing fields ...
  readonly summary: string; // one-line description of the node type
  readonly outputDoc: string; // human-readable output description, e.g. "3D mesh"
  readonly paramSchema: readonly ParamDoc[];
}
```

The existing `KERNEL_TYPE_DOCS` data (currently in `packages/lua/src/geo-docs.ts`) splits along its concerns:

- `summary`, `outputDoc`, `params` (renamed to `paramSchema`) — move into the registry definitions in `packages/dag/src/registry.ts`. Type-system-level docs.
- `example` (a Lua source snippet) — stays in `@yacad/lua` as a separate per-type map. It's Lua-specific; future authoring surfaces (JSCAD, …) would have their own example maps.

`@yacad/lua`'s `KERNEL_TYPE_DOCS` becomes a derived join: it reads `summary` / `outputDoc` / `paramSchema` from the registry via a new `@yacad/dag` helper `getKernelTypeDoc(type): KernelTypeDocSummary | undefined`, then attaches the Lua-specific `example` from its local map. The existing public surface of `@yacad/lua` (the `KERNEL_TYPE_DOCS` export type) stays compatible so v1's Lua-docs panel keeps rendering.

A new test in `@yacad/dag` pins that every registered KernelNodeType has a non-empty `paramSchema` and a non-empty `summary` — catching omissions as the registry grows.

`ExpandableNodeType` (Lua) and `DecoderNodeType` (mesh imports) are unchanged — their param shapes are dynamic and out-of-band:

- **Expandable** — schema lives in the stored `LuaDefinition.schema.params` (per-instance, looked up via the session resolver by `definitionHash`).
- **Decoder** — fixed shape (just `blobHash`); the inspector for these is a custom blob-picker component, not a paramSchema-driven form.

## `@yacad/selection`

```ts
export class Selection {
  /** Currently-selected node id, or null. */
  get selectedId(): string | null;
  /** Replace the current selection. Emits change to subscribers if changed. */
  select(id: string | null): void;
  /** Convenience for select(null). */
  clear(): void;
  /** Returns true iff `id` is currently selected. */
  isSelected(id: string): boolean;
  /** Subscribe to selection changes; returns unsubscribe. */
  subscribe(cb: (selectedId: string | null) => void): () => void;
}
```

Single-select for spec 2. Multi-select is non-breaking-additive: future `selectedIds: ReadonlySet<string>` + `selectAdd` / `selectRemove`. The studio-v2 app owns one `Selection` instance per open session; switching docs swaps the instance.

Tests cover: select fires subscribers; selecting the current id is a no-op (no event); clear; isSelected; subscribe returns working unsubscribe; subscribers added during dispatch don't see the in-flight event (matches the discipline established in `@yacad/doc-store`).

## `@yacad/mutations`

Pure transformer functions on `NodeDoc`. Each takes `(doc, path, ...args)` and returns the new `NodeDoc`, or throws if the path doesn't exist or the operation is structurally invalid (e.g., `addChild` on a primitive that takes no children would throw at mutation time even though final validation happens in `session.mutate`).

```ts
export function setParam(doc: NodeDoc, path: string, key: string, value: unknown): NodeDoc;
export function addChild(doc: NodeDoc, parentPath: string, child: NodeDoc, index?: number): NodeDoc;
export function removeAt(doc: NodeDoc, path: string): NodeDoc;
export function replaceAt(doc: NodeDoc, path: string, replacement: NodeDoc): NodeDoc;
export function wrapWith(
  doc: NodeDoc,
  path: string,
  wrapperType: string,
  wrapperParams?: Record<string, unknown>,
): NodeDoc;
export function moveChild(doc: NodeDoc, fromPath: string, toPath: string): NodeDoc;
```

`path` is the authoring id used everywhere else: `'$'` for the root, `'$/0'` for its first child, `'$/0/1'` for the first child's second child. Matches the format `buildGraph` already produces in error paths.

`wrapWith` replaces the node at `path` with `{ type: wrapperType, params: wrapperParams ?? {}, children: [node] }`. The studio invokes this with sensible defaults baked in (e.g., translate by `[0, 0, 0]`, rotate by `[0, 0, 0]`).

All functions return a structurally-new tree — no in-place mutation. Callers pass them to `session.mutate(prev => mutations.setParam(prev, ...))`, where the doc-store runs `buildGraph` validation and either commits or rejects.

Tests: pure-function tests against fixture DAGs. No I/O.

## `apps/studio2`

Top-level: `App.svelte` wires the three panes and owns the doc-store / worker-client / viewport / selection lifecycle. The studio v2 app is the only DOM consumer.

```text
apps/studio2/
  package.json
  vite.config.ts            # mirrors v1's aliases + worker config
  tsconfig.json
  src/
    main.ts                 # mount; resolve manifold url
    worker.ts               # worker host bootstrap (mirrors v1's pattern)
    seed-scenes.ts          # first-run library seeder (see § Seeding)
    App.svelte              # shell: doc picker, layout, status bar
    state/
      session.svelte.ts     # Svelte adapter wrapping DocSession (subscribes → re-derives)
      selection.svelte.ts   # Svelte adapter wrapping Selection
    ui/
      DocPicker.svelte
      TreePane.svelte       # left pane: tree + tool palette header
      TreeNode.svelte       # recursive tree row (collapsible, selectable)
      ToolPalette.svelte    # wrap-with / add-child / delete / duplicate
      ViewportPane.svelte   # center pane: viewport + eval-stats footer
      InspectorPane.svelte  # right pane: dispatches by node-type kind
      inspectors/
        KernelInspector.svelte   # paramSchema-driven form
        LuaInspector.svelte      # LuaDefinition.schema.params-driven form
        DecoderInspector.svelte  # blob picker (file input)
        InvalidatedInspector.svelte  # shows invalidationError + reset hint
      forms/
        NumberField.svelte
        IntField.svelte
        BoolField.svelte
        StringField.svelte
        Vec2Field.svelte
        Vec3Field.svelte
        EnumField.svelte
```

Each `.svelte` file has one responsibility. The `forms/*` field components share a uniform shape: props `{ value, schema, onCommit }`; they hold their own in-flight `$state` and call `onCommit(value)` on blur or Enter.

## Mutation flow

1. User edits a form field. The field's `$state` tracks the in-flight value — the doc is not mutated yet.
2. On commit (blur / Enter), the field calls `onCommit(value)`.
3. The parent inspector wraps the commit: `session.mutate(prev => mutations.setParam(prev, node.id, paramName, value))`.
4. `session.mutate` runs `buildGraph` to validate. On success: doc-changed → Svelte adapters re-derive → tree highlights the (now-updated) node, viewport re-evaluates via the existing eval pipeline.
5. On failure (validation throws): the inspector catches, surfaces the error inline (red border + tooltip), and keeps the field's local state so the user can fix without losing input.

Structural mutations (wrap-with, add-child, delete, duplicate) commit immediately on button click — no local-state phase, the user clicks the tool and the doc updates (or shows an error toast if validation fails).

## Property inspector dispatch

`InspectorPane.svelte` looks up the selected node by id from `session.doc`, then renders one of:

- `def.kind === 'kernel'` → `<KernelInspector schema={def.paramSchema} node={selected} />` renders one form-field per `ParamDoc`.
- `def.kind === 'expandable'` (Lua) → `<LuaInspector node={selected} resolver={session.blobs} />` looks up the `LuaDefinition` by `node.params.definitionHash`, renders a form from `definition.schema.params`. The current child inputs are shown in a small header strip ("inputs: 0=body (3D)").
- `def.kind === 'decoder'` (mesh import) → `<DecoderInspector node={selected} session={session} />` shows the current `blobHash`, blob byte-size from `session.blobs.get(hash).length`, and a "Replace…" button. The button opens a hidden `<input type="file">`, reads the chosen bytes, calls `session.addBlob(bytes)`, then `session.mutate(prev => mutations.setParam(prev, node.id, 'blobHash', newHash))`.
- `session.state === 'invalidated'` → `<InvalidatedInspector error={session.invalidationError} />` showing the raw error and a hint to revert via the JSON view (which the studio doesn't yet expose — for spec 2, an error-state recovery flow is a stub; "reset to last valid" is a follow-up).

Each form-field component receives the relevant slice of the `ParamDoc` and decides how to render. `min`/`max` make a `NumberField` show a range slider; `enum` makes a `StringField` show a dropdown.

## Tool palette

Curated, not auto-generated. The palette lives at the top of the tree pane and exposes:

- **Wrap with…** — dropdown opens to a list of compatible wrappers based on the selection's output type (e.g., 3D node → `translate`, `rotate`, wrap into the first child of a new `union` / `difference`; 2D node → `translate_2d`, `rotate_2d`, `extrude`, `revolve`, etc.). Selecting an item invokes `mutations.wrapWith` with sensible defaults.
- **Add child** — only enabled when the selected node's type accepts children (N-ary booleans, transforms, refinements, bridges). Dropdown of children types compatible with the operator's child requirements.
- **Delete** — calls `mutations.removeAt`. Disabled at the root.
- **Duplicate** — creates a sibling copy inside the nearest ancestor `union` (or wraps current parent in a `union` if needed). Disabled if no ancestor can accept a sibling.

The curated dropdown contents are defined inline in the studio (a small per-output-type map). A future iteration can replace this with metadata on the registry once we agree on what "sensible wraps for type X" means as a schema concept.

## Live evaluation

Same model as v1. Every commit emits a `doc-changed` event from the session; the Svelte adapter debounces (150ms) and calls `client.evaluate(currentDoc)`. The viewport's status indicator uses the 50ms debounce v1 introduced — warm-cache hits don't flicker the "Evaluating…" label.

## Document picker

`DocPicker.svelte` at the top of the app shows the current document's name. Click to open:

- A list of `library.list()` results, most-recently-updated first.
- Each row has inline rename / delete (with confirm).
- "New document…" creates with a default name ("Untitled"), seeds with the registry's default seed, opens the new session.
- "Import from JSON…" parses a pasted/uploaded NodeDoc, calls `library.create(name, seed)`.

When the user switches docs:

1. `await currentSession.close()` (flushes autosave).
2. `currentSession = await library.open(newId)` — loads + worker-syncs (spec 1 behavior).
3. Replace the Svelte adapters' subscriptions.
4. `selection.clear()` — new doc starts unselected.
5. Trigger the first `client.evaluate`.

## Seeding the scene library on first run

V1 ships with a curated picker of example scenes (primitives, transforms, booleans, 2D shapes, composites, Lua-parametric examples, mesh imports, edge cases, plus on-demand stress-test generators). Studio v2 preserves that library by **seeding the VFS** on first run instead of treating the examples as ephemeral imports.

The trigger: when `App.svelte` mounts and `library.list()` returns an empty array, run a one-shot seeder. The seeder lives in `apps/studio2/src/seed-scenes.ts` and consumes the same source files v1 imports (`packages/e2e/scenes/*.json` via `?raw`, plus the GEAR / ARRAY_ALONG_X / FLOWER Lua definitions from `@yacad/e2e/fixtures`, plus the procedurally-generated tree / transform-chain / boolean-nest stress-test DAGs).

For each seed entry the seeder:

1. Parses the JSON or constructs the NodeDoc.
2. For Lua-bearing seeds: calls `session.addBlob(canonicalBytes(luaDefinition))` (or the corresponding `putLuaDefinition` path) so the referenced definition is registered before the doc validates.
3. For mesh-import seeds: hashes the sample blob bytes and calls `session.addBlob(bytes)`.
4. Calls `library.create(name, seed)` — which writes meta + doc + (via the open path that follows) syncs to the worker.
5. Closes the session.

Idempotency: the seeder only runs when `list()` is empty. Once any document exists in the user's library — including a deleted-then-re-added scene — the seeder never runs again. Users can delete scenes they don't want without them coming back.

The seeded documents are **canonical** NodeDoc representations — the same JSON files v1 imports today. No format conversion needed; spec 1's doc-store handles them as-is. The seeder is essentially a list of `(name, seed)` pairs plus a side-channel for blobs.

Forward-looking: versioned seeding (a future studio release adds new examples retroactively) requires an indicator key in the VFS so the seeder knows which versions it has applied. Out of spec 2 scope — when we want this, add a `/seed-version` key under VFS and a per-version delta.

**Phase 2.1 — scene-library audit + headline examples.** After spec 2 implementation lands, do a focused pass on the example library:

1. **Feature-coverage audit.** Walk every registered node type (kernel, Lua, decoder) and verify at least one seed scene exercises it — particularly the 2D-layer node types and the mesh-import decoders, which are under-represented in v1's library today. Add minimal scenes for any gaps.
2. **Headline examples.** Build a small set of genuinely complex showcase scenes that exercise the studio's full surface area — a house (walls, windows, roof, parametric room counts), a castle (battlements, towers, courtyard layout), realistic vegetation (a procedural tree with leaves imported from a glTF asset, exercising Lua nodes + mesh-import + booleans + arrays). These double as smoke tests for the editor's ergonomics — if assembling them is painful, that surfaces concrete UX bugs to fix.

Both items live in this same `seed-scenes.ts` module; they're additive to the initial seeded set.

## Validation feedback

- **Field-level:** form fields render an error state (red border, tooltip) when the most recent `session.mutate` rejected with a buildGraph error pointing at that node + param. The doc state is unchanged; the field keeps its local edit.
- **Document-level:** an `invalidated` session shows `InvalidatedInspector` in the right pane. The tree pane greys out (mutation tools disabled). The viewport shows the last successful evaluation (so the user can still see what's there).

## Testing strategy

- **`@yacad/selection`:** unit tests for select/clear/isSelected, subscribe semantics, subscribe-during-dispatch isolation.
- **`@yacad/mutations`:** pure-function tests against fixture DAGs — happy paths + error cases (invalid path, structural mismatch).
- **`@yacad/dag` schema refactor:** existing tests stay green; new test pins that every registered KernelNodeType has a non-empty `paramSchema`.
- **`@yacad/lua` refactor:** the geo-docs test updates to verify generated docs cover every kernel type from the registry.
- **`apps/studio2`:**
  - Component-level Svelte tests (`*.svelte.test.ts`) for inspectors and form fields where dispatch logic is non-trivial.
  - Playwright e2e tests cover the golden paths: open doc, edit param, see viewport update; wrap-with-translate adds a node; delete removes it; switch doc; reload restores from IndexedDB; an invalidated doc displays the error.

## Forward-looking notes

- **Command-log architecture.** Each `@yacad/mutations` function pairs with a `{ kind, ...args }` descriptor; the current transformer is the command's `apply` step. Adds replay / audit log / collaboration substrate.
- **Auto-generated tool palette.** Requires richer node-type metadata describing "what's a sensible wrap for output type X" — a separate metadata concept. Curated list ships in spec 2; auto-generation comes after the metadata extension.
- **Per-keystroke debounced commits with adaptive timing.** Commit immediately on input change with a debounce window scaled by the most recent subtree's evaluation round-trip — cheap subtrees commit fast, expensive ones commit only after the user pauses. Spec 2 ships commit-on-blur-or-Enter; this refinement extends the same flow with a timer.
- **Drag-and-drop blob upload.** A drop zone on the viewport (spec 3 territory) creates `import-*` nodes automatically by sniffing the file extension. Same `addBlob` plumbing.
- **WYSIWYG integration (spec 3).** Hit-testing calls `selection.select(nodeId)`. The bounding-box widget reads geometry from the viewport's evaluated state. Selection is the integration point.
- **Multi-select.** `selectedIds: ReadonlySet<string>` plus `selectAdd` / `selectRemove`; non-breaking additive change to the Selection API.
- **Resizable panes with saved layout.** localStorage-backed pane sizes; separate from `@yacad/vfs` (UI preference, not document content).
- **Richer field widgets.** Color pickers per a future `'color'` ParamDoc.type, range sliders with units, expression-string inputs that resolve at evaluation time. All additive — each is a new field component dispatched from `ParamDoc.type`.
- **"Reset to last valid" in invalidated state.** Needs per-session tracking of the last buildGraph-valid snapshot. Out of spec 2 scope; placeholder lives in `InvalidatedInspector` as a disabled button.

## Open questions deliberately not resolved

- **Tree drag-to-reorder.** The `moveChild` mutation exists but no UI affordance is specified. Could be drag-and-drop in the tree, up/down buttons, or both — leaving this to the implementer.
- **Keyboard shortcuts.** Cmd-Z / Cmd-Shift-Z for undo/redo are obvious; nothing else is specified. The Svelte components can wire shortcuts as they're built.
- **Empty-tree state.** What does the inspector show when no node is selected? Probably a hint like "Select a node from the tree to edit its parameters." Out of structural scope; the implementer picks a sensible empty state.
