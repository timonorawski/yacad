import { LuaFactory } from 'wasmoon';
import type { WarpEvaluator, WarpCallback } from '@yacad/kernel-manifold';
import { installLuaSandbox } from './sandbox';
import { LuaError } from './runtime';

export interface WasmoonWarpEvaluatorOptions {
  readonly wasmUrl?: string;
}

/**
 * Compiles Lua deformation expressions to synchronous JS callbacks for the
 * Manifold kernel's `warp` operation. A fresh Wasmoon engine is created per
 * compile — small overhead per warp node, but keeps state clean (no cross-warp
 * leakage). The returned callback is synchronous because Manifold's
 * `Manifold.warp()` requires a synchronous JS function (it is invoked once
 * per vertex while the WASM holds the mesh).
 *
 * Sandbox is configured with `random.mode = 'disabled'`: a vertex deformation
 * function MUST be a pure function of (x, y, z, params.values). Per-vertex
 * randomness would break the cache contract and trip future LOD/preview
 * tiers and any parallel evaluation.
 */
export class WasmoonWarpEvaluator implements WarpEvaluator {
  private readonly factory: LuaFactory;

  constructor(opts: WasmoonWarpEvaluatorOptions = {}) {
    this.factory = opts.wasmUrl ? new LuaFactory(opts.wasmUrl) : new LuaFactory();
  }

  async compile(code: string, values: Record<string, unknown>): Promise<WarpCallback> {
    const engine = await this.factory.createEngine({ openStandardLibs: false });
    await installLuaSandbox(engine, {
      random: { mode: 'disabled' },
      globals: { params: values },
    });

    // Wrap the user code in a named function once. Wasmoon's sync function
    // proxy returns only the first Lua return value, so we pack the user's
    // (x, y, z) multret into a table by calling an inner function through
    // `{ ... }` capture. This keeps the user contract simple: write
    // `return new_x, new_y, new_z`.
    const wrapped = `
      local function __yacad_warp_inner(x, y, z)
        ${code}
      end
      function __yacad_warp(x, y, z)
        return { __yacad_warp_inner(x, y, z) }
      end
    `;
    try {
      await engine.doString(wrapped);
    } catch (err) {
      engine.global.close();
      throw new LuaError(`warp compile error: ${(err as Error).message}`, { phase: 'compile' });
    }

    const fn = engine.global.get('__yacad_warp') as (
      x: number,
      y: number,
      z: number,
    ) => [number, number, number] | undefined;

    // Engine lifetime is tied to the returned callback's closure — the kernel
    // discards the callback after one warp evaluation and the engine is
    // garbage-collected. We deliberately do NOT close the engine here.
    return (x, y, z) => {
      const out = fn(x, y, z);
      if (!Array.isArray(out) || out.length !== 3) {
        throw new Error('warp Lua function must return three numbers: return new_x, new_y, new_z');
      }
      return out as [number, number, number];
    };
  }
}
