# Studio v2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `@yacad/vfs` (async key-value blob store + IndexedDB and Memory impls) and `@yacad/doc-store` (multi-doc library + per-doc session with immutable mutations, snapshot undo, autosave, schema validation via `buildGraph`). Both framework-agnostic. No UI work — that's spec 2.

**Architecture:** Two new packages under `packages/`. `@yacad/vfs` is a thin async key-value byte store with an interface and two impls (parametric tests). `@yacad/doc-store` builds the project semantics on top: identity (UUID), naming, bundled blobs, validation, history, autosave. A narrow `BlobUploader` interface lets the session push blobs to the worker without depending on `@yacad/worker`.

**Tech Stack:** TypeScript 5.x (ESM, strict, project references), pnpm workspaces, Vitest, `fake-indexeddb` (already a workspace dep used by `@yacad/cache`). `crypto.randomUUID()` for document IDs (available in modern browsers, workers, and Node ≥ 19).

**Spec:** `docs/superpowers/specs/2026-05-28-studio-v2-foundation-design.md`

---

## File structure

```
packages/vfs/
  package.json
  tsconfig.json
  src/
    index.ts            # public surface re-exports
    types.ts            # interface Vfs + VfsKey alias
    memory-vfs.ts       # in-RAM Map-backed impl
    indexeddb-vfs.ts    # IndexedDB-backed impl (mirrors @yacad/cache pattern)
    vfs.test.ts         # parametric: same suite runs against both impls

packages/doc-store/
  package.json
  tsconfig.json
  src/
    index.ts            # public surface
    types.ts            # DocMeta, DocEvent, BlobUploader, NewDocSeed
    paths.ts            # VFS key conventions (metaKey, docKey, blobKey, listDocPrefix)
    library.ts          # DocLibrary impl (list/open/create/rename/delete)
    library.test.ts
    session.ts          # DocSession impl (mutate/addBlob/undo/redo/save/close)
    session.test.ts     # mutate, undo/redo, addBlob, autosave, close
    open.test.ts        # library.open: load + validate + invalidated state
```

Root config changes:

- `tsconfig.json` — add `{ "path": "packages/vfs" }` and `{ "path": "packages/doc-store" }` to `references`.
- `vitest.config.ts` — add `'@yacad/vfs'` and `'@yacad/doc-store'` aliases.

The studio app (v1) is **not** wired to these packages — spec 2's studio v2 will consume them. No `apps/studio/vite.config.ts` change needed in this plan.

---

## Task 1: Scaffold `@yacad/vfs` package

**Files:**
- Create: `packages/vfs/package.json`
- Create: `packages/vfs/tsconfig.json`
- Modify: `tsconfig.json` (root, add reference)

- [ ] **Step 1: Create the package.json**

Write `packages/vfs/package.json`:

```json
{
  "name": "@yacad/vfs",
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

Write `packages/vfs/tsconfig.json`:

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

- [ ] **Step 3: Add to root tsconfig references**

In `tsconfig.json` at the workspace root, append to the `references` array:

```json
{ "path": "packages/vfs" }
```

Add it after the existing `{ "path": "packages/import-gltf" }` entry (preserve alphabetical-ish ordering used elsewhere).

- [ ] **Step 4: Install + verify the package builds (empty package OK)**

Run: `pnpm install && pnpm --filter @yacad/vfs build`
Expected: install succeeds, build succeeds (no .ts files to compile yet — tsc emits nothing or an empty dist).

- [ ] **Step 5: Commit**

```bash
git add packages/vfs/package.json packages/vfs/tsconfig.json tsconfig.json pnpm-lock.yaml
git commit -m "feat(vfs): scaffold @yacad/vfs package"
```

---

## Task 2: Vfs interface + MemoryVfs impl (with parametric test scaffolding)

**Files:**
- Create: `packages/vfs/src/types.ts`
- Create: `packages/vfs/src/memory-vfs.ts`
- Create: `packages/vfs/src/index.ts`
- Create: `packages/vfs/src/vfs.test.ts`

- [ ] **Step 1: Write the parametric test suite (failing — implementations don't exist yet)**

Write `packages/vfs/src/vfs.test.ts`:

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbVfs } from './indexeddb-vfs';
import { MemoryVfs } from './memory-vfs';
import type { Vfs } from './types';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

/** Make a unique IndexedDb name per test so parallel tests don't collide. */
let dbCounter = 0;
function makeIndexedDbVfs(): IndexedDbVfs {
  return new IndexedDbVfs(`yacad-vfs-test-${++dbCounter}`);
}

const impls: { name: string; factory: () => Vfs; teardown?: (v: Vfs) => Promise<void> }[] = [
  { name: 'MemoryVfs', factory: () => new MemoryVfs() },
  {
    name: 'IndexedDbVfs',
    factory: () => makeIndexedDbVfs(),
    teardown: async (v) => {
      await (v as IndexedDbVfs).close();
    },
  },
];

describe.each(impls)('Vfs contract — $name', ({ factory, teardown }) => {
  let vfs: Vfs;

  afterEach(async () => {
    if (teardown) await teardown(vfs);
  });

  it('write then read round-trips bytes', async () => {
    vfs = factory();
    await vfs.write('/hello', ENC.encode('world'));
    const got = await vfs.read('/hello');
    expect(got).toBeDefined();
    expect(DEC.decode(got!)).toBe('world');
  });

  it('read of an unknown key returns undefined', async () => {
    vfs = factory();
    expect(await vfs.read('/missing')).toBeUndefined();
  });

  it('write overwrites the previous value at the same key', async () => {
    vfs = factory();
    await vfs.write('/k', ENC.encode('first'));
    await vfs.write('/k', ENC.encode('second'));
    expect(DEC.decode((await vfs.read('/k'))!)).toBe('second');
  });

  it('delete removes the key; subsequent read returns undefined', async () => {
    vfs = factory();
    await vfs.write('/k', ENC.encode('v'));
    await vfs.delete('/k');
    expect(await vfs.read('/k')).toBeUndefined();
  });

  it('delete of an unknown key is a no-op (no throw)', async () => {
    vfs = factory();
    await expect(vfs.delete('/never-existed')).resolves.toBeUndefined();
  });

  it('list returns only keys with the given prefix', async () => {
    vfs = factory();
    await vfs.write('/docs/a/meta.json', ENC.encode('a'));
    await vfs.write('/docs/a/document.json', ENC.encode('a'));
    await vfs.write('/docs/b/meta.json', ENC.encode('b'));
    await vfs.write('/other/x', ENC.encode('x'));

    const aKeys = [...(await vfs.list('/docs/a/'))].sort();
    expect(aKeys).toEqual(['/docs/a/document.json', '/docs/a/meta.json']);

    const docsKeys = [...(await vfs.list('/docs/'))].sort();
    expect(docsKeys).toEqual([
      '/docs/a/document.json',
      '/docs/a/meta.json',
      '/docs/b/meta.json',
    ]);
  });

  it('list returns an empty array for a prefix with no matches', async () => {
    vfs = factory();
    expect(await vfs.list('/nothing/')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (no impls yet)**

Run: `pnpm vitest run packages/vfs`
Expected: FAIL — `Cannot find module './indexeddb-vfs'` and/or `'./memory-vfs'`.

- [ ] **Step 3: Create the interface in `packages/vfs/src/types.ts`**

```typescript
/**
 * Async key-value byte store. Path-like keys are convention, not contract:
 * the Vfs makes no claims about hierarchy. Values are opaque bytes; textual
 * content is encoded by the caller. Backends today: in-memory (tests) and
 * IndexedDB (prod). The interface is shaped to accept a File System Access
 * impl later without churning consumers.
 */
export interface Vfs {
  /** Reads the bytes stored under `key`, or `undefined` if absent. */
  read(key: string): Promise<Uint8Array | undefined>;

  /** Writes `value` at `key`, overwriting any previous value. */
  write(key: string, value: Uint8Array): Promise<void>;

  /** Removes the value at `key`. No-op if absent. */
  delete(key: string): Promise<void>;

  /** Returns every key whose string starts with `prefix`. Order unspecified. */
  list(prefix: string): Promise<readonly string[]>;
}
```

- [ ] **Step 4: Implement MemoryVfs in `packages/vfs/src/memory-vfs.ts`**

```typescript
import type { Vfs } from './types';

/**
 * In-RAM Map-backed Vfs. Returned bytes are *copies* of the stored bytes so
 * mutating one doesn't affect the other — matches IndexedDB's structured-clone
 * semantics and lets tests treat both impls interchangeably.
 */
export class MemoryVfs implements Vfs {
  private readonly map = new Map<string, Uint8Array>();

  async read(key: string): Promise<Uint8Array | undefined> {
    const v = this.map.get(key);
    return v === undefined ? undefined : new Uint8Array(v);
  }

  async write(key: string, value: Uint8Array): Promise<void> {
    this.map.set(key, new Uint8Array(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async list(prefix: string): Promise<readonly string[]> {
    const out: string[] = [];
    for (const k of this.map.keys()) {
      if (k.startsWith(prefix)) out.push(k);
    }
    return out;
  }
}
```

- [ ] **Step 5: Implement IndexedDbVfs in `packages/vfs/src/indexeddb-vfs.ts`**

```typescript
import type { Vfs } from './types';

const DB_NAME = 'yacad-vfs';
const STORE_NAME = 'kv';

/**
 * IndexedDB-backed Vfs. Persistent across reloads. Keys are strings; values
 * are stored as Uint8Array directly (structured clone preserves typed arrays).
 * `list(prefix)` uses an IDBKeyRange bound to keep large stores fast.
 *
 * Available in browsers, Web Workers, and (under fake-indexeddb) Node tests.
 */
export class IndexedDbVfs implements Vfs {
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(
    private readonly dbName: string = DB_NAME,
    private readonly storeName: string = STORE_NAME,
  ) {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const open = indexedDB.open(this.dbName, 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains(this.storeName)) {
            open.result.createObjectStore(this.storeName);
          }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
    }
    return this.dbPromise;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode);
      const req = op(tx.objectStore(this.storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async read(key: string): Promise<Uint8Array | undefined> {
    return this.run<Uint8Array | undefined>('readonly', (s) => s.get(key));
  }

  async write(key: string, value: Uint8Array): Promise<void> {
    await this.run('readwrite', (s) => s.put(value, key));
  }

  async delete(key: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(key));
  }

  async list(prefix: string): Promise<readonly string[]> {
    // Half-open range [prefix, prefix + '￿') covers all keys starting
    // with `prefix` lexicographically — ￿ is the highest code point in
    // the BMP, larger than anything realistic application code emits.
    const range = IDBKeyRange.bound(prefix, prefix + '￿', false, true);
    return this.run<readonly string[]>('readonly', (s) => s.getAllKeys(range) as IDBRequest<readonly string[]>);
  }

  /** Closes the backing connection (mainly for test isolation). */
  async close(): Promise<void> {
    if (this.dbPromise) {
      (await this.dbPromise).close();
      this.dbPromise = undefined;
    }
  }
}
```

- [ ] **Step 6: Wire the public surface in `packages/vfs/src/index.ts`**

```typescript
export { MemoryVfs } from './memory-vfs';
export { IndexedDbVfs } from './indexeddb-vfs';
export type { Vfs } from './types';
```

- [ ] **Step 7: Run the parametric test suite — expect green for both impls**

Run: `pnpm vitest run packages/vfs`
Expected: PASS — 14 tests (7 per impl × 2).

- [ ] **Step 8: Build, lint, format-check**

Run: `pnpm --filter @yacad/vfs build && pnpm lint && pnpm format:check`
Expected: all green. If prettier reports drift, `pnpm format` and re-check.

- [ ] **Step 9: Commit**

```bash
git add packages/vfs/src tsconfig.json
git commit -m "feat(vfs): Vfs interface + MemoryVfs + IndexedDbVfs impls"
```

---

## Task 3: Scaffold `@yacad/doc-store` package

**Files:**
- Create: `packages/doc-store/package.json`
- Create: `packages/doc-store/tsconfig.json`
- Modify: `tsconfig.json` (root)
- Modify: `vitest.config.ts`

- [ ] **Step 1: Create the package.json**

```json
{
  "name": "@yacad/doc-store",
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
    "@yacad/canonical": "workspace:*",
    "@yacad/dag": "workspace:*",
    "@yacad/hash": "workspace:*",
    "@yacad/lua": "workspace:*",
    "@yacad/vfs": "workspace:*"
  },
  "devDependencies": {
    "@yacad/tsconfig": "workspace:*"
  }
}
```

(`@yacad/lua` is depended on for the `LuaDefinition` type used in the `BlobUploader` interface; no runtime code from `@yacad/lua` is imported.)

- [ ] **Step 2: Create the tsconfig.json**

```json
{
  "extends": "../../tooling/tsconfig/base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"],
  "references": [
    { "path": "../canonical" },
    { "path": "../dag" },
    { "path": "../hash" },
    { "path": "../lua" },
    { "path": "../vfs" }
  ]
}
```

- [ ] **Step 3: Add to root tsconfig**

Append to `references` in workspace-root `tsconfig.json`:

```json
{ "path": "packages/doc-store" }
```

- [ ] **Step 4: Add vitest aliases**

In `vitest.config.ts`, inside the `resolve.alias` object, add (alphabetical):

```ts
      '@yacad/doc-store': pkg('doc-store'),
      ...
      '@yacad/vfs': pkg('vfs'),
```

Place `@yacad/doc-store` between `@yacad/dag` and `@yacad/engine`, and `@yacad/vfs` after `@yacad/render` or wherever fits the existing ordering.

- [ ] **Step 5: Install and verify build**

Run: `pnpm install && pnpm --filter @yacad/doc-store build`
Expected: install succeeds; build succeeds (empty package, no .ts files yet).

- [ ] **Step 6: Commit**

```bash
git add packages/doc-store/package.json packages/doc-store/tsconfig.json tsconfig.json vitest.config.ts pnpm-lock.yaml
git commit -m "feat(doc-store): scaffold @yacad/doc-store package"
```

---

## Task 4: Define shared types

**Files:**
- Create: `packages/doc-store/src/types.ts`
- Create: `packages/doc-store/src/index.ts`

- [ ] **Step 1: Write `packages/doc-store/src/types.ts`**

```typescript
import type { NodeDoc } from '@yacad/dag';
import type { Hash } from '@yacad/hash';
import type { LuaDefinition } from '@yacad/lua';

/** Stable identity + display metadata for a stored document. */
export interface DocMeta {
  readonly id: string;
  readonly name: string;
  /** Milliseconds since epoch. */
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Optional data URL captured by the editor; not used by the doc-store itself. */
  readonly thumbnail?: string;
}

/** Optional initial NodeDoc passed to `library.create`. */
export type NewDocSeed = NodeDoc | undefined;

/** Coarse-grained event emitted by `DocSession.subscribe`. */
export type DocEvent =
  | { kind: 'doc-changed' }
  | { kind: 'meta-changed' }
  | { kind: 'persisted' }
  | { kind: 'invalidated'; error: Error };

/**
 * Narrow interface the doc-store needs from the worker transport layer. The
 * actual `@yacad/worker` WorkerClient class structurally satisfies this — the
 * doc-store deliberately does NOT import from `@yacad/worker` so the
 * dependency direction stays `doc-store` → (nothing UI/transport-specific).
 */
export interface BlobUploader {
  putMeshBlob(hash: Hash, bytes: Uint8Array): Promise<void>;
  hasMeshBlob(hash: Hash): Promise<boolean>;
  putLuaDefinition(hash: Hash, def: LuaDefinition): Promise<void>;
  hasLuaDefinition(hash: Hash): Promise<boolean>;
}
```

- [ ] **Step 2: Write `packages/doc-store/src/index.ts` (placeholder, expanded in later tasks)**

```typescript
export type { BlobUploader, DocEvent, DocMeta, NewDocSeed } from './types';
```

- [ ] **Step 3: Build verifies types compile**

Run: `pnpm --filter @yacad/doc-store build`
Expected: PASS (no implementation yet, but tsc emits declaration files for the types).

- [ ] **Step 4: Commit**

```bash
git add packages/doc-store/src/index.ts packages/doc-store/src/types.ts
git commit -m "feat(doc-store): DocMeta, DocEvent, BlobUploader types"
```

---

## Task 5: Define VFS key conventions

**Files:**
- Create: `packages/doc-store/src/paths.ts`
- Create: `packages/doc-store/src/paths.test.ts`

- [ ] **Step 1: Write the failing test in `packages/doc-store/src/paths.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { blobKey, docKey, listBlobsPrefix, listDocsPrefix, metaKey, parseDocId } from './paths';

describe('paths', () => {
  it('metaKey produces /docs/{id}/meta.json', () => {
    expect(metaKey('abc-123')).toBe('/docs/abc-123/meta.json');
  });

  it('docKey produces /docs/{id}/document.json', () => {
    expect(docKey('abc-123')).toBe('/docs/abc-123/document.json');
  });

  it('blobKey produces /docs/{id}/blobs/{hash}.bin', () => {
    expect(blobKey('abc-123', 'deadbeef')).toBe('/docs/abc-123/blobs/deadbeef.bin');
  });

  it('listBlobsPrefix returns /docs/{id}/blobs/', () => {
    expect(listBlobsPrefix('abc-123')).toBe('/docs/abc-123/blobs/');
  });

  it('listDocsPrefix returns /docs/', () => {
    expect(listDocsPrefix()).toBe('/docs/');
  });

  it('parseDocId pulls the id out of a meta key', () => {
    expect(parseDocId('/docs/abc-123/meta.json')).toBe('abc-123');
  });

  it('parseDocId returns undefined for non-matching keys', () => {
    expect(parseDocId('/other/foo')).toBeUndefined();
    expect(parseDocId('/docs/abc-123/blobs/deadbeef.bin')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/doc-store/src/paths`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/doc-store/src/paths.ts`**

```typescript
import type { Hash } from '@yacad/hash';

/**
 * VFS key conventions. The Vfs treats keys as opaque strings; the doc-store
 * builds a single hierarchy under `/docs/`. Changing these helpers in a
 * backward-incompatible way breaks every persisted document, so don't.
 */

const DOCS_ROOT = '/docs/';
const META_FILE = '/meta.json';
const DOC_FILE = '/document.json';
const BLOBS_DIR = '/blobs/';
const BLOB_EXT = '.bin';

export const metaKey = (docId: string): string => `${DOCS_ROOT}${docId}${META_FILE}`;
export const docKey = (docId: string): string => `${DOCS_ROOT}${docId}${DOC_FILE}`;
export const blobKey = (docId: string, hash: Hash): string =>
  `${DOCS_ROOT}${docId}${BLOBS_DIR}${hash}${BLOB_EXT}`;

export const listBlobsPrefix = (docId: string): string => `${DOCS_ROOT}${docId}${BLOBS_DIR}`;
export const listDocsPrefix = (): string => DOCS_ROOT;

/**
 * Recover a document id from a meta-key string. Used by `library.list` to
 * iterate every persisted document via `vfs.list(listDocsPrefix())` followed
 * by selecting only the meta keys.
 */
export function parseDocId(key: string): string | undefined {
  if (!key.startsWith(DOCS_ROOT)) return undefined;
  if (!key.endsWith(META_FILE)) return undefined;
  const middle = key.slice(DOCS_ROOT.length, key.length - META_FILE.length);
  // Must be exactly the docId — no extra slashes.
  if (middle.length === 0 || middle.includes('/')) return undefined;
  return middle;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/doc-store/src/paths`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/doc-store/src/paths.ts packages/doc-store/src/paths.test.ts
git commit -m "feat(doc-store): VFS key convention helpers"
```

---

## Task 6: DocLibrary — list / create / rename / delete (without open)

**Files:**
- Create: `packages/doc-store/src/library.ts`
- Create: `packages/doc-store/src/library.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryVfs } from '@yacad/vfs';
import { DocLibrary } from './library';
import type { BlobUploader } from './types';

/** Stub BlobUploader for tests that don't exercise the open path. */
const noopUploader: BlobUploader = {
  putMeshBlob: async () => {},
  hasMeshBlob: async () => true,
  putLuaDefinition: async () => {},
  hasLuaDefinition: async () => true,
};

describe('DocLibrary', () => {
  let vfs: MemoryVfs;
  let lib: DocLibrary;

  beforeEach(() => {
    vfs = new MemoryVfs();
    lib = new DocLibrary(vfs, noopUploader);
  });

  it('list returns [] when no docs exist', async () => {
    expect(await lib.list()).toEqual([]);
  });

  it('create writes meta + document; list returns the new doc', async () => {
    const session = await lib.create('My First Model');
    expect(session.meta.name).toBe('My First Model');
    expect(session.id).toMatch(/[0-9a-f-]{36}/i); // UUID-ish
    await session.close();

    const docs = await lib.list();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.name).toBe('My First Model');
    expect(docs[0]!.id).toBe(session.id);
  });

  it('list returns docs sorted by updatedAt descending', async () => {
    const a = await lib.create('A');
    await a.close();
    // Ensure distinct timestamps even at sub-millisecond clocks.
    await new Promise((r) => setTimeout(r, 5));
    const b = await lib.create('B');
    await b.close();

    const docs = await lib.list();
    expect(docs.map((d) => d.name)).toEqual(['B', 'A']);
  });

  it('rename updates the meta name and updatedAt', async () => {
    const session = await lib.create('Original');
    const originalUpdatedAt = session.meta.updatedAt;
    await session.close();

    await new Promise((r) => setTimeout(r, 5));
    await lib.rename(session.id, 'Renamed');

    const docs = await lib.list();
    expect(docs[0]!.name).toBe('Renamed');
    expect(docs[0]!.updatedAt).toBeGreaterThan(originalUpdatedAt);
  });

  it('rename of an unknown id throws', async () => {
    await expect(lib.rename('unknown-id', 'X')).rejects.toThrow(/no document/i);
  });

  it('delete removes the doc; list no longer returns it', async () => {
    const a = await lib.create('A');
    await a.close();
    const b = await lib.create('B');
    await b.close();

    await lib.delete(a.id);
    const docs = await lib.list();
    expect(docs.map((d) => d.name)).toEqual(['B']);
  });

  it('delete also removes any /docs/{id}/blobs/* keys', async () => {
    const session = await lib.create('A');
    const docId = session.id;
    await session.close();
    // Plant a blob key by hand to verify deletion sweeps it.
    await vfs.write(`/docs/${docId}/blobs/abcd.bin`, new Uint8Array([1, 2, 3]));
    expect(await vfs.read(`/docs/${docId}/blobs/abcd.bin`)).toBeDefined();

    await lib.delete(docId);
    expect(await vfs.read(`/docs/${docId}/blobs/abcd.bin`)).toBeUndefined();
  });

  it('delete of an unknown id is a no-op (no throw)', async () => {
    await expect(lib.delete('unknown-id')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/doc-store/src/library`
Expected: FAIL — `Cannot find module './library'`.

- [ ] **Step 3: Implement `packages/doc-store/src/library.ts`**

Note: `open()` is stubbed in this task — it throws "not implemented". Task 9 fleshes it out.

```typescript
import type { NodeDoc } from '@yacad/dag';
import type { Vfs } from '@yacad/vfs';
import { docKey, listBlobsPrefix, listDocsPrefix, metaKey, parseDocId } from './paths';
import { DocSession } from './session';
import type { BlobUploader, DocMeta, NewDocSeed } from './types';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

/** Default seed used when `library.create` is called with no explicit seed. */
const DEFAULT_SEED: NodeDoc = {
  type: 'box',
  params: { size: [10, 10, 10], center: true },
};

/**
 * Multi-document library backed by a Vfs. Owns the persisted form of every
 * known document; hands out a DocSession when one is opened.
 */
export class DocLibrary {
  constructor(
    private readonly vfs: Vfs,
    private readonly uploader: BlobUploader,
  ) {}

  /** Lists every persisted document, most-recently-updated first. */
  async list(): Promise<readonly DocMeta[]> {
    const keys = await this.vfs.list(listDocsPrefix());
    const metas: DocMeta[] = [];
    for (const key of keys) {
      const id = parseDocId(key);
      if (!id) continue;
      const bytes = await this.vfs.read(key);
      if (!bytes) continue;
      try {
        metas.push(JSON.parse(DEC.decode(bytes)) as DocMeta);
      } catch {
        // Skip corrupt meta entries — surfacing them is the editor's job.
      }
    }
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  }

  /**
   * Creates a new document with a fresh UUID and the given name. Writes
   * `meta.json` + `document.json` (seed or default), then opens the session.
   */
  async create(name: string, seed?: NewDocSeed): Promise<DocSession> {
    const now = Date.now();
    const id = crypto.randomUUID();
    const meta: DocMeta = { id, name, createdAt: now, updatedAt: now };
    const doc: NodeDoc = seed ?? DEFAULT_SEED;
    await this.vfs.write(metaKey(id), ENC.encode(JSON.stringify(meta)));
    await this.vfs.write(docKey(id), ENC.encode(JSON.stringify(doc)));
    return this.open(id);
  }

  /** Updates the display name and bumps `updatedAt`. */
  async rename(id: string, name: string): Promise<void> {
    const metaBytes = await this.vfs.read(metaKey(id));
    if (!metaBytes) {
      throw new Error(`no document with id "${id}"`);
    }
    const meta = JSON.parse(DEC.decode(metaBytes)) as DocMeta;
    const updated: DocMeta = { ...meta, name, updatedAt: Date.now() };
    await this.vfs.write(metaKey(id), ENC.encode(JSON.stringify(updated)));
  }

  /** Removes the document, its blobs, and its meta entry. Idempotent. */
  async delete(id: string): Promise<void> {
    const blobKeys = await this.vfs.list(listBlobsPrefix(id));
    for (const k of blobKeys) await this.vfs.delete(k);
    await this.vfs.delete(docKey(id));
    await this.vfs.delete(metaKey(id));
  }

  /**
   * Opens a document into an editable session. Loads meta + doc + blobs,
   * pushes new blobs to the worker, and runs validation. Stubbed in this
   * task — fleshed out in a later task.
   */
  async open(id: string): Promise<DocSession> {
    return DocSession.open(this.vfs, this.uploader, id);
  }
}
```

- [ ] **Step 4: Stub `packages/doc-store/src/session.ts` just enough to compile**

```typescript
import type { NodeDoc } from '@yacad/dag';
import type { Hash } from '@yacad/hash';
import type { Vfs } from '@yacad/vfs';
import { docKey, metaKey } from './paths';
import type { BlobUploader, DocEvent, DocMeta } from './types';

const DEC = new TextDecoder();

/**
 * Editable session for one open document. Skeleton in this task; mutate,
 * undo/redo, addBlob, autosave, and the proper open() flow land in later
 * tasks. The class is exported so the library can refer to it; the public
 * surface re-exports it via index.ts later.
 */
export class DocSession {
  readonly id: string;
  readonly meta: DocMeta;
  readonly doc: NodeDoc;
  readonly blobs: ReadonlyMap<Hash, Uint8Array> = new Map();
  readonly canUndo = false;
  readonly canRedo = false;
  readonly isDirty = false;
  readonly state: 'live' | 'invalidated' = 'live';

  private constructor(
    private readonly vfs: Vfs,
    private readonly uploader: BlobUploader,
    meta: DocMeta,
    doc: NodeDoc,
  ) {
    this.id = meta.id;
    this.meta = meta;
    this.doc = doc;
  }

  static async open(vfs: Vfs, uploader: BlobUploader, id: string): Promise<DocSession> {
    const metaBytes = await vfs.read(metaKey(id));
    if (!metaBytes) throw new Error(`no document with id "${id}"`);
    const meta = JSON.parse(DEC.decode(metaBytes)) as DocMeta;
    const docBytes = await vfs.read(docKey(id));
    if (!docBytes) throw new Error(`document "${id}" has no document.json`);
    const doc = JSON.parse(DEC.decode(docBytes)) as NodeDoc;
    return new DocSession(vfs, uploader, meta, doc);
  }

  async mutate(_fn: (prev: NodeDoc) => NodeDoc): Promise<void> {
    throw new Error('not implemented');
  }

  async addBlob(_bytes: Uint8Array): Promise<Hash> {
    throw new Error('not implemented');
  }

  undo(): void {
    throw new Error('not implemented');
  }

  redo(): void {
    throw new Error('not implemented');
  }

  async save(): Promise<void> {
    // No-op for now; persistence lands in task 9.
  }

  async close(): Promise<void> {
    // No-op for now; drain logic lands in task 9.
  }

  subscribe(_cb: (evt: DocEvent) => void): () => void {
    return () => {};
  }
}
```

- [ ] **Step 5: Update `index.ts` to re-export DocLibrary and DocSession**

Append to `packages/doc-store/src/index.ts`:

```typescript
export { DocLibrary } from './library';
export { DocSession } from './session';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/doc-store/src/library`
Expected: PASS — 8 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/doc-store/src
git commit -m "feat(doc-store): DocLibrary list/create/rename/delete + DocSession skeleton"
```

---

## Task 7: DocSession.mutate with validation + history

**Files:**
- Modify: `packages/doc-store/src/session.ts`
- Create: `packages/doc-store/src/session.test.ts`

- [ ] **Step 1: Write the failing tests in `packages/doc-store/src/session.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import type { NodeDoc } from '@yacad/dag';
import { MemoryVfs } from '@yacad/vfs';
import { DocLibrary } from './library';
import { DocSession } from './session';
import type { BlobUploader, DocEvent } from './types';

const noopUploader: BlobUploader = {
  putMeshBlob: async () => {},
  hasMeshBlob: async () => true,
  putLuaDefinition: async () => {},
  hasLuaDefinition: async () => true,
};

async function freshSession(seed?: NodeDoc): Promise<DocSession> {
  const lib = new DocLibrary(new MemoryVfs(), noopUploader);
  return lib.create('Test', seed);
}

describe('DocSession.mutate', () => {
  let session: DocSession;

  beforeEach(async () => {
    session = await freshSession();
  });

  it('commits a valid transformation and emits doc-changed', async () => {
    const events: DocEvent[] = [];
    session.subscribe((e) => events.push(e));

    await session.mutate(() => ({
      type: 'sphere',
      params: { radius: 5, segments: 16 },
    }));

    expect(session.doc).toMatchObject({ type: 'sphere' });
    expect(events.some((e) => e.kind === 'doc-changed')).toBe(true);
    expect(session.isDirty).toBe(true);
  });

  it('rejects an invalid transformation; state unchanged; no event emitted', async () => {
    const events: DocEvent[] = [];
    session.subscribe((e) => events.push(e));
    const before = session.doc;

    await expect(
      session.mutate(() => ({ type: 'not-a-real-type', params: {} } as NodeDoc)),
    ).rejects.toThrow();

    expect(session.doc).toBe(before);
    expect(events).toEqual([]);
  });

  it('canUndo becomes true after a commit; undo restores the previous doc', async () => {
    const original = session.doc;
    expect(session.canUndo).toBe(false);

    await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    expect(session.canUndo).toBe(true);

    session.undo();
    expect(session.doc).toEqual(original);
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(true);
  });

  it('redo restores the most recently undone doc', async () => {
    await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    const afterMutate = session.doc;
    session.undo();
    session.redo();
    expect(session.doc).toEqual(afterMutate);
  });

  it('a new mutation after undo invalidates the redo stack', async () => {
    await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    session.undo();
    expect(session.canRedo).toBe(true);

    await session.mutate(() => ({ type: 'cylinder', params: { height: 1, radius: 1 } }));
    expect(session.canRedo).toBe(false);
  });

  it('undo / redo emit doc-changed events', async () => {
    await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    const events: DocEvent[] = [];
    session.subscribe((e) => events.push(e));

    session.undo();
    session.redo();

    expect(events.filter((e) => e.kind === 'doc-changed')).toHaveLength(2);
  });

  it('subscribe returns an unsubscribe function', async () => {
    const events: DocEvent[] = [];
    const unsubscribe = session.subscribe((e) => events.push(e));
    unsubscribe();
    await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/doc-store/src/session`
Expected: FAIL — `not implemented` errors from the stub.

- [ ] **Step 3: Replace `packages/doc-store/src/session.ts` with the real implementation**

Replace the file contents entirely:

```typescript
import { buildGraph, type NodeDoc } from '@yacad/dag';
import { defaultHasher, type Hash } from '@yacad/hash';
import type { Vfs } from '@yacad/vfs';
import { docKey, metaKey } from './paths';
import type { BlobUploader, DocEvent, DocMeta } from './types';

const DEC = new TextDecoder();

/**
 * Editable session for one open document. Mutations are immutable
 * transformer functions; the session validates the candidate via buildGraph
 * before committing. Undo is a snapshot stack; redo invalidates on any new
 * commit. The session does not depend on Svelte or any UI framework.
 */
export class DocSession {
  readonly id: string;

  private currentMeta: DocMeta;
  private currentDoc: NodeDoc;
  private readonly blobMap = new Map<Hash, Uint8Array>();
  private readonly undoStack: NodeDoc[] = [];
  private readonly redoStack: NodeDoc[] = [];
  private dirty = false;
  private currentState: 'live' | 'invalidated' = 'live';
  private readonly subscribers = new Set<(evt: DocEvent) => void>();

  private constructor(
    private readonly vfs: Vfs,
    private readonly uploader: BlobUploader,
    meta: DocMeta,
    doc: NodeDoc,
  ) {
    this.id = meta.id;
    this.currentMeta = meta;
    this.currentDoc = doc;
  }

  get meta(): DocMeta {
    return this.currentMeta;
  }
  get doc(): NodeDoc {
    return this.currentDoc;
  }
  get blobs(): ReadonlyMap<Hash, Uint8Array> {
    return this.blobMap;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get isDirty(): boolean {
    return this.dirty;
  }
  get state(): 'live' | 'invalidated' {
    return this.currentState;
  }

  static async open(vfs: Vfs, uploader: BlobUploader, id: string): Promise<DocSession> {
    const metaBytes = await vfs.read(metaKey(id));
    if (!metaBytes) throw new Error(`no document with id "${id}"`);
    const meta = JSON.parse(DEC.decode(metaBytes)) as DocMeta;
    const docBytes = await vfs.read(docKey(id));
    if (!docBytes) throw new Error(`document "${id}" has no document.json`);
    const doc = JSON.parse(DEC.decode(docBytes)) as NodeDoc;
    return new DocSession(vfs, uploader, meta, doc);
  }

  async mutate(fn: (prev: NodeDoc) => NodeDoc): Promise<void> {
    if (this.currentState === 'invalidated') {
      throw new Error('cannot mutate: session is invalidated');
    }
    const next = fn(this.currentDoc);
    // Validate by running the same builder the engine uses. Any rejection
    // here leaves state untouched and propagates the original error.
    await buildGraph(next, defaultHasher, '$', this.makeResolver());

    this.undoStack.push(this.currentDoc);
    this.redoStack.length = 0;
    this.currentDoc = next;
    this.dirty = true;
    this.emit({ kind: 'doc-changed' });
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.currentDoc);
    this.currentDoc = prev;
    this.dirty = true;
    this.emit({ kind: 'doc-changed' });
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.currentDoc);
    this.currentDoc = next;
    this.dirty = true;
    this.emit({ kind: 'doc-changed' });
  }

  async addBlob(_bytes: Uint8Array): Promise<Hash> {
    throw new Error('not implemented'); // Task 8
  }

  async save(): Promise<void> {
    // Task 9.
  }

  async close(): Promise<void> {
    // Task 9.
  }

  subscribe(cb: (evt: DocEvent) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  /**
   * Resolver passed to buildGraph during validation. Decoder / expandable
   * nodes (import-stl, lua, ...) look up their blob/definition by hash.
   * Buffer ownership is irrelevant here — the resolver only needs to know
   * whether the blob is present and what it contains.
   */
  private makeResolver() {
    const blobs = this.blobMap;
    return { get: (hash: Hash) => blobs.get(hash) };
  }

  private emit(evt: DocEvent): void {
    for (const cb of this.subscribers) cb(evt);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/doc-store/src/session`
Expected: PASS — 7 tests.

- [ ] **Step 5: Re-run library tests to confirm no regressions**

Run: `pnpm vitest run packages/doc-store`
Expected: PASS — 15 tests (8 library + 7 session).

- [ ] **Step 6: Commit**

```bash
git add packages/doc-store/src/session.ts packages/doc-store/src/session.test.ts
git commit -m "feat(doc-store): DocSession.mutate with validation + snapshot undo/redo"
```

---

## Task 8: DocSession.addBlob with idempotent worker upload

**Files:**
- Modify: `packages/doc-store/src/session.ts`
- Modify: `packages/doc-store/src/session.test.ts`

- [ ] **Step 1: Append failing tests to `packages/doc-store/src/session.test.ts`**

Add inside the existing file, alongside the existing `describe('DocSession.mutate', ...)` block:

```typescript
describe('DocSession.addBlob', () => {
  it('hashes the bytes, stores them in session.blobs, and uploads via the uploader', async () => {
    const putCalls: Array<{ hash: string; bytes: Uint8Array }> = [];
    const uploader: BlobUploader = {
      putMeshBlob: async (hash, bytes) => {
        putCalls.push({ hash, bytes });
      },
      hasMeshBlob: async () => false,
      putLuaDefinition: async () => {},
      hasLuaDefinition: async () => true,
    };
    const lib = new DocLibrary(new MemoryVfs(), uploader);
    const session = await lib.create('A');

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const hash = await session.addBlob(bytes);

    expect(hash).toMatch(/^[0-9a-f]+$/i);
    expect(session.blobs.get(hash)).toEqual(bytes);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]!.hash).toBe(hash);
  });

  it('is idempotent for the same bytes (one upload, one map entry)', async () => {
    const putCalls: string[] = [];
    const uploader: BlobUploader = {
      putMeshBlob: async (hash) => {
        putCalls.push(hash);
      },
      hasMeshBlob: async (hash) => putCalls.includes(hash),
      putLuaDefinition: async () => {},
      hasLuaDefinition: async () => true,
    };
    const lib = new DocLibrary(new MemoryVfs(), uploader);
    const session = await lib.create('A');

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const h1 = await session.addBlob(bytes);
    const h2 = await session.addBlob(bytes);
    expect(h1).toBe(h2);
    expect(putCalls).toHaveLength(1);
    expect(session.blobs.size).toBe(1);
  });

  it('does not upload when the worker already has the blob', async () => {
    let putCount = 0;
    const uploader: BlobUploader = {
      putMeshBlob: async () => {
        putCount++;
      },
      hasMeshBlob: async () => true, // worker already has every blob
      putLuaDefinition: async () => {},
      hasLuaDefinition: async () => true,
    };
    const lib = new DocLibrary(new MemoryVfs(), uploader);
    const session = await lib.create('A');

    await session.addBlob(new Uint8Array([9, 9, 9]));
    expect(putCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run packages/doc-store/src/session -t "addBlob"`
Expected: FAIL — `not implemented`.

- [ ] **Step 3: Implement `addBlob` in `packages/doc-store/src/session.ts`**

Replace the `async addBlob` method body:

```typescript
  async addBlob(bytes: Uint8Array): Promise<Hash> {
    const hash = await defaultHasher.hash(bytes);
    if (!this.blobMap.has(hash)) {
      this.blobMap.set(hash, new Uint8Array(bytes));
    }
    if (!(await this.uploader.hasMeshBlob(hash))) {
      await this.uploader.putMeshBlob(hash, bytes);
    }
    return hash;
  }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run packages/doc-store/src/session`
Expected: PASS — 10 tests now.

- [ ] **Step 5: Commit**

```bash
git add packages/doc-store/src/session.ts packages/doc-store/src/session.test.ts
git commit -m "feat(doc-store): DocSession.addBlob with idempotent worker upload"
```

---

## Task 9: Autosave + explicit save + close drain

**Files:**
- Modify: `packages/doc-store/src/session.ts`
- Modify: `packages/doc-store/src/session.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `session.test.ts`:

```typescript
describe('DocSession persistence', () => {
  it('save() writes document.json + meta.json to the VFS', async () => {
    const vfs = new MemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A');
    await session.mutate(() => ({ type: 'sphere', params: { radius: 7 } }));
    await session.save();

    const docBytes = await vfs.read(`/docs/${session.id}/document.json`);
    expect(docBytes).toBeDefined();
    expect(JSON.parse(new TextDecoder().decode(docBytes!))).toMatchObject({
      type: 'sphere',
      params: { radius: 7 },
    });
    expect(session.isDirty).toBe(false);
  });

  it('save() also writes any added blobs under /docs/{id}/blobs/{hash}.bin', async () => {
    const vfs = new MemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A');
    const hash = await session.addBlob(new Uint8Array([1, 2, 3]));
    await session.save();

    const blobBytes = await vfs.read(`/docs/${session.id}/blobs/${hash}.bin`);
    expect(blobBytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('save() emits a persisted event', async () => {
    const vfs = new MemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A');
    const events: DocEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.save();
    expect(events.some((e) => e.kind === 'persisted')).toBe(true);
  });

  it('autosave fires after the debounce window following a mutation', async () => {
    const vfs = new MemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A', undefined, { autosaveMs: 30 });
    await session.mutate(() => ({ type: 'sphere', params: { radius: 1 } }));
    expect(session.isDirty).toBe(true);

    // Wait past the debounce window.
    await new Promise((r) => setTimeout(r, 80));
    expect(session.isDirty).toBe(false);
  });

  it('autosave coalesces rapid mutations into one VFS write', async () => {
    // Subclass MemoryVfs to count document.json writes. A Proxy works too,
    // but unbinds `this` for the non-intercepted methods and breaks the
    // library's internal read/list calls — subclassing keeps `this` correct.
    class CountingMemoryVfs extends MemoryVfs {
      docWriteCount = 0;
      override async write(key: string, value: Uint8Array): Promise<void> {
        if (key.endsWith('document.json')) this.docWriteCount++;
        return super.write(key, value);
      }
    }
    const vfs = new CountingMemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A', undefined, { autosaveMs: 30 });
    // Reset the counter after create() (which writes once).
    vfs.docWriteCount = 0;

    for (let i = 1; i <= 5; i++) {
      await session.mutate(() => ({ type: 'sphere', params: { radius: i } }));
    }
    await new Promise((r) => setTimeout(r, 80));
    expect(vfs.docWriteCount).toBe(1);
  });

  it('close() drains a pending autosave', async () => {
    const vfs = new MemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A', undefined, { autosaveMs: 500 });
    await session.mutate(() => ({ type: 'sphere', params: { radius: 1 } }));
    // Don't wait for the debounce — close() should flush immediately.
    await session.close();
    expect(session.isDirty).toBe(false);
    const bytes = await vfs.read(`/docs/${session.id}/document.json`);
    expect(JSON.parse(new TextDecoder().decode(bytes!))).toMatchObject({ type: 'sphere' });
  });
});
```

Note: the tests call `lib.create('A', undefined, { autosaveMs: 30 })` — extend `DocLibrary.create` and `DocSession.open` to accept a third arg `{ autosaveMs?: number }`. Default is 500 ms when omitted; tests pass shorter values for speed.

- [ ] **Step 2: Add `SessionOptions` type to `packages/doc-store/src/types.ts`**

Append:

```typescript
export interface SessionOptions {
  /** Autosave debounce window in milliseconds. Default 500. */
  readonly autosaveMs?: number;
}
```

Update `index.ts` to export it:

```typescript
export type { BlobUploader, DocEvent, DocMeta, NewDocSeed, SessionOptions } from './types';
```

- [ ] **Step 3: Run tests — verify failure**

Run: `pnpm vitest run packages/doc-store/src/session -t "persistence"`
Expected: FAIL — autosave / save not implemented, options not accepted.

- [ ] **Step 4: Extend `DocLibrary.create` and `.open` to accept options**

In `packages/doc-store/src/library.ts`:

- Import `SessionOptions` from `./types`.
- Change `create`'s signature to `async create(name: string, seed?: NewDocSeed, options?: SessionOptions): Promise<DocSession>` and pass `options` through to `open`.
- Change `open`'s signature to `async open(id: string, options?: SessionOptions): Promise<DocSession>` and pass it to `DocSession.open`.

- [ ] **Step 5: Implement persistence in `packages/doc-store/src/session.ts`**

Add the option threading through `open`, the autosave debounce, `save`, and `close`. The full updated file:

```typescript
import { buildGraph, type NodeDoc } from '@yacad/dag';
import { defaultHasher, type Hash } from '@yacad/hash';
import type { Vfs } from '@yacad/vfs';
import { blobKey, docKey, metaKey } from './paths';
import type { BlobUploader, DocEvent, DocMeta, SessionOptions } from './types';

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const DEFAULT_AUTOSAVE_MS = 500;

export class DocSession {
  readonly id: string;

  private currentMeta: DocMeta;
  private currentDoc: NodeDoc;
  private readonly blobMap = new Map<Hash, Uint8Array>();
  /** Blob hashes that have not yet been persisted to the VFS. */
  private readonly unsavedBlobs = new Set<Hash>();
  private readonly undoStack: NodeDoc[] = [];
  private readonly redoStack: NodeDoc[] = [];
  private dirty = false;
  private currentState: 'live' | 'invalidated' = 'live';
  private readonly subscribers = new Set<(evt: DocEvent) => void>();
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly autosaveMs: number;

  private constructor(
    private readonly vfs: Vfs,
    private readonly uploader: BlobUploader,
    meta: DocMeta,
    doc: NodeDoc,
    options: SessionOptions = {},
  ) {
    this.id = meta.id;
    this.currentMeta = meta;
    this.currentDoc = doc;
    this.autosaveMs = options.autosaveMs ?? DEFAULT_AUTOSAVE_MS;
  }

  get meta(): DocMeta {
    return this.currentMeta;
  }
  get doc(): NodeDoc {
    return this.currentDoc;
  }
  get blobs(): ReadonlyMap<Hash, Uint8Array> {
    return this.blobMap;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get isDirty(): boolean {
    return this.dirty;
  }
  get state(): 'live' | 'invalidated' {
    return this.currentState;
  }

  static async open(
    vfs: Vfs,
    uploader: BlobUploader,
    id: string,
    options?: SessionOptions,
  ): Promise<DocSession> {
    const metaBytes = await vfs.read(metaKey(id));
    if (!metaBytes) throw new Error(`no document with id "${id}"`);
    const meta = JSON.parse(DEC.decode(metaBytes)) as DocMeta;
    const docBytes = await vfs.read(docKey(id));
    if (!docBytes) throw new Error(`document "${id}" has no document.json`);
    const doc = JSON.parse(DEC.decode(docBytes)) as NodeDoc;
    return new DocSession(vfs, uploader, meta, doc, options);
  }

  async mutate(fn: (prev: NodeDoc) => NodeDoc): Promise<void> {
    if (this.currentState === 'invalidated') {
      throw new Error('cannot mutate: session is invalidated');
    }
    const next = fn(this.currentDoc);
    await buildGraph(next, defaultHasher, '$', this.makeResolver());

    this.undoStack.push(this.currentDoc);
    this.redoStack.length = 0;
    this.currentDoc = next;
    this.markDirty();
    this.emit({ kind: 'doc-changed' });
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.currentDoc);
    this.currentDoc = prev;
    this.markDirty();
    this.emit({ kind: 'doc-changed' });
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.currentDoc);
    this.currentDoc = next;
    this.markDirty();
    this.emit({ kind: 'doc-changed' });
  }

  async addBlob(bytes: Uint8Array): Promise<Hash> {
    const hash = await defaultHasher.hash(bytes);
    if (!this.blobMap.has(hash)) {
      this.blobMap.set(hash, new Uint8Array(bytes));
      this.unsavedBlobs.add(hash);
      this.markDirty();
    }
    if (!(await this.uploader.hasMeshBlob(hash))) {
      await this.uploader.putMeshBlob(hash, bytes);
    }
    return hash;
  }

  async save(): Promise<void> {
    if (this.autosaveTimer !== undefined) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = undefined;
    }
    const updatedMeta: DocMeta = { ...this.currentMeta, updatedAt: Date.now() };
    await this.vfs.write(metaKey(this.id), ENC.encode(JSON.stringify(updatedMeta)));
    await this.vfs.write(docKey(this.id), ENC.encode(JSON.stringify(this.currentDoc)));
    for (const hash of this.unsavedBlobs) {
      const bytes = this.blobMap.get(hash);
      if (bytes) await this.vfs.write(blobKey(this.id, hash), bytes);
    }
    this.unsavedBlobs.clear();
    this.currentMeta = updatedMeta;
    this.dirty = false;
    this.emit({ kind: 'persisted' });
  }

  async close(): Promise<void> {
    if (this.autosaveTimer !== undefined || this.dirty) {
      await this.save();
    }
  }

  subscribe(cb: (evt: DocEvent) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.autosaveTimer !== undefined) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = undefined;
      void this.save();
    }, this.autosaveMs);
  }

  private makeResolver() {
    const blobs = this.blobMap;
    return { get: (hash: Hash) => blobs.get(hash) };
  }

  private emit(evt: DocEvent): void {
    for (const cb of this.subscribers) cb(evt);
  }
}
```

- [ ] **Step 6: Run all doc-store tests**

Run: `pnpm vitest run packages/doc-store`
Expected: PASS — 16 tests (8 library + 7 mutate + 3 addBlob + 6 persistence).

- [ ] **Step 7: Commit**

```bash
git add packages/doc-store/src
git commit -m "feat(doc-store): autosave + explicit save + close drain"
```

---

## Task 10: DocLibrary.open with blob load, worker sync, and invalidated state

**Files:**
- Modify: `packages/doc-store/src/library.ts`
- Modify: `packages/doc-store/src/session.ts`
- Create: `packages/doc-store/src/open.test.ts`

- [ ] **Step 1: Write the failing tests in `packages/doc-store/src/open.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import type { NodeDoc } from '@yacad/dag';
import { MemoryVfs } from '@yacad/vfs';
import { DocLibrary } from './library';
import { blobKey, docKey, metaKey } from './paths';
import type { BlobUploader, DocEvent, DocMeta } from './types';

const ENC = new TextEncoder();

/** Plants a fully-formed doc directly in a fresh vfs and returns the lib. */
async function plant(
  vfs: MemoryVfs,
  doc: NodeDoc,
  blobs: Record<string, Uint8Array> = {},
): Promise<{ lib: DocLibrary; id: string; uploaderState: { put: string[]; has: string[] } }> {
  const id = '00000000-0000-0000-0000-000000000001';
  const meta: DocMeta = { id, name: 'planted', createdAt: 1, updatedAt: 2 };
  await vfs.write(metaKey(id), ENC.encode(JSON.stringify(meta)));
  await vfs.write(docKey(id), ENC.encode(JSON.stringify(doc)));
  for (const [hash, bytes] of Object.entries(blobs)) {
    await vfs.write(blobKey(id, hash), bytes);
  }

  const uploaderState = { put: [] as string[], has: [] as string[] };
  const uploader: BlobUploader = {
    putMeshBlob: async (hash) => {
      uploaderState.put.push(hash);
    },
    hasMeshBlob: async (hash) => {
      uploaderState.has.push(hash);
      return false;
    },
    putLuaDefinition: async () => {},
    hasLuaDefinition: async () => true,
  };
  return { lib: new DocLibrary(vfs, uploader), id, uploaderState };
}

describe('DocLibrary.open', () => {
  it('loads doc + blobs into the session', async () => {
    const vfs = new MemoryVfs();
    const { lib, id } = await plant(
      vfs,
      { type: 'box', params: { size: [1, 1, 1], center: true } },
      { abc: new Uint8Array([1, 2, 3]) },
    );
    const session = await lib.open(id);
    expect(session.doc).toMatchObject({ type: 'box' });
    expect(session.blobs.get('abc')).toEqual(new Uint8Array([1, 2, 3]));
    expect(session.state).toBe('live');
  });

  it('uploads each loaded blob to the worker (when worker reports missing)', async () => {
    const vfs = new MemoryVfs();
    const { lib, id, uploaderState } = await plant(
      vfs,
      { type: 'box', params: { size: [1, 1, 1] } },
      { aa: new Uint8Array([1]), bb: new Uint8Array([2]) },
    );
    await lib.open(id);
    expect(uploaderState.put.sort()).toEqual(['aa', 'bb']);
  });

  it('skips upload for blobs the worker already has', async () => {
    const vfs = new MemoryVfs();
    const id = '00000000-0000-0000-0000-000000000002';
    const meta: DocMeta = { id, name: 'planted', createdAt: 1, updatedAt: 2 };
    await vfs.write(metaKey(id), ENC.encode(JSON.stringify(meta)));
    await vfs.write(docKey(id), ENC.encode(JSON.stringify({ type: 'box', params: {} })));
    await vfs.write(blobKey(id, 'xx'), new Uint8Array([7]));

    let putCount = 0;
    const uploader: BlobUploader = {
      putMeshBlob: async () => {
        putCount++;
      },
      hasMeshBlob: async () => true, // worker has every blob already
      putLuaDefinition: async () => {},
      hasLuaDefinition: async () => true,
    };
    const lib = new DocLibrary(vfs, uploader);
    await lib.open(id);
    expect(putCount).toBe(0);
  });

  it('enters invalidated state when the loaded doc fails buildGraph', async () => {
    const vfs = new MemoryVfs();
    const { lib, id } = await plant(vfs, { type: 'this-type-does-not-exist', params: {} } as NodeDoc);
    const session = await lib.open(id);
    expect(session.state).toBe('invalidated');
    expect(session.doc).toMatchObject({ type: 'this-type-does-not-exist' });
    // The error from buildGraph is exposed via a getter so the UI can render
    // it after open() resolves (subscribers can't be attached in time to
    // catch a constructor-time event — see `invalidationError` on DocSession).
    expect(session.invalidationError).toBeInstanceOf(Error);
    expect(session.invalidationError!.message).toMatch(/this-type-does-not-exist/);
  });

  it('mutate on an invalidated session rejects', async () => {
    const vfs = new MemoryVfs();
    const { lib, id } = await plant(vfs, { type: 'not-a-real-type', params: {} } as NodeDoc);
    const session = await lib.open(id);
    await expect(session.mutate((d) => d)).rejects.toThrow(/invalidated/i);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run packages/doc-store/src/open`
Expected: FAIL — loaded session doesn't load blobs or sync to worker; invalidated state never set.

- [ ] **Step 3: Add `invalidationError` field + getter to `DocSession`**

In `packages/doc-store/src/session.ts`, add the private field next to `currentState`:

```typescript
  private currentInvalidationError: Error | undefined;
```

Add the getter alongside the other getters (`state`):

```typescript
  get invalidationError(): Error | undefined {
    return this.currentInvalidationError;
  }
```

- [ ] **Step 4: Extend `DocSession.open` to load blobs + sync to worker + run validation**

Replace the `static async open` body in `packages/doc-store/src/session.ts`:

```typescript
  static async open(
    vfs: Vfs,
    uploader: BlobUploader,
    id: string,
    options?: SessionOptions,
  ): Promise<DocSession> {
    const metaBytes = await vfs.read(metaKey(id));
    if (!metaBytes) throw new Error(`no document with id "${id}"`);
    const meta = JSON.parse(DEC.decode(metaBytes)) as DocMeta;
    const docBytes = await vfs.read(docKey(id));
    if (!docBytes) throw new Error(`document "${id}" has no document.json`);
    const doc = JSON.parse(DEC.decode(docBytes)) as NodeDoc;
    const session = new DocSession(vfs, uploader, meta, doc, options);

    // Load blobs and seed the session's blob map.
    const blobKeys = await vfs.list(listBlobsPrefix(id));
    for (const key of blobKeys) {
      const hash = blobHashFromKey(id, key);
      if (!hash) continue;
      const bytes = await vfs.read(key);
      if (!bytes) continue;
      session.blobMap.set(hash, bytes);
    }

    // Push blobs the worker doesn't have. Idempotent — re-opens are cheap.
    for (const [hash, bytes] of session.blobMap) {
      if (!(await uploader.hasMeshBlob(hash))) {
        await uploader.putMeshBlob(hash, bytes);
      }
    }

    // Validate the persisted doc. Failure transitions to invalidated state;
    // the error is exposed via `session.invalidationError` so the UI can
    // render it after open() resolves. No event is emitted from open()
    // itself — subscribers can't have attached yet. The `invalidated`
    // event remains in DocEvent for mid-session transitions (e.g., a
    // future worker-failure path).
    try {
      await buildGraph(doc, defaultHasher, '$', session.makeResolver());
    } catch (err) {
      session.currentState = 'invalidated';
      session.currentInvalidationError =
        err instanceof Error ? err : new Error(String(err));
    }

    return session;
  }
```

Add the necessary imports at the top of `session.ts`:

```typescript
import { blobKey, docKey, listBlobsPrefix, metaKey } from './paths';
```

(Already there: `blobKey`, `docKey`, `metaKey`. Add `listBlobsPrefix` to the existing import.)

Add the `blobHashFromKey` helper at the bottom of the file (outside the class):

```typescript
/**
 * Extract a blob hash from a key of the form `/docs/{id}/blobs/{hash}.bin`,
 * or `undefined` if the key doesn't match the expected shape.
 */
function blobHashFromKey(id: string, key: string): Hash | undefined {
  const prefix = `/docs/${id}/blobs/`;
  const suffix = '.bin';
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return undefined;
  return key.slice(prefix.length, key.length - suffix.length);
}
```

- [ ] **Step 5: Update `DocLibrary.open` to thread options through**

(Already done in Task 9 step 4 if completed. If not, do it now.)

- [ ] **Step 6: Run all doc-store tests**

Run: `pnpm vitest run packages/doc-store`
Expected: PASS — 21 tests (16 existing + 5 open).

- [ ] **Step 7: Commit**

```bash
git add packages/doc-store/src
git commit -m "feat(doc-store): DocLibrary.open loads blobs, syncs worker, validates persisted doc"
```

---

## Task 11: Full-gate validation + final commit

**Files:** none (verification + cleanup)

- [ ] **Step 1: Run the full gate**

Run from the repo root:

```bash
pnpm build && pnpm test && pnpm lint && pnpm format:check && pnpm --filter @yacad/studio check
```

Expected: all green. `pnpm test` should show ≥ 22 new tests (≥ 14 vfs + ≥ 21 doc-store).

- [ ] **Step 2: If any check fails, fix and re-run**

Common fixes:
- Prettier drift: `pnpm format` then re-run `format:check`.
- ESLint complaints about implicit `any` in test files: add explicit types.
- TS errors about missing references: confirm `tsconfig.json` references are added for both packages.

- [ ] **Step 3: Sanity check via studio app smoke (optional but recommended)**

Run: `pnpm build:app`
Expected: completes successfully. The studio app doesn't import the new packages yet, so this is just confirming nothing in the workspace got broken by the new package boundaries.

- [ ] **Step 4: Confirm clean git status**

Run: `git status`
Expected: nothing to commit, working tree clean. If there are leftover changes (formatting fixups), commit them with `chore: format`.

- [ ] **Step 5: Summary commit (only if there are leftover format/cleanup changes)**

```bash
git add -A
git commit -m "chore: format / cleanup after studio v2 foundation"
```

---

## Notes for the implementer

- **Worktree:** This plan is intended for the worktree at `.claude/worktrees/studio-v2-foundation/` on branch `feat/studio-v2-foundation`. Run all commands from inside that worktree.
- **No app integration:** This plan deliberately does not touch `apps/studio` or create a new studio v2 app. Spec 2 (tree editor) is the first consumer of these packages.
- **`crypto.randomUUID`:** available in Node ≥ 19, modern browsers, and workers. If a test environment ever lacks it, polyfill in `vitest.setup.ts`.
- **`fake-indexeddb`** is wired in `vitest.setup.ts` already — IndexedDbVfs tests pick it up automatically.
- **Test runtime:** the autosave debounce tests use real `setTimeout`. They add ≈ 200 ms total — fine. If they become flaky, fall back to `vi.useFakeTimers()`.
