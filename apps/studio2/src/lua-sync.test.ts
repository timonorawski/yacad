import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '@yacad/vfs';
import { DocLibrary } from '@yacad/doc-store';
import type { BlobUploader } from '@yacad/doc-store';
import { LuaValidationError, type LuaDefinition } from '@yacad/lua';
import { addLuaDefinition } from './lua-sync';

const noopUploader: BlobUploader = {
  putMeshBlob: async () => {},
  hasMeshBlob: async () => true,
  putLuaDefinition: async () => {},
  hasLuaDefinition: async () => true,
};

async function freshSession() {
  const lib = new DocLibrary(new MemoryVfs(), noopUploader);
  return lib.create('Test', { type: 'box', params: { size: [10, 10, 10] } });
}

const VALID_DEF: LuaDefinition = {
  schema: { inputs: [], params: {}, output: '3d' },
  code: 'return geo.box({ size = { 10, 10, 10 } })',
};

const INVALID_DEF: LuaDefinition = {
  schema: { inputs: [], params: {}, output: '3d' },
  // References an undefined identifier `notASandboxGlobal`
  code: 'return notASandboxGlobal.box({ size = { 10, 10, 10 } })',
};

describe('addLuaDefinition', () => {
  it('accepts a valid definition and returns its hash', async () => {
    const session = await freshSession();
    const hash = await addLuaDefinition(session, VALID_DEF);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
    // Blob should be stored in the session
    expect(session.blobs.has(hash)).toBe(true);
  });

  it('rejects an invalid definition before storing', async () => {
    const session = await freshSession();
    await expect(addLuaDefinition(session, INVALID_DEF)).rejects.toBeInstanceOf(LuaValidationError);
    // Session blob store should remain unmodified (the bad def was never written)
    expect(session.blobs.size).toBe(0);
  });
});
