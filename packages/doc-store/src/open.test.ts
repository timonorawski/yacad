import { describe, expect, it } from 'vitest';
import type { NodeDoc } from '@yacad/dag';
import { MemoryVfs } from '@yacad/vfs';
import { DocLibrary } from './library';
import { blobKey, docKey, metaKey } from './paths';
import type { BlobUploader, DocMeta } from './types';

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
    const { lib, id } = await plant(vfs, {
      type: 'this-type-does-not-exist',
      params: {},
    } as NodeDoc);
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
