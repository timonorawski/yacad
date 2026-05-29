import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupRuntime } from '../library-setup';
import type { Ctx } from '../context';
import { createDoc } from './library-tools';
import { exportStl, exportSvg, exportDxf } from './export-tools';

describe('export tools', () => {
  let dir: string;
  let ctx: Ctx;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'yacad-mcp-exp-'));
    const rt = await setupRuntime(dir);
    ctx = {
      ...rt,
      sessions: new Map(),
      currentDocId: undefined,
      vfsServer: undefined,
      viewer: undefined,
    };
  }, 60_000);

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('exportStl returns base64 STL for a 3D root', async () => {
    await createDoc(ctx, {
      name: 'box',
      initialDoc: { type: 'box', params: { size: [10, 10, 10], center: true } },
    });
    const out = await exportStl(ctx, {});
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.filename).toMatch(/\.stl$/);
      expect(out.data.base64.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('exportStl on a 2D doc returns wrong-geometry-kind', async () => {
    await createDoc(ctx, {
      name: 'circle',
      initialDoc: { type: 'circle', params: { radius: 5 } },
    });
    const out = await exportStl(ctx, {});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('wrong-geometry-kind');
  }, 60_000);

  it('exportSvg returns SVG for a 2D root', async () => {
    await createDoc(ctx, {
      name: 'circle',
      initialDoc: { type: 'circle', params: { radius: 5 } },
    });
    const out = await exportSvg(ctx, {});
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.filename).toMatch(/\.svg$/);
  }, 60_000);

  it('exportDxf returns DXF for a 2D root', async () => {
    await createDoc(ctx, {
      name: 'circle',
      initialDoc: { type: 'circle', params: { radius: 5 } },
    });
    const out = await exportDxf(ctx, {});
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.filename).toMatch(/\.dxf$/);
  }, 60_000);
});
