/**
 * End-to-end evaluation of the filleted-slab showcase through the real
 * Manifold kernel + warp evaluator. Catches geometry regressions the
 * schema/buildGraph tests in index.test.ts wouldn't.
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
import { FILLETED_SLAB_DEFINITION } from './index';

describe('filleted slab evaluates to a real rounded slab', () => {
  it('has the expected bbox and a vertex count larger than a plain extrude', async () => {
    const api = await loadManifold();
    const warpEvaluator = new WasmoonWarpEvaluator();
    const kernel = new ManifoldKernel(api, { warpEvaluator });
    const hash = await hashLuaDefinition(FILLETED_SLAB_DEFINITION, defaultHasher);
    const defMap = new Map<string, LuaDefinition>([[hash, FILLETED_SLAB_DEFINITION]]);
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
    // Defaults: 60×40×20, cornerRadius=8, edgeRadius=3 → bbox a touch under
    // the rectangle dims because the warp pulls top/bottom-edge vertices inward.
    expect(maxX - minX).toBeLessThanOrEqual(60);
    expect(maxX - minX).toBeGreaterThan(40);
    expect(maxY - minY).toBeLessThanOrEqual(40);
    expect(maxY - minY).toBeGreaterThan(25);
    expect(maxZ - minZ).toBeCloseTo(20, 1);

    // offset+round on a rectangle plus a warp with hundreds of vertices
    // produces well over the 8 vertices of a plain box.
    const tris = out.geometry.mesh.indices.length / 3;
    expect(tris).toBeGreaterThan(50);
  }, 30_000);
});
