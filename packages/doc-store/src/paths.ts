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

/**
 * Extract the blob hash from a key of the form `/docs/{id}/blobs/{hash}.bin`,
 * or `undefined` if the key doesn't match. Mirrors `blobKey` — same constants,
 * inverse direction.
 */
export function blobHashFromKey(docId: string, key: string): Hash | undefined {
  const prefix = `${DOCS_ROOT}${docId}${BLOBS_DIR}`;
  if (!key.startsWith(prefix) || !key.endsWith(BLOB_EXT)) return undefined;
  const hash = key.slice(prefix.length, key.length - BLOB_EXT.length);
  return hash.length > 0 ? hash : undefined;
}
