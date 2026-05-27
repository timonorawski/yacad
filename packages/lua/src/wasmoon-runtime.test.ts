import { describe, expect, it } from 'vitest';
import { defaultHasher } from '@yacad/hash';
import { hashLuaDefinition } from './canonical';
import { LuaError } from './runtime';
import type { LuaDefinition } from './schema';
import { WasmoonLuaRuntime } from './wasmoon-runtime';

const trivial: LuaDefinition = {
  schema: { inputs: [], params: {}, output: '3d' },
  code: 'return geo.box({size = {1, 1, 1}})',
};

const random: LuaDefinition = {
  schema: { inputs: [], params: { seed: { type: 'int', default: 0 } }, output: '3d' },
  code: `
    local r1 = math.random()
    local r2 = math.random()
    return geo.box({size = {r1 * 10, r2 * 10, 1}})
  `,
};

describe('WasmoonLuaRuntime', () => {
  it('runs a trivial script and returns the emitted NodeDoc', async () => {
    const runtime = new WasmoonLuaRuntime();
    try {
      const out = await runtime.evaluate(trivial, [], {});
      expect(out).toEqual({ type: 'box', params: { size: [1, 1, 1] }, children: [] });
    } finally {
      runtime.dispose();
    }
  });

  it('produces identical output across runs of the same instance', async () => {
    const runtime = new WasmoonLuaRuntime();
    try {
      const defHash = await hashLuaDefinition(random, defaultHasher);
      const a = await runtime.evaluate(random, [], { seed: 0 });
      const b = await runtime.evaluate(random, [], { seed: 0 });
      expect(a).toEqual(b);
      expect(defHash).toBeTruthy();
    } finally {
      runtime.dispose();
    }
  });

  it('produces different output for different values', async () => {
    const runtime = new WasmoonLuaRuntime();
    try {
      const a = await runtime.evaluate(random, [], { seed: 1 });
      const b = await runtime.evaluate(random, [], { seed: 2 });
      expect(a).not.toEqual(b);
    } finally {
      runtime.dispose();
    }
  });
});

const inspectG: LuaDefinition = {
  schema: { inputs: [], params: {}, output: '3d' },
  code: `
    local keys = {}
    for k in pairs(_G) do keys[#keys + 1] = k end
    table.sort(keys)
    return geo.node('box', { size = {1, 1, 1}, _g = table.concat(keys, ',') })
  `,
};

describe('WasmoonLuaRuntime sandbox', () => {
  it('only exposes whitelisted globals', async () => {
    const runtime = new WasmoonLuaRuntime();
    try {
      const out = await runtime.evaluate(inspectG, [], {});
      const keys = (out.params!['_g'] as string).split(',');
      // Whitelist: geo, inputs, math, params, string, table, _G.
      // Forbidden: os, io, package, require, dofile, loadfile, debug, coroutine,
      //            load, loadstring, print, collectgarbage.
      for (const banned of [
        'os',
        'io',
        'package',
        'require',
        'dofile',
        'loadfile',
        'debug',
        'coroutine',
        'load',
        'loadstring',
        'print',
        'collectgarbage',
      ]) {
        expect(keys).not.toContain(banned);
      }
      for (const allowed of ['geo', 'inputs', 'math', 'params', 'string', 'table']) {
        expect(keys).toContain(allowed);
      }
    } finally {
      runtime.dispose();
    }
  });

  it('math.randomseed is not exposed', async () => {
    const probe: LuaDefinition = {
      schema: { inputs: [], params: {}, output: '3d' },
      code: `
        if math.randomseed ~= nil then error('randomseed leaked') end
        return geo.box({size = {1, 1, 1}})
      `,
    };
    const runtime = new WasmoonLuaRuntime();
    try {
      await expect(runtime.evaluate(probe, [], {})).resolves.toBeDefined();
    } finally {
      runtime.dispose();
    }
  });

  it('exposes inputs by name with a callable outputType()', async () => {
    // The plan's inputsTable bridges JS -> Lua. Confirm the round-trip works
    // end-to-end: Lua reads inputs.body.outputType() and the result flows back
    // into the emitted NodeDoc.
    const probe: LuaDefinition = {
      schema: { inputs: [{ name: 'body', type: '3d' }], params: {}, output: '3d' },
      code: `return geo.box({size = {1, 1, 1}, t = inputs.body.outputType()})`,
    };
    const runtime = new WasmoonLuaRuntime();
    try {
      const out = await runtime.evaluate(
        probe,
        [{ name: 'body', type: '3d', outputType: () => '3d' }],
        {},
      );
      expect(out.params).toMatchObject({ t: '3d' });
    } finally {
      runtime.dispose();
    }
  });
});

describe('WasmoonLuaRuntime error mapping', () => {
  it('maps syntax errors to phase: compile', async () => {
    const bad: LuaDefinition = {
      schema: { inputs: [], params: {}, output: '3d' },
      code: 'return geo.box({size =',
    };
    const runtime = new WasmoonLuaRuntime();
    try {
      await expect(runtime.evaluate(bad, [], {})).rejects.toMatchObject({
        name: 'LuaError',
        phase: 'compile',
      });
    } finally {
      runtime.dispose();
    }
  });

  it('maps runtime throws to phase: runtime with line number', async () => {
    const bad: LuaDefinition = {
      schema: { inputs: [], params: {}, output: '3d' },
      code: `
        local x = nil
        return x.y -- runtime nil-index on line 3
      `,
    };
    const runtime = new WasmoonLuaRuntime();
    try {
      const err = await runtime.evaluate(bad, [], {}).catch((e) => e);
      expect(err).toBeInstanceOf(LuaError);
      expect(err.phase).toBe('runtime');
      expect(err.line).toBeGreaterThan(0);
    } finally {
      runtime.dispose();
    }
  });

  it('maps non-NodeDoc returns to phase: output', async () => {
    const bad: LuaDefinition = {
      schema: { inputs: [], params: {}, output: '3d' },
      code: 'return 42',
    };
    const runtime = new WasmoonLuaRuntime();
    try {
      await expect(runtime.evaluate(bad, [], {})).rejects.toMatchObject({
        name: 'LuaError',
        phase: 'output',
      });
    } finally {
      runtime.dispose();
    }
  });

  it('sandbox violation surfaces as a runtime error', async () => {
    const bad: LuaDefinition = {
      schema: { inputs: [], params: {}, output: '3d' },
      code: 'return os.time()',
    };
    const runtime = new WasmoonLuaRuntime();
    try {
      await expect(runtime.evaluate(bad, [], {})).rejects.toMatchObject({
        name: 'LuaError',
        phase: 'runtime',
      });
    } finally {
      runtime.dispose();
    }
  });

  it('require is nil — cannot escape sandbox via require("os")', async () => {
    const bad: LuaDefinition = {
      schema: { inputs: [], params: {}, output: '3d' },
      code: 'return require("os").time()',
    };
    const runtime = new WasmoonLuaRuntime();
    try {
      const err = await runtime.evaluate(bad, [], {}).catch((e) => e);
      expect(err).toBeInstanceOf(LuaError);
      expect(err.phase).toBe('runtime');
      expect(err.message).toMatch(/nil value/i);
    } finally {
      runtime.dispose();
    }
  });
});
