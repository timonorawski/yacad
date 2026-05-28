import { describe, expect, it } from 'vitest';
import { buildGraph } from '@yacad/dag';
import { WasmoonWarpEvaluator } from '@yacad/lua';
import { loadManifold } from './loader';
import { ManifoldKernel } from './kernel';

async function evalChild(kernel: ManifoldKernel, doc: unknown) {
  const node = await buildGraph(doc);
  return kernel.evaluate(node, []);
}

describe('ManifoldKernel evaluates `warp`', () => {
  it('shifts every vertex of a sphere by params.dz', async () => {
    const api = await loadManifold();
    const ev = new WasmoonWarpEvaluator();
    const kernel = new ManifoldKernel(api, { warpEvaluator: ev });

    const childGeo = await evalChild(kernel, {
      type: 'sphere',
      params: { radius: 1, segments: 16 },
    });
    const node = await buildGraph({
      type: 'warp',
      params: { code: 'return x, y, z + params.dz', values: { dz: 10 } },
      children: [{ type: 'sphere', params: { radius: 1, segments: 16 } }],
    });
    const out = await kernel.evaluate(node, [childGeo]);
    expect(out.kind).toBe('3d');
    if (out.kind !== '3d') throw new Error('expected 3D');
    let minZ = Infinity;
    for (let i = 2; i < out.mesh.vertices.length; i += 3) {
      minZ = Math.min(minZ, out.mesh.vertices[i]!);
    }
    // Sphere(r=1) originally spans z ∈ [-1, 1]; shifted by +10 → [9, 11].
    expect(minZ).toBeGreaterThan(8.9);
  });

  it('produces byte-identical output for identical (code, values, mesh)', async () => {
    // Determinism contract (CLAUDE.md #2): same inputs → same bytes.
    const api = await loadManifold();
    const ev = new WasmoonWarpEvaluator();
    const kernel = new ManifoldKernel(api, { warpEvaluator: ev });

    const childGeo = await evalChild(kernel, {
      type: 'sphere',
      params: { radius: 1, segments: 16 },
    });
    const node = await buildGraph({
      type: 'warp',
      params: { code: 'return x, y, z + params.dz', values: { dz: 2.5 } },
      children: [{ type: 'sphere', params: { radius: 1, segments: 16 } }],
    });
    const a = await kernel.evaluate(node, [childGeo]);
    const b = await kernel.evaluate(node, [childGeo]);
    if (a.kind !== '3d' || b.kind !== '3d') throw new Error('expected 3D');
    expect(Array.from(a.mesh.vertices)).toEqual(Array.from(b.mesh.vertices));
    expect(Array.from(a.mesh.indices)).toEqual(Array.from(b.mesh.indices));
  });

  it('rejects warp Lua that tries to call math.random (sandbox strips it)', async () => {
    const api = await loadManifold();
    const ev = new WasmoonWarpEvaluator();
    const kernel = new ManifoldKernel(api, { warpEvaluator: ev });

    const childGeo = await evalChild(kernel, {
      type: 'sphere',
      params: { radius: 1, segments: 8 },
    });
    const node = await buildGraph({
      type: 'warp',
      params: { code: 'return x, y, z + math.random()' },
      children: [{ type: 'sphere', params: { radius: 1, segments: 8 } }],
    });
    await expect(kernel.evaluate(node, [childGeo])).rejects.toThrow();
  });

  it('throws if no WarpEvaluator was supplied to the kernel', async () => {
    const api = await loadManifold();
    const kernel = new ManifoldKernel(api); // no evaluator

    const childGeo = await evalChild(kernel, {
      type: 'sphere',
      params: { radius: 1, segments: 8 },
    });
    const node = await buildGraph({
      type: 'warp',
      params: { code: 'return x, y, z' },
      children: [{ type: 'sphere', params: { radius: 1, segments: 8 } }],
    });
    await expect(kernel.evaluate(node, [childGeo])).rejects.toThrow(/warp.*evaluator/i);
  });
});
