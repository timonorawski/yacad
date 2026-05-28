import { describe, expect, it } from 'vitest';
import { LuaFactory } from 'wasmoon';
import { installLuaSandbox } from './sandbox';

describe('installLuaSandbox', () => {
  it('with random.mode="disabled" strips math.random AND math.randomseed', async () => {
    const engine = await new LuaFactory().createEngine({ openStandardLibs: false });
    try {
      await installLuaSandbox(engine, { random: { mode: 'disabled' } });
      const flags = (await engine.doString(
        'return { random = math.random == nil, randomseed = math.randomseed == nil }',
      )) as Record<string, boolean>;
      expect(flags).toEqual({ random: true, randomseed: true });
    } finally {
      engine.global.close();
    }
  });

  it('with random.mode="seeded" keeps math.random and seeds it deterministically', async () => {
    const make = async () => {
      const engine = await new LuaFactory().createEngine({ openStandardLibs: false });
      await installLuaSandbox(engine, {
        random: { mode: 'seeded', seedLo: 1n, seedHi: 2n },
      });
      const v = await engine.doString('return math.random()');
      engine.global.close();
      return v;
    };
    const a = await make();
    const b = await make();
    expect(typeof a).toBe('number');
    expect(a).toBe(b); // same seed → same first random
  });

  it('strips load / loadstring / dofile / loadfile / require / print / collectgarbage / string.dump', async () => {
    const engine = await new LuaFactory().createEngine({ openStandardLibs: false });
    try {
      await installLuaSandbox(engine, { random: { mode: 'disabled' } });
      const flags = (await engine.doString(`return {
        load = load == nil,
        loadstring = loadstring == nil,
        dofile = dofile == nil,
        loadfile = loadfile == nil,
        require = require == nil,
        print = print == nil,
        collectgarbage = collectgarbage == nil,
        string_dump = string.dump == nil,
      }`)) as Record<string, boolean>;
      for (const [name, stripped] of Object.entries(flags)) {
        expect([name, stripped]).toEqual([name, true]);
      }
    } finally {
      engine.global.close();
    }
  });

  it('installs globals from options.globals onto _G', async () => {
    const engine = await new LuaFactory().createEngine({ openStandardLibs: false });
    try {
      await installLuaSandbox(engine, {
        random: { mode: 'disabled' },
        globals: { params: { dx: 7, label: 'x' } },
      });
      expect(await engine.doString('return params.dx')).toBe(7);
      expect(await engine.doString('return params.label')).toBe('x');
    } finally {
      engine.global.close();
    }
  });

  it('leaves the pure math/string/table libs available', async () => {
    const engine = await new LuaFactory().createEngine({ openStandardLibs: false });
    try {
      await installLuaSandbox(engine, { random: { mode: 'disabled' } });
      expect(await engine.doString('return math.sin(0)')).toBe(0);
      expect(await engine.doString('return string.len("abc")')).toBe(3);
      expect(await engine.doString('return table.concat({"a","b","c"}, ",")')).toBe('a,b,c');
    } finally {
      engine.global.close();
    }
  });
});
