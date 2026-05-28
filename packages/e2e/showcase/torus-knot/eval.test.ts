/**
 * End-to-end evaluation of the torus-knot showcase through the real Manifold
 * kernel + warp evaluator. This is the only test that proves the sample
 * produces an actual knot: the schema/buildGraph tests in index.test.ts pass
 * even when the geometry is wrong (they never run the kernel). Regression
 * guard for the revolve-frame bug — a flat disc would fail the dz assertion.
 */
import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  registerNodeType,
  unregisterNodeType,
  type DefinitionResolver,
} from '@yacad/dag';
import { defaultHasher } from '@yacad/hash';
import { ManifoldKernel, loadManifold } from '@yacad/kernel-manifold';
import { Engine } from '@yacad/engine';
import { MemoryStore } from '@yacad/cache';
import {
  makeLuaNodeType,
  WasmoonLuaRuntime,
  WasmoonWarpEvaluator,
  hashLuaDefinition,
  type LuaDefinition,
} from '@yacad/lua';
import { TORUS_KNOT_DEFINITION } from './index';

describe('torus knot evaluates to a real 3D knot', () => {
  it('has the expected bbox extents and is not a flat disc', async () => {
    const api = await loadManifold();
    const warpEvaluator = new WasmoonWarpEvaluator();
    const kernel = new ManifoldKernel(api, { warpEvaluator });
    const hash = await hashLuaDefinition(TORUS_KNOT_DEFINITION, defaultHasher);
    const defMap = new Map<string, LuaDefinition>([[hash, TORUS_KNOT_DEFINITION]]);
    const resolver: DefinitionResolver = { get: (h) => defMap.get(h) };
    unregisterNodeType('lua');
    registerNodeType(makeLuaNodeType(new WasmoonLuaRuntime(), { get: (h) => defMap.get(h) }));

    const engine = new Engine(new MemoryStore(), kernel, { resolver });
    const out = await engine.evaluate(
      await buildGraph(
        { type: 'lua', params: { definitionHash: hash, values: {} } },
        defaultHasher,
        '$',
        resolver,
      ),
    );
    expect(out.geometry.kind).toBe('3d');
    if (out.geometry.kind !== '3d') return;
    const v = out.geometry.mesh.vertices;
    let minX = 1e9,
      maxX = -1e9,
      minY = 1e9,
      maxY = -1e9,
      minZ = 1e9,
      maxZ = -1e9;
    for (let i = 0; i < v.length; i += 3) {
      minX = Math.min(minX, v[i]);
      maxX = Math.max(maxX, v[i]);
      minY = Math.min(minY, v[i + 1]);
      maxY = Math.max(maxY, v[i + 1]);
      minZ = Math.min(minZ, v[i + 2]);
      maxZ = Math.max(maxZ, v[i + 2]);
    }
    const dx = maxX - minX,
      dy = maxY - minY,
      dz = maxZ - minZ;
    console.log(
      `bbox: x[${minX.toFixed(1)},${maxX.toFixed(1)}] y[${minY.toFixed(1)},${maxY.toFixed(1)}] z[${minZ.toFixed(1)},${maxZ.toFixed(1)}]  dims=${dx.toFixed(1)}×${dy.toFixed(1)}×${dz.toFixed(1)}  tris=${out.geometry.mesh.indices.length / 3}`,
    );
    // A (1,3) knot around major=25, minor=10, thread=3.75 should span roughly
    // ±(major+minor+thread) ≈ ±39 in X and Y, and a substantial Z thickness —
    // NOT a flat disc (dz must be well above the thread diameter).
    expect(dx).toBeGreaterThan(40);
    expect(dy).toBeGreaterThan(40);
    expect(dz).toBeGreaterThan(15); // a flat disc would have dz ≈ thread diameter ~7.5
  }, 60000);
});
