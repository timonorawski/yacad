import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupRuntime } from '../library-setup';
import type { Ctx } from '../context';
import { createDoc } from './library-tools';
import { getDoc } from './read-tools';
import {
  addChild,
  wrapWith,
  unwrap,
  removeAt,
  moveChild,
  replaceAt,
  setParam,
  setParams,
} from './mutate-tools';

interface NodeDoc {
  type: string;
  params?: Record<string, unknown>;
  children?: NodeDoc[];
}

describe('mutate tools', () => {
  let dir: string;
  let ctx: Ctx;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'yacad-mcp-mut-'));
    const rt = await setupRuntime(dir);
    ctx = {
      ...rt,
      sessions: new Map(),
      currentDocId: undefined,
      vfsServer: undefined,
      viewer: undefined,
    };
    await createDoc(ctx, {
      name: 'union2',
      initialDoc: {
        type: 'union',
        children: [
          { type: 'box', params: { size: [10, 10, 10], center: true } },
          { type: 'sphere', params: { radius: 6, segments: 16 } },
        ],
      },
    });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function currentDoc(): Promise<NodeDoc> {
    const out = await getDoc(ctx, {});
    if (!out.ok) throw new Error('getDoc failed');
    return out.data as NodeDoc;
  }

  it('addChild appends a node', async () => {
    const out = await addChild(ctx, {
      parentPath: '$',
      nodeDoc: { type: 'cylinder', params: { radius: 3, height: 8 } },
    });
    expect(out.ok).toBe(true);
    const doc = await currentDoc();
    expect((doc.children ?? []).length).toBe(3);
    expect(doc.children![2]!.type).toBe('cylinder');
  });

  it('wrapWith inserts a wrapper around a node', async () => {
    const out = await wrapWith(ctx, {
      path: '$/0',
      type: 'translate',
      params: { offset: [5, 0, 0] },
    });
    expect(out.ok).toBe(true);
    const doc = await currentDoc();
    expect(doc.children![0]!.type).toBe('translate');
    expect(doc.children![0]!.children![0]!.type).toBe('box');
  });

  it('unwrap removes a wrapper, keeping the sole child', async () => {
    await wrapWith(ctx, { path: '$/0', type: 'translate', params: { offset: [1, 0, 0] } });
    const out = await unwrap(ctx, { path: '$/0' });
    expect(out.ok).toBe(true);
    const doc = await currentDoc();
    expect(doc.children![0]!.type).toBe('box');
  });

  it('removeAt removes a child', async () => {
    const out = await removeAt(ctx, { path: '$/1' });
    expect(out.ok).toBe(true);
    const doc = await currentDoc();
    expect((doc.children ?? []).length).toBe(1);
    expect(doc.children![0]!.type).toBe('box');
  });

  it('moveChild reorders children', async () => {
    const out = await moveChild(ctx, {
      srcPath: '$/0',
      destParentPath: '$',
      destIndex: 2,
    });
    expect(out.ok).toBe(true);
    const doc = await currentDoc();
    // After moving $/0 to end, sphere should be first now.
    expect(doc.children![0]!.type).toBe('sphere');
  });

  it('replaceAt swaps a node', async () => {
    const out = await replaceAt(ctx, {
      path: '$/0',
      newDoc: { type: 'cylinder', params: { radius: 2, height: 4 } },
    });
    expect(out.ok).toBe(true);
    const doc = await currentDoc();
    expect(doc.children![0]!.type).toBe('cylinder');
  });

  it('setParam updates a single key', async () => {
    const out = await setParam(ctx, { path: '$/1', key: 'radius', value: 9 });
    expect(out.ok).toBe(true);
    const doc = await currentDoc();
    expect(doc.children![1]!.params!['radius']).toBe(9);
  });

  it('setParams updates many keys atomically; undefined deletes', async () => {
    const out = await setParams(ctx, {
      path: '$/1',
      patch: { radius: 12, segments: undefined },
    });
    expect(out.ok).toBe(true);
    const doc = await currentDoc();
    expect(doc.children![1]!.params!['radius']).toBe(12);
    expect(doc.children![1]!.params!['segments']).toBeUndefined();
  });

  it('setParam with invalid value surfaces dag-validation error', async () => {
    const out = await setParam(ctx, { path: '$/0', key: 'size', value: 'not-a-vector' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('dag-validation');
      expect(out.error.details).toBeDefined();
    }
  });
});
