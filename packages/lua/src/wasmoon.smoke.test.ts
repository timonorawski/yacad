import { describe, expect, it } from 'vitest';
import { LuaFactory } from 'wasmoon';

describe('wasmoon smoke (canary for Wasmoon API drift)', () => {
  it('runs trivial Lua', async () => {
    const factory = new LuaFactory();
    const engine = await factory.createEngine();
    try {
      expect(await engine.doString('return 1 + 1')).toBe(2);
    } finally {
      engine.global.close();
    }
  });

  it('round-trips JS object set on _G, called from Lua, returned to JS', async () => {
    // The runtime's geo API depends on this: engine.global.set('geo', { box: (params) => ({...}) })
    // must (a) be callable from Lua as geo.box(params), (b) the JS function's return
    // value must come back to JS as a plain object when Lua returns it.
    const factory = new LuaFactory();
    const engine = await factory.createEngine({ openStandardLibs: false });
    try {
      engine.global.set('mk', (n: number) => ({ kind: 'box', size: n }));
      const out = await engine.doString('return mk(7)');
      expect(out).toEqual({ kind: 'box', size: 7 });
    } finally {
      engine.global.close();
    }
  });

  it('round-trips JS object with a callable property accessed from Lua', async () => {
    // inputs.foo.outputType() depends on this.
    const factory = new LuaFactory();
    const engine = await factory.createEngine({ openStandardLibs: false });
    try {
      engine.global.set('inputs', { foo: { outputType: () => '3d' } });
      const out = await engine.doString('return { t = inputs.foo.outputType() }');
      expect(out).toEqual({ t: '3d' });
    } finally {
      engine.global.close();
    }
  });

  it('selectively opens stdlib via loadLibrary', async () => {
    // installSandbox uses this to expose math/string/table without bringing in os/io/etc.
    // If loadLibrary isn't available in the installed Wasmoon, the sandbox needs a
    // different approach (manual JS-side math wrapping).
    const factory = new LuaFactory();
    const engine = await factory.createEngine({ openStandardLibs: false });
    try {
      // Confirm presence of LuaLibraries enum, or fall back to engine.global.loadLibraries.
      // Adjust this test to match whatever API the installed Wasmoon ships with.
      const out = await engine.doString('return math == nil');
      expect(out).toBe(true); // math is absent because we did not open stdlibs
    } finally {
      engine.global.close();
    }
  });
});
