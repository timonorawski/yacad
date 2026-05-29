/**
 * End-to-end evaluation of the chamfered-box showcase through the real
 * Manifold kernel. The schema/buildGraph tests in index.test.ts pass even
 * when the geometry is wrong (they never run the kernel) — and earlier
 * iterations of this scene shipped two such regressions:
 *
 *   1. `geo.extrude` was called with a non-existent `center` param;
 *      the validator now catches this (locked by the validateLuaSource
 *      assertion in index.test.ts).
 *   2. Pre-rotation triangle corners were specified in CW winding for half
 *      of the horizontal-edge wedges. Manifold treats CW outer boundaries
 *      as holes, returns an empty CrossSection, and the downstream extrude
 *      reads `.length` on undefined.
 *
 * This test catches (2) and any future regression that breaks end-to-end
 * evaluation through the boolean composition.
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
  hashLuaDefinition,
  type LuaDefinition,
} from '@yacad/lua';
import { CHAMFERED_BOX_DEFINITION } from './index';

describe('chamfered box evaluates to a real chamfered cuboid', () => {
  it('has the expected bbox and a vertex count well above the 8 of a plain box', async () => {
    const api = await loadManifold();
    const kernel = new ManifoldKernel(api);
    const hash = await hashLuaDefinition(CHAMFERED_BOX_DEFINITION, defaultHasher);
    const defMap = new Map<string, LuaDefinition>([[hash, CHAMFERED_BOX_DEFINITION]]);
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
    // Default 50×50×50 box, chamfer=5 → bbox should match the box.
    expect(maxX - minX).toBeCloseTo(50, 1);
    expect(maxY - minY).toBeCloseTo(50, 1);
    expect(maxZ - minZ).toBeCloseTo(50, 1);

    // A plain box has 8 vertices and 12 triangles. A chamfered box has many
    // more (each chamfered edge contributes its own face), so 50+ tris is a
    // sane minimum that survives Manifold's mesh simplification.
    const tris = out.geometry.mesh.indices.length / 3;
    expect(tris).toBeGreaterThan(50);
  }, 30_000);
});
