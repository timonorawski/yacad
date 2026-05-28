# Studio v2 — Foundation (VFS + Document Store)

**Status:** design approved 2026-05-28. Implementation pending.

This is the first of three planned specs that together define studio v2 — a properly architected replacement for the current monolithic POC studio app:

1. **Foundation** (this spec) — VFS + document store. No UI.
2. **Tree editor** — tree view + per-node property panel + selection model, atop the foundation.
3. **WYSIWYG** — 3D click→node hit-testing, bounding-box widget, contextual tool palette.

The existing `apps/studio` stays in place as a historical reference; v2 lands in a new app slot.

## Context

Today's studio is a single 807-line `App.svelte` that uses a JSON textarea as the editing surface. There is no persistence: a page reload loses all edits. Lua definitions and mesh blobs are pushed to the worker as content-addressable blobs, but the document itself lives only in component state.

The vision (`docs/vision.md` §"Authoring surfaces" and §"VFS / Object Store") calls for:

- An async-uniform VFS that is the source of truth for user content.
- A document model that is the artifact — not the rendered mesh.
- Structured editing surfaces (tree, WYSIWYG, code) that all converge on the same DAG.

This spec lays the foundation those editing surfaces will sit on. The deliverables are two framework-agnostic packages that the studio v2 app and its future editor surfaces will consume.

## Scope

### In scope

- Multi-document library, persisted in IndexedDB.
- Per-document bundled blobs (Lua definitions, mesh imports).
- Framework-agnostic doc-store API with immutable-transformer mutations.
- Schema validation via `buildGraph` on every commit and on every load.
- Snapshot-based undo / redo, session-lifetime only.
- Debounced autosave + explicit save.
- Worker blob sync on document open.
- Test parity between `MemoryVfs` and `IndexedDbVfs`.

### Out of scope (deferred to later specs or follow-ups)

- Any user interface — tree editor is spec 2, WYSIWYG is spec 3.
- File System Access API backend (forward-looking note only).
- Command-log mutation model (forward-looking note; transformer functions are the foundation it will be built on).
- Shared / deduplicated blob pool across documents (forward-looking note).
- Collaboration, share links, remote sync.
- Schema migration / version-upgrade flows.
- Persisted undo / redo history.

## Architecture

Two framework-agnostic packages stacked on the existing `@yacad/dag` and `@yacad/hash`:

```
@yacad/vfs           interface Vfs + IndexedDbVfs + MemoryVfs
                     │
@yacad/doc-store ────┘   library (multi-doc) + session (open doc + history)
```

`@yacad/vfs` is a pure async key-value byte store. It knows nothing about documents or schemas. `@yacad/doc-store` layers project semantics on top: identity, naming, blobs, validation, history.

The studio v2 app wires the doc-store into Svelte through thin reactive adapters; the doc-store itself emits coarse change events and is reusable from any framework or from Node-based tools (CLI export, batch ops, etc.).

## `@yacad/vfs`

```ts
export interface Vfs {
  read(key: string): Promise<Uint8Array | undefined>;
  write(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
}

export class IndexedDbVfs implements Vfs { /* prod */ }
export class MemoryVfs implements Vfs { /* tests, in-RAM scratch */ }
```

- Keys are path-like strings by **convention only**; the Vfs makes no claims about hierarchy.
- Values are byte arrays. Textual content (JSON) is encoded by the caller.
- `read` returns `undefined` (not throw) for a missing key, matching the `ObjectStore` discipline already in `@yacad/cache`.
- `list(prefix)` returns the set of existing keys whose string starts with `prefix`. No globbing, no wildcards — the doc-store builds its own iteration logic on top.
- `IndexedDbVfs` opens a single object store named `vfs` and uses string keys directly. Tests substitute `fake-indexeddb` (mirroring `@yacad/cache`'s pattern).

## Document model

Each document has a **stable UUID** as its canonical identity; the display name is mutable metadata. This means rename never invalidates references (today none exist between documents, but the spec 2 tree editor will likely surface "open recent" lists that key on UUID).

The VFS key layout is convention, not contract:

```
/docs/{uuid}/meta.json                # name, createdAt, updatedAt, thumbnail?
/docs/{uuid}/document.json            # the NodeDoc tree
/docs/{uuid}/blobs/{hash}.bin         # referenced Lua defs / mesh blobs
```

`meta.json` shape:

```ts
interface DocMeta {
  readonly id: string;          // UUID
  readonly name: string;
  readonly createdAt: number;   // ms since epoch
  readonly updatedAt: number;
  readonly thumbnail?: string;  // optional data URL, written by editor later
}
```

The blob set is **bundled per document**: deleting a document deletes every key under `/docs/{uuid}/`. No cross-document references, no orphan tracking. Forward-looking deduplication is noted below but is not required for v1.

## `@yacad/doc-store`

### Library — multi-doc management

```ts
interface DocLibrary {
  list(): Promise<readonly DocMeta[]>;
  open(id: string): Promise<DocSession>;
  create(name: string, seed?: NodeDoc): Promise<DocSession>;
  rename(id: string, name: string): Promise<void>;
  delete(id: string): Promise<void>;
}
```

- `create` writes `meta.json` + `document.json` (with `seed`, or — if omitted — a minimal default of `{ type: 'box', params: { size: [10, 10, 10], center: true } }`, which is the smallest legal NodeDoc that produces visible geometry), then `open`s the session.
- `delete` removes every VFS key under the doc's prefix.
- `rename` rewrites `meta.json` only.
- The library is constructed with a `Vfs` and a `BlobUploader` (a narrow interface — `putMeshBlob` / `hasMeshBlob` / `putLuaDefinition` / `hasLuaDefinition` — that `@yacad/worker`'s `WorkerClient` structurally satisfies). The doc-store imports neither `@yacad/worker` nor any Svelte type.

### Session — one open document

```ts
interface DocSession {
  readonly id: string;
  readonly meta: DocMeta;
  readonly doc: NodeDoc;                       // current snapshot, frozen
  readonly blobs: ReadonlyMap<Hash, Uint8Array>;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isDirty: boolean;
  readonly state: 'live' | 'invalidated';

  mutate(fn: (prev: NodeDoc) => NodeDoc): Promise<void>;
  addBlob(bytes: Uint8Array): Promise<Hash>;   // hashes, stores, uploads to worker
  undo(): void;
  redo(): void;
  save(): Promise<void>;                       // explicit; autosave runs too
  close(): Promise<void>;                      // flush + tear down

  subscribe(cb: (evt: DocEvent) => void): () => void;
}

type DocEvent =
  | { kind: 'doc-changed' }                    // any commit (mutate / undo / redo)
  | { kind: 'meta-changed' }                   // name etc.
  | { kind: 'persisted' }                      // save flushed
  | { kind: 'invalidated'; error: Error };     // worker / persistence failure
```

### Mutation flow

`session.mutate(transformer)`:

1. `next = transformer(current)` — produces a candidate NodeDoc.
2. `await buildGraph(next, defaultHasher, '$', sessionResolver)` validates the schema, normalizes params, computes hashes. `sessionResolver` exposes the session's blobs to decoder / expandable node types.
3. On validation failure: throw, current state untouched, no event emitted.
4. On success: push current onto the undo stack, set `current = next`, mark dirty, emit `doc-changed`. Trigger debounced autosave.

While a `mutate` call is in flight, `session.doc` continues to return the previous committed snapshot. The promise resolves (or rejects) before any visible state changes — there is no optimistic update phase. This keeps the invariant that `session.doc` is always a buildGraph-valid NodeDoc.

`buildGraph` runs on every commit — **not** every keystroke. The tree editor (spec 2) holds local UI state for in-flight property edits and only invokes `mutate` on a commit event (blur / Enter / explicit Apply).

### Blob upload

`session.addBlob(bytes)`:

1. Hash the bytes via the shared `Hasher`.
2. Insert into `session.blobs` (no-op if already present).
3. Upload to the worker via `workerClient.putMeshBlob(hash, bytes)` if not already present.
4. Return the hash so the caller can reference it in a mutation.

Blobs accumulate in the worker across documents — content addressing makes uploads idempotent, so switching documents that share an asset is cheap. LRU eviction in the worker is a forward-looking note.

## Persistence

- **Autosave:** debounced 500 ms after the last mutation. Writes `document.json`, `meta.json` (if changed), and any newly added blob files.
- **Explicit save:** `session.save()` flushes immediately and resolves when bytes are durable.
- **Dirty flag:** `isDirty = true` between mutation and successful persist; cleared by a successful autosave or explicit save.
- **No history persisted:** undo / redo stacks are session-lifetime only. Persisted history is a forward-looking note.
- **`close()`** drains any pending autosave before resolving.

## Validation at load time

On `library.open(id)`:

1. Load `meta.json` and `document.json` from the VFS.
2. Enumerate `/docs/{id}/blobs/*` and load each into the session's blob map.
3. Push the blobs the worker is missing, via `hasMeshBlob` / `putMeshBlob` (and the Lua equivalents).
4. Run `buildGraph` on the loaded `document.json`. On success the session enters `'live'` state and an initial evaluation can run. On failure, the session enters `'invalidated'` state:
   - `state === 'invalidated'`
   - `mutate` rejects
   - `doc` still exposes the raw parsed JSON for inspection by the UI (spec 2 will surface this)
   - A `{ kind: 'invalidated', error }` event is emitted to subscribers

Doc-store rejects gracefully; it never throws into the constructor's call chain past `open`.

## Reactivity model

`session.subscribe(cb)` returns an unsubscribe function. Events are coarse — `doc-changed` says "something in the doc changed; re-read what you care about." Spec 2's tree editor derives finer-grained diffs by comparing before / after snapshots itself.

The doc-store does not depend on Svelte. The studio v2 app supplies thin `$state` adapters at the boundary.

## Worker integration

The doc-store talks to the worker through the narrow `BlobUploader` interface defined in `@yacad/doc-store`:

```ts
export interface BlobUploader {
  putMeshBlob(hash: Hash, bytes: Uint8Array): Promise<void>;
  hasMeshBlob(hash: Hash): Promise<boolean>;
  putLuaDefinition(hash: Hash, def: LuaDefinition): Promise<void>;
  hasLuaDefinition(hash: Hash): Promise<boolean>;
}
```

`@yacad/worker`'s `WorkerClient` already implements every one of these methods, so it satisfies the interface structurally. The doc-store does **not** import `@yacad/worker` — keeping the dependency direction clean (worker depends on doc-store would create a cycle; doc-store depends on worker would couple non-UI logic to the transport layer).

`client.evaluate(doc, tier)` stays out of the doc-store's surface entirely. Evaluation is the editor's concern: it knows when to debounce, when to suppress, and when to surface results.

Blob upload is the doc-store's responsibility because it owns the session lifecycle. Triggering evaluations is the editor's responsibility because the editor knows when to debounce, when to suppress, and when to surface results.

## Test strategy

- **`@yacad/vfs`:** a parametric test suite runs against both `MemoryVfs` and `IndexedDbVfs` (the latter via `fake-indexeddb`). Asserts that the two impls produce identical externally visible behavior — round-trip read / write, missing-key reads, list-by-prefix semantics, deletion.
- **`@yacad/doc-store`:** tests run against `MemoryVfs` and a stub worker client. This requires extracting a narrow `BlobUploader` interface from the current `WorkerClient` (the subset doc-store actually depends on: `putMeshBlob` / `hasMeshBlob` / `putLuaDefinition` / `hasLuaDefinition`), so the test stub is a few lines rather than a full WorkerClient mock. `WorkerClient` continues to satisfy `BlobUploader` structurally. Coverage:
  - Library: `create` / `list` / `open` / `rename` / `delete` round-trip.
  - Session happy path: `mutate` commits, `doc` reflects, subscribers fire.
  - Validation rejection: `mutate` with an invalid transformer leaves state unchanged and emits no event.
  - Undo / redo: stack semantics, including redo invalidation after a new mutation.
  - Autosave debounce: rapid mutations coalesce into one VFS write.
  - Invalid persisted doc opens in `invalidated` state.
  - Blob upload idempotence: same hash uploaded twice = one `putMeshBlob` call.
  - `close()` drains pending autosave.

## Forward-looking notes (not implemented in this spec)

- **Command-log architecture.** Each mutation site in spec 2 (set-param, wrap-with, insert-child, …) will become a named command. The current transformer becomes the command's `apply` step; the command also carries a serializable description for audit log / collaboration / replay. The mutation API stays — the dispatcher gains a wrapper that records the command before calling `mutate`.
- **Shared blob pool.** Refcounted blob storage across documents. VFS interface unchanged; doc-store gains ref tracking + a sweep. Trigger if mesh-import duplication becomes a real footprint problem.
- **File System Access API backend.** Implement `Vfs` against FSAccess for "real files on disk." Doc-store is unaware. Chrome-only at time of writing; IndexedDb stays the default backend.
- **Persisted undo history.** Write the undo stack alongside `document.json`. Bounded depth, snapshot compression.
- **Worker LRU.** Cap the worker's blob registry at a working-set size and evict by last-used. Not relevant until users open many large-blob documents in one session.

## Open questions deliberately not resolved here

- **Document seed / templates.** `create` accepts an optional `seed: NodeDoc`. The set of seeds (empty / box-with-sphere / from-scene-library) is a UI concern, decided in spec 2.
- **Thumbnails.** `DocMeta.thumbnail` is reserved as an optional data-URL field. The editor decides when to capture and write it.
- **Schema versioning.** The current `NodeDoc` schema is unversioned. The first migration becomes interesting only when we ship a breaking change to node-type signatures. Out of scope.
