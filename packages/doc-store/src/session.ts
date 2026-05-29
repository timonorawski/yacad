import { buildGraph, type NodeDoc } from '@yacad/dag';
import { defaultHasher, type Hash } from '@yacad/hash';
import type { Vfs } from '@yacad/vfs';
import { DEFAULT_PATHS, type Paths } from './paths';
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
  private mutating = false;
  private currentState: 'live' | 'invalidated' = 'live';
  private currentInvalidationError: Error | undefined;
  private readonly subscribers = new Set<(evt: DocEvent) => void>();
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly autosaveMs: number;
  private savingPromise: Promise<void> | undefined;
  private readonly paths: Paths;

  private constructor(
    private readonly vfs: Vfs,
    private readonly uploader: BlobUploader,
    meta: DocMeta,
    doc: NodeDoc,
    options: SessionOptions = {},
    paths: Paths = DEFAULT_PATHS,
  ) {
    this.id = meta.id;
    this.currentMeta = meta;
    this.currentDoc = deepFreeze(doc);
    this.autosaveMs = options.autosaveMs ?? DEFAULT_AUTOSAVE_MS;
    this.paths = paths;
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
  get invalidationError(): Error | undefined {
    return this.currentInvalidationError;
  }

  static async open(
    vfs: Vfs,
    uploader: BlobUploader,
    id: string,
    options?: SessionOptions,
    paths: Paths = DEFAULT_PATHS,
  ): Promise<DocSession> {
    const metaBytes = await vfs.read(paths.metaKey(id));
    if (!metaBytes) throw new Error(`no document with id "${id}"`);
    const meta = JSON.parse(DEC.decode(metaBytes)) as DocMeta;
    const docBytes = await vfs.read(paths.docKey(id));
    if (!docBytes) throw new Error(`document "${id}" has no document.json`);
    const doc = JSON.parse(DEC.decode(docBytes)) as NodeDoc;
    const session = new DocSession(vfs, uploader, meta, deepFreeze(doc), options, paths);

    // Load blobs and seed the session's blob map.
    const blobKeys = await vfs.list(paths.listBlobsPrefix(id));
    for (const key of blobKeys) {
      const hash = paths.blobHashFromKey(id, key);
      if (!hash) continue;
      const bytes = await vfs.read(key);
      if (!bytes) continue;
      session.blobMap.set(hash, new Uint8Array(bytes));
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
    //
    // Validation is skipped when `options.skipValidation` is true. Use this
    // only in controlled seeding / batch-import paths where blobs are not yet
    // available to the resolver (they will be added via `addBlob` afterwards).
    if (!options?.skipValidation) {
      try {
        await buildGraph(doc, defaultHasher, '$', session.makeResolver());
      } catch (err) {
        session.currentState = 'invalidated';
        session.currentInvalidationError = err instanceof Error ? err : new Error(String(err));
      }
    }

    return session;
  }

  async mutate(fn: (prev: NodeDoc) => NodeDoc): Promise<void> {
    if (this.currentState === 'invalidated') {
      throw new Error('cannot mutate: session is invalidated');
    }
    if (this.mutating) {
      throw new Error('cannot mutate: another mutation is already in progress');
    }
    this.mutating = true;
    try {
      const next = fn(this.currentDoc);
      await buildGraph(next, defaultHasher, '$', this.makeResolver());

      this.undoStack.push(this.currentDoc);
      this.redoStack.length = 0;
      this.currentDoc = deepFreeze(next);
      this.markDirty();
      this.emit({ kind: 'doc-changed' });
    } finally {
      this.mutating = false;
    }
  }

  undo(): void {
    if (this.currentState === 'invalidated') return;
    if (this.mutating) return;
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.currentDoc);
    this.currentDoc = deepFreeze(prev);
    this.markDirty();
    this.emit({ kind: 'doc-changed' });
  }

  redo(): void {
    if (this.currentState === 'invalidated') return;
    if (this.mutating) return;
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.currentDoc);
    this.currentDoc = deepFreeze(next);
    this.markDirty();
    this.emit({ kind: 'doc-changed' });
  }

  /**
   * Update the document's display name. Bumps `updatedAt`, persists in the
   * next autosave, and emits `meta-changed` to subscribers. For closed docs,
   * use `DocLibrary.rename` instead — those two paths must not be combined
   * for the same document while it's open.
   */
  updateMeta(patch: { name?: string }): void {
    if (this.currentState === 'invalidated') {
      throw new Error('cannot update meta: session is invalidated');
    }
    if (patch.name === undefined || patch.name === this.currentMeta.name) return;
    this.currentMeta = { ...this.currentMeta, name: patch.name };
    this.markDirty();
    this.emit({ kind: 'meta-changed' });
  }

  async addBlob(bytes: Uint8Array): Promise<Hash> {
    const hash = await defaultHasher.hash(bytes);
    if (!this.blobMap.has(hash)) {
      this.blobMap.set(hash, new Uint8Array(bytes));
      this.unsavedBlobs.add(hash);
      this.markDirty();
      this.emit({ kind: 'blob-added', hash });
    }
    if (!(await this.uploader.hasMeshBlob(hash))) {
      await this.uploader.putMeshBlob(hash, bytes);
    }
    return hash;
  }

  async save(): Promise<void> {
    // If a save is already in flight, wait for it to finish. Then if the
    // session has been mutated since that save started, run another save.
    if (this.savingPromise) {
      await this.savingPromise;
      if (!this.dirty) return;
    }
    this.savingPromise = this._save();
    try {
      await this.savingPromise;
    } finally {
      this.savingPromise = undefined;
    }
  }

  private async _save(): Promise<void> {
    if (this.autosaveTimer !== undefined) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = undefined;
    }
    const updatedMeta: DocMeta = { ...this.currentMeta, updatedAt: Date.now() };
    await this.vfs.write(this.paths.metaKey(this.id), ENC.encode(JSON.stringify(updatedMeta)));
    await this.vfs.write(this.paths.docKey(this.id), ENC.encode(JSON.stringify(this.currentDoc)));
    for (const hash of this.unsavedBlobs) {
      const bytes = this.blobMap.get(hash);
      if (bytes) await this.vfs.write(this.paths.blobKey(this.id, hash), bytes);
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
      this.save().catch((err: unknown) => {
        console.error('DocSession: autosave failed', err);
      });
    }, this.autosaveMs);
  }

  private makeResolver() {
    const blobs = this.blobMap;
    return { get: (hash: Hash) => blobs.get(hash) };
  }

  private emit(evt: DocEvent): void {
    // Snapshot subscribers before iteration so unsubscribe/subscribe calls
    // during emit don't affect the current dispatch.
    for (const cb of [...this.subscribers]) {
      try {
        cb(evt);
      } catch (err) {
        // Swallow subscriber errors so one throwing subscriber doesn't
        // prevent delivery to others. Log to console for visibility.
        console.error('DocSession subscriber threw:', err);
      }
    }
  }
}

/**
 * Recursively freezes an object and all its nested objects/arrays. Used to
 * make session.doc tamper-proof at runtime so a UI binding that accidentally
 * tries to mutate the snapshot fails fast instead of silently corrupting
 * session state.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value) as T;
}
