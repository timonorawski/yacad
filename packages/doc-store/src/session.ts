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
    private readonly vfs: Vfs, // used in later tasks
    private readonly uploader: BlobUploader, // used in later tasks
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
