import { LuaFactory, LuaLibraries, type LuaEngine } from 'wasmoon';
import type { NodeDoc } from '@yacad/dag';
import { canonicalize } from '@yacad/canonical';
import { buildGeoApi } from './geo';
import { LuaError, type InputRef, type LuaRuntime } from './runtime';
import type { LuaDefinition } from './schema';

export interface WasmoonLuaRuntimeOptions {
  /** Custom WASM URL (worker / browser environments). Omit in Node. */
  readonly wasmUrl?: string;
}

export class WasmoonLuaRuntime implements LuaRuntime {
  private readonly factory: LuaFactory;
  private readonly geoApi: ReturnType<typeof buildGeoApi>;

  constructor(opts: WasmoonLuaRuntimeOptions = {}) {
    this.factory = opts.wasmUrl ? new LuaFactory(opts.wasmUrl) : new LuaFactory();
    this.geoApi = buildGeoApi();
  }

  async evaluate(
    def: LuaDefinition,
    inputs: readonly InputRef[],
    values: Record<string, unknown>,
  ): Promise<NodeDoc> {
    // Per-call fresh state — see spec §Worker integration.
    const engine = await this.factory.createEngine({
      // Open NO standard libraries; we populate _G manually.
      openStandardLibs: false,
    });
    try {
      await installSandbox(engine, def, inputs, values, this.geoApi);
      let result: unknown;
      try {
        result = await engine.doString(def.code);
      } catch (err) {
        throw mapLuaError(err);
      }
      const doc = unwrapNodeDoc(result);
      return doc;
    } finally {
      engine.global.close();
    }
  }

  dispose(): void {
    // LuaFactory has no explicit disposal in Wasmoon's current API; engines
    // are disposed per-call. This method exists for future runtimes that
    // hold long-lived state.
  }
}

async function installSandbox(
  engine: LuaEngine,
  def: LuaDefinition,
  inputs: readonly InputRef[],
  values: Record<string, unknown>,
  geoApi: ReturnType<typeof buildGeoApi>,
): Promise<void> {
  // 1. Selectively open only the pure stdlib chunks we want:
  //    - Base: provides pairs, ipairs, pcall, error, tostring, tonumber, select, type, etc.
  //      We then strip dangerous base entries below.
  //    - Math, String, Table: pure computation; no I/O or system access.
  //    With openStandardLibs: false, os/io/package/coroutine/debug are never loaded.
  await engine.global.loadLibrary(LuaLibraries.Base);
  await engine.global.loadLibrary(LuaLibraries.Math);
  await engine.global.loadLibrary(LuaLibraries.String);
  await engine.global.loadLibrary(LuaLibraries.Table);

  // 2. Seed math.random BEFORE stripping randomseed (ordering matters — the old
  //    plan had a bug here where randomseed was cleared before being called).
  //    Lua 5.4 math.randomseed expects signed int64 values. seedBitsFrom returns
  //    sign-extended BigInt so Lua can accept them as integers (not floats).
  const seedLo = seedBitsFrom(def, values, 0);
  const seedHi = seedBitsFrom(def, values, 1);
  await engine.doString(`math.randomseed(${seedLo.toString()}, ${seedHi.toString()})`);

  // 3. Strip impure / unwanted entries AFTER seeding.
  //    Base library brings in load/loadfile/dofile/require/print which can escape the sandbox.
  //    We remove them explicitly here.
  await engine.doString(`
    math.randomseed = nil
    string.dump = nil
    dofile = nil
    loadfile = nil
    load = nil
    loadstring = nil
    require = nil
    print = nil
    collectgarbage = nil
  `);

  // 4. Install our APIs.
  engine.global.set('geo', geoApi);
  engine.global.set('params', values);
  engine.global.set('inputs', inputsTable(inputs));
}

/** Materialize a Lua-friendly inputs table keyed by name with outputType()
 *  available synchronously. */
function inputsTable(inputs: readonly InputRef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const inp of inputs) {
    out[inp.name] = { type: inp.type, outputType: () => inp.outputType() };
  }
  return out;
}

function seedBitsFrom(def: LuaDefinition, values: Record<string, unknown>, half: 0 | 1): bigint {
  // Deterministic 64-bit half derived from canonical(def) + canonical(values).
  // Two halves give a 128-bit total seed for math.randomseed(lo, hi). FNV-1a is
  // the cheap-and-stable choice; `half` picks alternate byte strides so the
  // two halves diverge.
  //
  // Lua 5.4 math.randomseed expects signed 64-bit integers (lua_Integer). If the
  // FNV-1a result has the high bit set, Lua sees it as a float with no integer
  // representation. Sign-extend: values > 2^63-1 become negative signed int64.
  const enc = new TextEncoder();
  const bytes = enc.encode(canonicalize(def) + ' ' + canonicalize(values));
  const offsetBasis = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const signBit = 0x8000000000000000n;
  const modulus = 0x10000000000000000n;
  let h = offsetBasis;
  for (let i = half; i < bytes.length; i += 2) {
    h ^= BigInt(bytes[i]!);
    h = (h * prime) & mask;
  }
  // Convert unsigned uint64 → signed int64 so Lua accepts it as an integer.
  return (h & signBit) !== 0n ? h - modulus : h;
}

function mapLuaError(err: unknown): LuaError {
  const message = err instanceof Error ? err.message : String(err);
  // Wasmoon's error message typically looks like "[string \"...\"]:<line>: <msg>"
  const lineMatch = message.match(/]:(\d+):/);
  const line = lineMatch ? Number(lineMatch[1]) : undefined;
  const phase: 'compile' | 'runtime' = /unexpected symbol|syntax/i.test(message)
    ? 'compile'
    : 'runtime';
  return new LuaError(message, line !== undefined ? { phase, line } : { phase });
}

function unwrapNodeDoc(value: unknown): NodeDoc {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LuaError(
      `Lua returned ${value === null ? 'nil' : typeof value}, expected a NodeDoc`,
      { phase: 'output' },
    );
  }
  const v = value as Record<string, unknown>;
  if (typeof v['type'] !== 'string') {
    throw new LuaError('returned table missing "type" string', { phase: 'output' });
  }
  return value as NodeDoc;
}
