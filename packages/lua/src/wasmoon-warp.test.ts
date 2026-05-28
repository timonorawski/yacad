import { describe, expect, it } from 'vitest';
import { WasmoonWarpEvaluator } from './wasmoon-warp';

describe('WasmoonWarpEvaluator', () => {
  it('compiles a Lua function and applies it per vertex', async () => {
    const ev = new WasmoonWarpEvaluator();
    const cb = await ev.compile('return x, y, z + 1', {});
    expect(cb(0, 0, 0)).toEqual([0, 0, 1]);
    expect(cb(1, 2, 3)).toEqual([1, 2, 4]);
  });

  it('passes values via the params table', async () => {
    const ev = new WasmoonWarpEvaluator();
    const cb = await ev.compile('return x + params.dx, y, z', { dx: 5 });
    expect(cb(0, 0, 0)).toEqual([5, 0, 0]);
    expect(cb(10, 1, 2)).toEqual([15, 1, 2]);
  });

  it('reports a Lua compile error with a clear message', async () => {
    const ev = new WasmoonWarpEvaluator();
    await expect(ev.compile('return ((', {})).rejects.toThrow(/warp compile/);
  });

  it('throws if the Lua function returns the wrong shape', async () => {
    const ev = new WasmoonWarpEvaluator();
    const cb = await ev.compile('return x', {});
    expect(() => cb(0, 0, 0)).toThrow(/three numbers/);
  });

  it('cannot call math.random — sandbox strips it', async () => {
    const ev = new WasmoonWarpEvaluator();
    // math.random is nil in this sandbox; calling nil throws.
    const cb = await ev.compile('return x, y, z + math.random()', {});
    expect(() => cb(0, 0, 0)).toThrow();
  });
});
