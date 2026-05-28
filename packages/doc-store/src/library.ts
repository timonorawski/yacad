import type { NodeDoc } from '@yacad/dag';
import type { Vfs } from '@yacad/vfs';
import { DEFAULT_PATHS, makePaths, type Paths } from './paths';
import { DocSession } from './session';
import type { BlobUploader, DocMeta, LibraryOptions, NewDocSeed, SessionOptions } from './types';

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
 *
 * All VFS keys are scoped to a configurable root prefix (default `/docs/`).
 * Pass `{ prefix: '/samples/' }` to create a separate namespace for seeded
 * scenes; the two namespaces are completely independent.
 */
export class DocLibrary {
  private readonly paths: Paths;

  constructor(
    private readonly vfs: Vfs,
    private readonly uploader: BlobUploader,
    options: LibraryOptions = {},
  ) {
    this.paths = options.prefix !== undefined ? makePaths(options.prefix) : DEFAULT_PATHS;
  }

  /** Lists every persisted document, most-recently-updated first. */
  async list(): Promise<readonly DocMeta[]> {
    const keys = await this.vfs.list(this.paths.listDocsPrefix());
    const metas: DocMeta[] = [];
    for (const key of keys) {
      const id = this.paths.parseDocId(key);
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
  async create(name: string, seed?: NewDocSeed, options?: SessionOptions): Promise<DocSession> {
    const now = Date.now();
    const id = crypto.randomUUID();
    const meta: DocMeta = { id, name, createdAt: now, updatedAt: now };
    const doc: NodeDoc = seed ?? DEFAULT_SEED;
    await this.vfs.write(this.paths.metaKey(id), ENC.encode(JSON.stringify(meta)));
    await this.vfs.write(this.paths.docKey(id), ENC.encode(JSON.stringify(doc)));

    let session: DocSession;
    try {
      session = await this.open(id, options);
    } catch (err) {
      // Any failure opening the new doc must roll back the partial write.
      await this.delete(id);
      throw err;
    }

    if (session.state === 'invalidated') {
      // Roll back the failed creation so a bad seed doesn't leave an
      // un-openable document in the library.
      await session.close();
      await this.delete(id);
      throw session.invalidationError ?? new Error(`invalid seed for new document "${name}"`);
    }
    return session;
  }

  /**
   * Updates the display name and bumps `updatedAt`. Throws if `id` is unknown
   * — a loud failure prevents silent data loss from a stale UI reference.
   * (Compare with `delete`, which is intentionally silent on unknown ids so
   * cleanup paths can be unconditional.)
   */
  async rename(id: string, name: string): Promise<void> {
    const metaBytes = await this.vfs.read(this.paths.metaKey(id));
    if (!metaBytes) {
      throw new Error(`no document with id "${id}"`);
    }
    const meta = JSON.parse(DEC.decode(metaBytes)) as DocMeta;
    const updated: DocMeta = { ...meta, name, updatedAt: Date.now() };
    await this.vfs.write(this.paths.metaKey(id), ENC.encode(JSON.stringify(updated)));
  }

  /**
   * Removes the document, its document.json body, and its blobs. Idempotent.
   *
   * Deletion order is **meta → doc → blobs** so that a crash mid-delete leaves
   * the document fully removed from `list()`'s index. The body / blobs become
   * orphan storage that a future sweep can reclaim, but the user never sees
   * a "ghost" document that can't be opened.
   */
  async delete(id: string): Promise<void> {
    await this.vfs.delete(this.paths.metaKey(id));
    await this.vfs.delete(this.paths.docKey(id));
    const blobKeys = await this.vfs.list(this.paths.listBlobsPrefix(id));
    for (const k of blobKeys) await this.vfs.delete(k);
  }

  /**
   * Opens a document into an editable session. Loads meta + doc + blobs,
   * pushes new blobs to the worker, and runs validation.
   */
  async open(id: string, options?: SessionOptions): Promise<DocSession> {
    return DocSession.open(this.vfs, this.uploader, id, options, this.paths);
  }
}
