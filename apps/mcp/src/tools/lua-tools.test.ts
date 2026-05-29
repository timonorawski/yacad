import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupRuntime } from '../library-setup';
import type { Ctx } from '../context';
import { createDoc } from './library-tools';
import { addLuaDefinition, validateLuaCode } from './lua-tools';

describe('lua tools', () => {
  let dir: string;
  let ctx: Ctx;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'yacad-mcp-lua-'));
    const rt = await setupRuntime(dir);
    ctx = {
      ...rt,
      sessions: new Map(),
      currentDocId: undefined,
      vfsServer: undefined,
      viewer: undefined,
    };
    await createDoc(ctx, { name: 'empty' });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('addLuaDefinition errors with no-current-doc when no doc is open', async () => {
    // Override the beforeEach default: drop the seeded doc so currentDocId is unset.
    ctx.currentDocId = undefined;
    ctx.sessions.clear();
    const out = await addLuaDefinition(ctx, {
      schema: { inputs: [], params: {}, output: '3d' },
      code: 'return geo.box({ size = {1,1,1} })',
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('no-current-doc');
      expect(out.error.message).toMatch(/createDoc|openDoc/);
    }
    // And nothing leaked into the in-memory map.
    expect(ctx.luaDefs.size).toBe(0);
  });

  it('addLuaDefinition stores valid Lua and returns its hash', async () => {
    const out = await addLuaDefinition(ctx, {
      schema: { inputs: [], params: {}, output: '3d' },
      code: 'return geo.box({ size = {10, 10, 10}, center = true })',
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.hash).toMatch(/^[a-f0-9]{16,}$/);
      expect(ctx.luaDefs.has(out.data.hash)).toBe(true);
    }
  });

  it('addLuaDefinition rejects code that references os.exit', async () => {
    const out = await addLuaDefinition(ctx, {
      schema: { inputs: [], params: {}, output: '3d' },
      code: 'os.exit(0)',
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('lua-validation');
      expect(out.error.details).toMatchObject({
        issues: expect.arrayContaining([expect.anything()]),
      });
    }
  });

  it('validateLuaCode does not register and returns issues array', async () => {
    const before = ctx.luaDefs.size;
    const out = await validateLuaCode(ctx, {
      schema: { inputs: [], params: {}, output: '3d' },
      code: 'os.exit(0)',
    });
    expect(out.ok).toBe(true); // tool succeeded; issues are in data
    if (out.ok) expect(out.data.issues.length).toBeGreaterThan(0);
    expect(ctx.luaDefs.size).toBe(before);
  });

  it('validateLuaCode on clean code returns empty issues', async () => {
    const out = await validateLuaCode(ctx, {
      schema: { inputs: [], params: {}, output: '3d' },
      code: 'return geo.box({ size = {1,1,1} })',
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.issues).toEqual([]);
  });
});
