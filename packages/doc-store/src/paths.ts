import type { Hash } from '@yacad/hash';

/**
 * VFS key conventions. The Vfs treats keys as opaque strings; the doc-store
 * builds a hierarchy under a configurable root prefix (default `/docs/`).
 * The studio v2 app uses TWO instances: `/docs/` for user docs, `/samples/`
 * for the seeded scene library.
 *
 * Changing these helpers in a backward-incompatible way breaks every
 * persisted document, so don't.
 */

const DEFAULT_PREFIX = '/docs/';
const META_FILE = '/meta.json';
const DOC_FILE = '/document.json';
const BLOBS_DIR = '/blobs/';
const BLOB_EXT = '.bin';

export interface Paths {
  /** The root prefix this Paths instance is bound to (e.g., `/docs/`). */
  readonly rootPrefix: string;
  metaKey(docId: string): string;
  docKey(docId: string): string;
  blobKey(docId: string, hash: Hash): string;
  listBlobsPrefix(docId: string): string;
  listDocsPrefix(): string;
  parseDocId(key: string): string | undefined;
  blobHashFromKey(docId: string, key: string): Hash | undefined;
}

/** Build a Paths instance bound to a root prefix. */
export function makePaths(rootPrefix: string = DEFAULT_PREFIX): Paths {
  if (!rootPrefix.endsWith('/')) {
    throw new Error(`Paths prefix must end with "/" (got "${rootPrefix}")`);
  }
  return {
    rootPrefix,
    metaKey: (docId) => `${rootPrefix}${docId}${META_FILE}`,
    docKey: (docId) => `${rootPrefix}${docId}${DOC_FILE}`,
    blobKey: (docId, hash) => `${rootPrefix}${docId}${BLOBS_DIR}${hash}${BLOB_EXT}`,
    listBlobsPrefix: (docId) => `${rootPrefix}${docId}${BLOBS_DIR}`,
    listDocsPrefix: () => rootPrefix,
    parseDocId(key) {
      if (!key.startsWith(rootPrefix)) return undefined;
      if (!key.endsWith(META_FILE)) return undefined;
      const middle = key.slice(rootPrefix.length, key.length - META_FILE.length);
      if (middle.length === 0 || middle.includes('/')) return undefined;
      return middle;
    },
    blobHashFromKey(docId, key) {
      const prefix = `${rootPrefix}${docId}${BLOBS_DIR}`;
      if (!key.startsWith(prefix) || !key.endsWith(BLOB_EXT)) return undefined;
      const hash = key.slice(prefix.length, key.length - BLOB_EXT.length);
      return hash.length > 0 ? hash : undefined;
    },
  };
}

/** Default Paths instance bound to `/docs/`. */
export const DEFAULT_PATHS: Paths = makePaths(DEFAULT_PREFIX);

// ─── Backward-compat shims ────────────────────────────────────────────────────
// The original module exposed bare functions. Keep them as proxies over
// DEFAULT_PATHS so existing callers continue to compile.
export const metaKey = (docId: string): string => DEFAULT_PATHS.metaKey(docId);
export const docKey = (docId: string): string => DEFAULT_PATHS.docKey(docId);
export const blobKey = (docId: string, hash: Hash): string => DEFAULT_PATHS.blobKey(docId, hash);
export const listBlobsPrefix = (docId: string): string => DEFAULT_PATHS.listBlobsPrefix(docId);
export const listDocsPrefix = (): string => DEFAULT_PATHS.listDocsPrefix();
export const parseDocId = (key: string): string | undefined => DEFAULT_PATHS.parseDocId(key);
export const blobHashFromKey = (docId: string, key: string): Hash | undefined =>
  DEFAULT_PATHS.blobHashFromKey(docId, key);
