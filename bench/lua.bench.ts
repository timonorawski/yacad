/**
 * Benchmarks for LuaNode evaluation through @yacad/engine.
 *
 * Mirrors bench/engine.bench.ts but exercises the Lua expansion path:
 *   • cold: fresh MemoryStore, Lua code runs + Manifold kernel evaluates.
 *   • warm: store pre-populated with the root mesh; engine short-circuits in
 *           one lookup, never entering the Lua runtime or kernel.
 *
 * The GEAR_DEFINITION is imported from @yacad/e2e/fixtures (constraint 6 —
 * single canonical definition shared by perf bench and E2E scene).
 *
 * Engine construction uses the options-bag resolver (constraint 4) so
 * LuaNode.expand() can look up the definition by hash.
 *
 * WASM loaded ONCE at module scope — see kernel.bench.ts for rationale.
 */
import { beforeAll, bench, describe } from 'vitest';
import { MemoryStore } from '@yacad/cache';
import { buildGraph, registerNodeType, unregisterNodeType, type Node } from '@yacad/dag';
import { ManifoldKernel, loadManifold } from '@yacad/kernel-manifold';
import { Engine } from '@yacad/engine';
import { defaultHasher } from '@yacad/hash';
import { hashLuaDefinition, makeLuaNodeType, WasmoonLuaRuntime } from '@yacad/lua';
import { GEAR_DEFINITION } from '@yacad/e2e/fixtures';

let kernel: ManifoldKernel;
let graph: Node;
let warmStore: MemoryStore;

beforeAll(async () => {
  kernel = new ManifoldKernel(await loadManifold());

  const hash = await hashLuaDefinition(GEAR_DEFINITION, defaultHasher);
  const resolver = { get: (h: string) => (h === hash ? GEAR_DEFINITION : undefined) };
  const runtime = new WasmoonLuaRuntime();

  // Register LuaNode type; tolerate re-registration across bench runs.
  try {
    unregisterNodeType('lua');
  } catch {
    // Not registered yet — that's fine.
  }
  registerNodeType(makeLuaNodeType(runtime, resolver));

  graph = await buildGraph({
    type: 'lua',
    params: { definitionHash: hash, values: { teeth: 8 } },
  });

  // Warm up once so the warm bench never computes geometry.
  warmStore = new MemoryStore();
  await new Engine(warmStore, kernel, { resolver }).evaluate(graph);
}, 120_000); // WASM + first Lua evaluation can be slow on a cold CI runner

describe('Engine.evaluate (LuaNode)', () => {
  bench('cold — lua gear, fresh cache', async () => {
    // Each iteration needs its own store so there are no cross-iteration hits.
    const hash = await hashLuaDefinition(GEAR_DEFINITION, defaultHasher);
    const resolver = { get: (h: string) => (h === hash ? GEAR_DEFINITION : undefined) };
    await new Engine(new MemoryStore(), kernel, { resolver }).evaluate(graph);
  });

  bench('warm — lua gear, outer cache hit', async () => {
    // warmStore already has the root mesh; the engine returns it in one lookup.
    const hash = await hashLuaDefinition(GEAR_DEFINITION, defaultHasher);
    const resolver = { get: (h: string) => (h === hash ? GEAR_DEFINITION : undefined) };
    await new Engine(warmStore, kernel, { resolver }).evaluate(graph);
  });
});
