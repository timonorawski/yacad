import { LuaLibraries, type LuaEngine } from 'wasmoon';

/**
 * RNG policy for the sandbox.
 *
 * - `disabled`: `math.random` AND `math.randomseed` are stripped. The warp
 *   evaluator uses this — per-vertex randomness would silently break the cache
 *   under future LOD/preview tiers and parallel evaluation (CLAUDE.md #2).
 * - `seeded`: `math.random` survives but is reseeded from caller-supplied
 *   `seedLo`/`seedHi` (signed int64s, the shape Lua 5.4 `math.randomseed`
 *   expects). LuaNode uses this — authors can sample random distributions in
 *   DAG generation as long as the seed itself is a deterministic function of
 *   the definition + values. `math.randomseed` is stripped after seeding.
 */
export type LuaRandomPolicy =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'seeded'; readonly seedLo: bigint; readonly seedHi: bigint };

export interface LuaSandboxOptions {
  readonly random: LuaRandomPolicy;
  /** Globals installed on `_G` after the sandbox is set up. */
  readonly globals?: Readonly<Record<string, unknown>>;
}

/**
 * Single source of truth for the Lua sandbox. Every Wasmoon engine in the
 * yacad system goes through this installer so the determinism + sandbox
 * guarantees (CLAUDE.md #2) hold uniformly across LuaNode and warp.
 *
 * The caller is responsible for creating the engine with `openStandardLibs:
 * false` — that's where `os`/`io`/`package`/`coroutine`/`debug` are kept out.
 * This function then selectively opens only the pure stdlib chunks (Base,
 * Math, String, Table) and strips dangerous entries from each.
 */
export async function installLuaSandbox(
  engine: LuaEngine,
  options: LuaSandboxOptions,
): Promise<void> {
  // 1. Pure-only stdlib chunks. Base brings pcall/error/type/tostring/
  //    tonumber/select/pairs/ipairs; its dangerous entries get stripped below.
  await engine.global.loadLibrary(LuaLibraries.Base);
  await engine.global.loadLibrary(LuaLibraries.Math);
  await engine.global.loadLibrary(LuaLibraries.String);
  await engine.global.loadLibrary(LuaLibraries.Table);

  // 2. RNG policy. Seed BEFORE stripping randomseed — clearing it first would
  //    leave math.random in its uninitialised default state. For `disabled`
  //    we just go straight to the strip step.
  if (options.random.mode === 'seeded') {
    await engine.doString(
      `math.randomseed(${options.random.seedLo.toString()}, ${options.random.seedHi.toString()})`,
    );
  }

  // 3. Strip impure / source-loading entries. math.random is removed only in
  //    'disabled' mode; math.randomseed is always removed (so user code can't
  //    re-seed and defeat determinism).
  const stripRandom = options.random.mode === 'disabled';
  await engine.doString(`
    math.randomseed = nil
    ${stripRandom ? 'math.random = nil' : ''}
    string.dump = nil
    dofile = nil
    loadfile = nil
    load = nil
    loadstring = nil
    require = nil
    print = nil
    collectgarbage = nil
  `);

  // 4. Install caller-supplied globals.
  if (options.globals) {
    for (const [name, value] of Object.entries(options.globals)) {
      engine.global.set(name, value);
    }
  }
}
