import { LuaLibraries, type LuaEngine } from 'wasmoon';
import { SANDBOX_STRIP_SCRIPT } from './sandbox-globals';

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
 * The strip step delegates to `SANDBOX_STRIP_SCRIPT`, which is derived from the
 * `SANDBOX_GLOBALS` whitelist that the static validator also consumes — so the
 * runtime sandbox and the validator cannot drift. `SANDBOX_STRIP_SCRIPT` keeps
 * `math.random` (whitelisted) and nils `math.randomseed`; the random *policy*
 * here layers on top of that baseline.
 *
 * The caller is responsible for creating the engine with `openStandardLibs:
 * false` — that's where `os`/`io`/`package`/`coroutine`/`debug` are kept out.
 * This function then selectively opens only the pure stdlib chunks (Base,
 * Math, String, Table).
 */
export async function installLuaSandbox(
  engine: LuaEngine,
  options: LuaSandboxOptions,
): Promise<void> {
  // 1. Pure-only stdlib chunks. Base brings pcall/error/type/tostring/
  //    tonumber/select/pairs/ipairs; the strip script nils its dangerous entries.
  await engine.global.loadLibrary(LuaLibraries.Base);
  await engine.global.loadLibrary(LuaLibraries.Math);
  await engine.global.loadLibrary(LuaLibraries.String);
  await engine.global.loadLibrary(LuaLibraries.Table);

  // 2. RNG policy — seeded mode reseeds BEFORE the strip removes randomseed.
  //    (Stripping first would leave math.random uninitialised.)
  if (options.random.mode === 'seeded') {
    await engine.doString(
      `math.randomseed(${options.random.seedLo.toString()}, ${options.random.seedHi.toString()})`,
    );
  }

  // 3. Whitelist-derived strip (single source of truth shared with the
  //    validator). This nils math.randomseed, string.dump, load/loadfile/
  //    dofile/require/print/collectgarbage, etc., and keeps math.random.
  await engine.doString(SANDBOX_STRIP_SCRIPT);

  // 4. Disabled mode additionally removes math.random — the strip script keeps
  //    it (it's whitelisted for LuaNode), but warp requires per-vertex purity.
  if (options.random.mode === 'disabled') {
    await engine.doString('math.random = nil');
  }

  // 5. Install caller-supplied globals.
  if (options.globals) {
    for (const [name, value] of Object.entries(options.globals)) {
      engine.global.set(name, value);
    }
  }
}
