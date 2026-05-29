import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupRuntime } from '../library-setup';
import type { Ctx } from '../context';
import { createDoc } from './library-tools';
import { getDoc, getNodeAt, evaluate } from './read-tools';

describe('read tools', () => {
  let dir: string;
  let ctx: Ctx;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'yacad-mcp-read-'));
    const rt = await setupRuntime(dir);
    ctx = {
      ...rt,
      sessions: new Map(),
      currentDocId: undefined,
      vfsServer: undefined,
      viewer: undefined,
    };
    const created = await createDoc(ctx, {
      name: 'box',
      initialDoc: { type: 'box', params: { size: [10, 10, 10], center: true } },
    });
    if (!created.ok) throw new Error('seed failed');
  }, 60_000);

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('getDoc returns the current doc tree', async () => {
    const out = await getDoc(ctx, {});
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.data as { type: string }).type).toBe('box');
    }
  });

  it('getNodeAt returns a node summary by path', async () => {
    const out = await getNodeAt(ctx, { path: '$' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.type).toBe('box');
      expect(out.data.childCount).toBe(0);
    }
  });

  it('getNodeAt on a bad path returns bad-path', async () => {
    const out = await getNodeAt(ctx, { path: '$/0' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('bad-path');
  });

  it('evaluate returns bbox + triangleCount + stats', async () => {
    const out = await evaluate(ctx, {});
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.triangleCount).toBeGreaterThan(0);
      expect(out.data.bbox).toBeDefined();
      expect(out.data.stats.totalMs).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);

  it('evaluate with includePerNode includes the per-node array', async () => {
    const out = await evaluate(ctx, { includePerNode: true });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.perNode).toBeDefined();
      expect((out.data.perNode ?? []).length).toBeGreaterThan(0);
    }
  }, 60_000);
});
