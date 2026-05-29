import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupRuntime } from '../library-setup';
import type { Ctx } from '../context';
import { listDocs, createDoc, openDoc, deleteDoc, setCurrentDoc } from './library-tools';

describe('library tools', () => {
  let dir: string;
  let ctx: Ctx;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'yacad-mcp-lib-'));
    const rt = await setupRuntime(dir);
    ctx = {
      ...rt,
      sessions: new Map(),
      currentDocId: undefined,
      vfsServer: undefined,
      viewer: undefined,
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('listDocs starts empty', async () => {
    const out = await listDocs(ctx, {});
    expect(out).toEqual({ ok: true, data: [] });
  });

  it('createDoc returns an id and sets it current', async () => {
    const out = await createDoc(ctx, { name: 'Test' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.id).toMatch(/^[a-z0-9-]+$/);
      expect(ctx.currentDocId).toBe(out.data.id);
    }
  });

  it('openDoc returns the doc and blobs and sets current', async () => {
    const create = await createDoc(ctx, { name: 'X' });
    if (!create.ok) throw new Error('create failed');
    const id = create.data.id;
    // Drop the open session so openDoc has work to do.
    ctx.sessions.delete(id);
    ctx.currentDocId = undefined;
    const out = await openDoc(ctx, { id });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.id).toBe(id);
      expect(out.data.doc).toBeDefined();
      expect(ctx.currentDocId).toBe(id);
    }
  });

  it('openDoc on missing id returns a not-found error', async () => {
    const out = await openDoc(ctx, { id: 'nonexistent' });
    expect(out).toEqual({
      ok: false,
      error: { code: 'not-found', message: expect.stringContaining('nonexistent') },
    });
  });

  it('deleteDoc removes it from the library', async () => {
    const create = await createDoc(ctx, { name: 'Y' });
    if (!create.ok) throw new Error('create failed');
    await deleteDoc(ctx, { id: create.data.id });
    const list = await listDocs(ctx, {});
    if (!list.ok) throw new Error('list failed');
    expect(list.data).toEqual([]);
  });

  it('setCurrentDoc switches focus among open sessions', async () => {
    const a = await createDoc(ctx, { name: 'A' });
    const b = await createDoc(ctx, { name: 'B' });
    if (!a.ok || !b.ok) throw new Error('create failed');
    expect(ctx.currentDocId).toBe(b.data.id);
    const out = await setCurrentDoc(ctx, { id: a.data.id });
    expect(out.ok).toBe(true);
    expect(ctx.currentDocId).toBe(a.data.id);
  });
});
