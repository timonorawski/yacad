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
  private mutating = false;

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
    if (this.mutating) {
      throw new Error('cannot mutate: another mutation is already in progress');
    }
    this.mutating = true;
    try {
      const next = fn(this.currentDoc);
      // Validate by running the same builder the engine uses. Any rejection
      // here leaves state untouched and propagates the original error.
      await buildGraph(next, defaultHasher, '$', this.makeResolver());

      this.undoStack.push(this.currentDoc);
      this.redoStack.length = 0;
      this.currentDoc = next;
      this.dirty = true;
      this.emit({ kind: 'doc-changed' });
    } finally {
      this.mutating = false;
    }
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
