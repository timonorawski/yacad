import type { NodeDoc } from '@yacad/dag';
import type { DocLibrary, DocMeta, DocSession } from '@yacad/doc-store';
import type { Hash } from '@yacad/hash';

export const BUNDLE_FORMAT = 'yacad-doc-bundle-v1';
export const ARCHIVE_FORMAT = 'yacad-archive-v1';

export interface DocBundle {
  readonly format: typeof BUNDLE_FORMAT;
  readonly meta: DocMeta;
  readonly document: NodeDoc;
  readonly blobs: Record<Hash, string>; // hex-hash → base64 bytes
}

export interface DocArchive {
  readonly format: typeof ARCHIVE_FORMAT;
  readonly exportedAt: number;
  readonly documents: readonly Omit<DocBundle, 'format'>[];
}

/** Encode a Uint8Array to base64. Browser-safe via TextDecoder + atob/btoa
 *  isn't ideal because of binary-safe handling; use the loop pattern. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function base64ToBytes(s: string): Uint8Array {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Build a bundle from a live open session. */
export function bundleSession(session: DocSession): DocBundle {
  const blobs: Record<string, string> = {};
  for (const [hash, bytes] of session.blobs) {
    blobs[hash] = bytesToBase64(bytes);
  }
  return {
    format: BUNDLE_FORMAT,
    meta: session.meta,
    document: session.doc,
    blobs,
  };
}

/** Build a bundle from a library doc by id (opens, snapshots, closes). */
export async function bundleLibraryDoc(library: DocLibrary, id: string): Promise<DocBundle> {
  const session = await library.open(id);
  try {
    return bundleSession(session);
  } finally {
    await session.close();
  }
}

/** Build an archive of every doc in the library. */
export async function archiveLibrary(library: DocLibrary): Promise<DocArchive> {
  const metas = await library.list();
  const documents: Omit<DocBundle, 'format'>[] = [];
  for (const meta of metas) {
    const bundle = await bundleLibraryDoc(library, meta.id);
    documents.push({
      meta: bundle.meta,
      document: bundle.document,
      blobs: bundle.blobs,
    });
  }
  return {
    format: ARCHIVE_FORMAT,
    exportedAt: Date.now(),
    documents,
  };
}

export interface ImportResult {
  readonly imported: number;
  readonly newIds: readonly string[];
}

/** Parse a JSON string into a known bundle or archive shape. */
export function parseImportPayload(text: string): DocBundle | DocArchive {
  const parsed = JSON.parse(text) as { format?: string };
  if (parsed.format === BUNDLE_FORMAT) return parsed as unknown as DocBundle;
  if (parsed.format === ARCHIVE_FORMAT) return parsed as unknown as DocArchive;
  throw new Error(
    `unrecognized import format: ${parsed.format ?? '(missing format field)'} — expected "${BUNDLE_FORMAT}" or "${ARCHIVE_FORMAT}"`,
  );
}

/** Import every document in a bundle or archive into the target library.
 *  Each imported doc gets a FRESH UUID (so re-importing doesn't collide with
 *  existing). Returns the new ids. */
export async function importPayload(
  library: DocLibrary,
  payload: DocBundle | DocArchive,
): Promise<ImportResult> {
  const docsToImport: Omit<DocBundle, 'format'>[] =
    payload.format === BUNDLE_FORMAT
      ? [{ meta: payload.meta, document: payload.document, blobs: payload.blobs }]
      : [...payload.documents];

  const newIds: string[] = [];
  for (const doc of docsToImport) {
    // Decode blobs first so the create() can validate against them via the
    // session's resolver. We use { skipValidation: true } since the blobs
    // are uploaded AFTER create.
    const session = await library.create(doc.meta.name, doc.document, {
      skipValidation: true,
    });
    for (const [, b64] of Object.entries(doc.blobs)) {
      await session.addBlob(base64ToBytes(b64));
    }
    await session.save();
    await session.close();
    newIds.push(session.id);
  }
  return { imported: newIds.length, newIds };
}

/** Helper: download a JSON value as a file via a temporary anchor. */
export function downloadJson(value: unknown, filename: string): void {
  const text = JSON.stringify(value, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the click can start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Helper: prompt the user to upload a single file, returns the text content. */
export function uploadJson(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(undefined);
        return;
      }
      resolve(await file.text());
    };
    input.click();
  });
}
