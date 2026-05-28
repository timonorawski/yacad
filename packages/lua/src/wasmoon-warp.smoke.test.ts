import { describe, expect, it } from 'vitest';
import { WasmoonLuaRuntime } from './wasmoon-runtime';
import type { LuaDefinition } from './schema';

/**
 * Smoke test: Lua code calls geo.warp and produces a NodeDoc the kernel can
 * later evaluate. This verifies geo.warp is auto-exposed by the registry
 * walker in buildGeoApi() and that its 1-3D-child shape works from Lua.
 */
describe('Lua → geo.warp', () => {
  it('builds a warp NodeDoc with a 3D child', async () => {
    const def: LuaDefinition = {
      schema: { inputs: [], params: {}, output: '3d' },
      code: `
        return geo.warp(
          { code = 'return x, y, z + 1', values = {} },
          { geo.sphere({ radius = 1, segments = 16 }) }
        )
      `,
    };
    const rt = new WasmoonLuaRuntime();
    const doc = await rt.evaluate(def, [], {});
    expect(doc.type).toBe('warp');
    expect(doc.children).toHaveLength(1);
    expect(doc.children![0]!.type).toBe('sphere');
    expect((doc.params as Record<string, unknown>)['code']).toBe('return x, y, z + 1');
  });
});
