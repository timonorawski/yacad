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
