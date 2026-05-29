import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupRuntime } from '../library-setup';
import type { Ctx } from '../context';
import { createDoc } from './library-tools';
import { evaluate } from './read-tools';
import { clearCache } from './cache-tools';

describe('cache tool', () => {
  let dir: string;
  let ctx: Ctx;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'yacad-mcp-cache-'));
    const rt = await setupRuntime(dir);
    ctx = {
      ...rt,
      sessions: new Map(),
      currentDocId: undefined,
      vfsServer: undefined,
      viewer: undefined,
    };
    await createDoc(ctx, {
      name: 'box',
      initialDoc: { type: 'box', params: { size: [10, 10, 10], center: true } },
    });
  }, 60_000);

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('clearCache makes the next evaluate cold', async () => {
    const warm1 = await evaluate(ctx, {});
    if (!warm1.ok) throw new Error('eval 1 failed');
    const warm2 = await evaluate(ctx, {});
    if (!warm2.ok) throw new Error('eval 2 failed');
    expect(warm2.data.stats.hits).toBeGreaterThan(0);

    const cleared = await clearCache(ctx, {});
    expect(cleared.ok).toBe(true);

    const cold = await evaluate(ctx, {});
    if (!cold.ok) throw new Error('cold eval failed');
    expect(cold.data.stats.hits).toBe(0);
    expect(cold.data.stats.misses).toBeGreaterThan(0);
  }, 60_000);
});
