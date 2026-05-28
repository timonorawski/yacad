/**
 * Performance guard tests — catch gross regressions on CI.
 *
 * Thresholds are intentionally generous: they use wall-clock `Date.now()` and
 * are calibrated to pass comfortably on a shared GitHub Actions runner (which
 * can be 4–10× slower than a developer laptop). The goal is to catch a 10–50×
 * regression, not a 2× one.
 *
 * Each threshold is justified inline.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalize, canonicalBytes } from '@yacad/canonical';
import { defaultHasher, hashCanonical } from '@yacad/hash';
import { buildGraph, registerNodeType, unregisterNodeType } from '@yacad/dag';
import { MemoryStore } from '@yacad/cache';
import { ManifoldKernel, loadManifold } from '@yacad/kernel-manifold';
import { Engine } from '@yacad/engine';
import { hashLuaDefinition, makeLuaNodeType, WasmoonLuaRuntime } from '@yacad/lua';
import { GEAR_DEFINITION } from '@yacad/e2e/fixtures';

let kernel: ManifoldKernel;

beforeAll(async () => {
  kernel = new ManifoldKernel(await loadManifold());
}, 60_000); // WASM load can take a while on a cold CI runner

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function measureMs(fn: () => void, iterations = 1000): number {
  const start = Date.now();
  for (let i = 0; i < iterations; i++) fn();
  return (Date.now() - start) / iterations;
}

async function measureMsAsync(fn: () => Promise<void>, iterations = 200): Promise<number> {
  const start = Date.now();
  for (let i = 0; i < iterations; i++) await fn();
  return (Date.now() - start) / iterations;
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

describe('canonicalize performance guards', () => {
  const params = { size: [10, 10, 10], center: true };

  it('canonicalize of a typical params object is under 1 ms on average', () => {
    // Fast synchronous path — should be well under 0.1 ms even on CI.
    // 1 ms gives a 10–20× regression margin.
    const ms = measureMs(() => canonicalize(params));
    expect(ms).toBeLessThan(1);
  });

  it('canonicalBytes of a typical params object is under 2 ms on average', () => {
    // Adds TextEncoder cost — still synchronous. 2 ms is a generous bound.
    const ms = measureMs(() => canonicalBytes(params));
    expect(ms).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

describe('hashCanonical performance guards', () => {
  const params = { size: [10, 10, 10], center: true };

  it('hashCanonical of a typical params object is under 5 ms on average', async () => {
    // SubtleCrypto SHA-256 is fast but async; 5 ms allows for scheduler overhead
    // and slow CI runners. Normal value should be ~0.1–0.5 ms.
    const ms = await measureMsAsync(() => hashCanonical(params));
    expect(ms).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
// DAG building
// ---------------------------------------------------------------------------

describe('buildGraph performance guards', () => {
  const threeNodeDoc = {
    type: 'union',
    children: [
      { type: 'box', params: { size: [10, 10, 10], center: true } },
      { type: 'sphere', params: { radius: 5 } },
    ],
  };

  it('buildGraph of a 3-node DAG is under 20 ms on average', async () => {
    // Each node requires one SHA-256 hash (async). 3 sequential hashes ≈ 1–3 ms
    // typically. 20 ms allows for slow CI without hiding real regressions.
    const ms = await measureMsAsync(() => buildGraph(threeNodeDoc));
    expect(ms).toBeLessThan(20);
  });
});

// ---------------------------------------------------------------------------
// Engine — the core architectural bet
// ---------------------------------------------------------------------------

describe('Engine.evaluate performance guards', () => {
  const doc = {
    type: 'difference',
    children: [
      { type: 'box', params: { size: [30, 30, 30], center: true } },
      { type: 'sphere', params: { radius: 19, segments: 48 } },
    ],
  };

  it('cold Engine.evaluate completes within 5000 ms', async () => {
    // Cold path runs the WASM kernel. The difference with a 48-segment sphere
    // is non-trivial geometry. 5 000 ms is very generous — expected ~100–500 ms
    // on CI. If this fails, something is deeply wrong (WASM not loading, etc.).
    const graph = await buildGraph(doc);
    const start = Date.now();
    await new Engine(new MemoryStore(), kernel).evaluate(graph);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it('warm Engine.evaluate (root cache hit) completes within 100 ms', async () => {
    // The architectural bet: warm re-eval must be fast (vision: sub-100 ms).
    // Here we measure a single wall-clock call (not averaged) and use the full
    // 100 ms budget. Normal warm cost is <5 ms on any modern machine.
    // This is the primary regression guard for the incremental-recompute claim.
    const graph = await buildGraph(doc);
    const store = new MemoryStore();
    const engine = new Engine(store, kernel);
    await engine.evaluate(graph); // populate cache

    const start = Date.now();
    const result = await engine.evaluate(graph); // warm
    const elapsed = Date.now() - start;

    expect(result.stats.hits).toBe(1);
    expect(result.stats.misses).toBe(0);
    expect(result.geometry.kind).toBe('3d');
    if (result.geometry.kind === '3d') {
      expect(result.geometry.mesh.indices.length).toBeGreaterThan(0);
    }
    expect(elapsed).toBeLessThan(100);
  });

  it('partial-invalidation re-eval completes within 3000 ms', async () => {
    // After editing one node, the engine recomputes only the changed subtree.
    // The sibling (box) hits cache; the edited sphere and ancestor (diff) recompute.
    // 3 000 ms covers the two kernel calls plus hashing on CI.
    const store = new MemoryStore();
    const engine = new Engine(store, kernel);
    await engine.evaluate(await buildGraph(doc));

    // Edit: different sphere radius → only sphere + difference recompute.
    const editedDoc = {
      ...doc,
      children: [doc.children[0], { type: 'sphere', params: { radius: 15, segments: 48 } }],
    };
    const start = Date.now();
    const result = await engine.evaluate(await buildGraph(editedDoc));
    expect(Date.now() - start).toBeLessThan(3000);

    // Validate the cache-hit pattern: box is a hit, sphere+diff are misses.
    expect(result.stats.hits).toBe(1);
    expect(result.stats.misses).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// LuaNode evaluation — cold/warm perf guards
// ---------------------------------------------------------------------------

describe('LuaNode Engine.evaluate performance guards', () => {
  let luaKernel: ManifoldKernel;
  let luaHash: string;
  let luaResolver: { get: (h: string) => typeof GEAR_DEFINITION | undefined };

  beforeAll(async () => {
    luaKernel = new ManifoldKernel(await loadManifold());
    luaHash = await hashLuaDefinition(GEAR_DEFINITION, defaultHasher);
    luaResolver = { get: (h) => (h === luaHash ? GEAR_DEFINITION : undefined) };
    const runtime = new WasmoonLuaRuntime();
    try {
      unregisterNodeType('lua');
    } catch {
      // Not registered yet — fine.
    }
    registerNodeType(makeLuaNodeType(runtime, luaResolver));
  }, 120_000);

  afterAll(() => {
    try {
      unregisterNodeType('lua');
    } catch {
      // Already unregistered — fine.
    }
  });

  it('cold Lua evaluate completes within 500 ms', async () => {
    // Cold path: fresh store, Lua code runs, Manifold kernel evaluates.
    // Observed on M-series Mac (warm WASM): ~20 ms single-shot.
    // 500 ms ≈ 1.5× expected CI upper bound (~333 ms on a shared runner at
    // 4–10× slowdown). Still catches a 25× regression vs. the ~20 ms baseline.
    const graph = await buildGraph({
      type: 'lua',
      params: { definitionHash: luaHash, values: { teeth: 8 } },
    });
    const start = Date.now();
    await new Engine(new MemoryStore(), luaKernel, { resolver: luaResolver }).evaluate(graph);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('warm Lua evaluate (outer cache hit) completes within 20 ms', async () => {
    // Warm path: root mesh already cached; one lookup, no Lua or kernel call.
    // Observed on M-series Mac: ~6 ms single-shot (Date.now() 1 ms resolution).
    // 20 ms ≈ 1.5× expected CI upper bound (~13 ms on a shared runner).
    // Normal warm cost is <1 ms on any modern machine — this catches a 20×
    // regression and validates the incremental-recompute architectural bet.
    const graph = await buildGraph({
      type: 'lua',
      params: { definitionHash: luaHash, values: { teeth: 8 } },
    });
    const store = new MemoryStore();
    const engine = new Engine(store, luaKernel, { resolver: luaResolver });
    await engine.evaluate(graph); // populate cache

    const start = Date.now();
    const result = await engine.evaluate(graph); // warm
    const elapsed = Date.now() - start;

    expect(result.stats.hits).toBe(1);
    expect(result.stats.misses).toBe(0);
    expect(elapsed).toBeLessThan(20);
  });
});

// ---------------------------------------------------------------------------
// 2D evaluation — cold/warm perf guards
// ---------------------------------------------------------------------------

describe('Engine.evaluate 2D performance guards', () => {
  it('cold 2D evaluate completes within 1500 ms', async () => {
    const kernel2d = new ManifoldKernel(await loadManifold());
    const graph = await buildGraph({
      type: 'extrude',
      params: { height: 10 },
      children: [
        {
          type: 'spline',
          params: {
            points: Array.from({ length: 8 }, (_, i) => {
              const a = (i / 8) * 2 * Math.PI;
              return [10 * Math.cos(a), 10 * Math.sin(a)] as [number, number];
            }),
            segmentsPerCurve: 8,
          },
        },
      ],
    });
    const t0 = Date.now();
    await new Engine(new MemoryStore(), kernel2d).evaluate(graph);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('warm 2D evaluate completes within 100 ms', async () => {
    const kernel2d = new ManifoldKernel(await loadManifold());
    const graph = await buildGraph({
      type: 'extrude',
      params: { height: 10 },
      children: [{ type: 'circle', params: { radius: 10 } }],
    });
    const store = new MemoryStore();
    await new Engine(store, kernel2d).evaluate(graph);
    const t0 = Date.now();
    await new Engine(store, kernel2d).evaluate(graph);
    expect(Date.now() - t0).toBeLessThan(100);
  });
});
