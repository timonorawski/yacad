import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MemoryStore } from '@yacad/cache';
import { buildGraph, registerNodeType, unregisterNodeType } from '@yacad/dag';
import { Engine, type EvaluateResult } from '@yacad/engine';
import { meshToBinaryStl } from '@yacad/export-stl';
import { computeBBox, triangleCount, vertexCount, type Mesh } from '@yacad/geometry';
import { defaultHasher } from '@yacad/hash';
import { loadManifold, ManifoldKernel } from '@yacad/kernel-manifold';
import {
  hashLuaDefinition,
  makeLuaNodeType,
  WasmoonLuaRuntime,
  type LuaDefinition,
  type LuaDefinitionResolver,
} from '@yacad/lua';

export interface Scene {
  /** Path relative to scenes/, e.g. "booleans/box-minus-sphere". */
  readonly name: string;
  readonly doc: unknown;
}

const SCENES_DIR = fileURLToPath(new URL('../scenes', import.meta.url));

/** Discover every scene document under scenes/ (recursively), sorted by name. */
export function loadScenes(): Scene[] {
  return readdirSync(SCENES_DIR, { recursive: true })
    .map(String)
    .filter((rel) => rel.endsWith('.json'))
    .sort()
    .map((rel) => ({
      name: rel.replace(/\\/g, '/').replace(/\.json$/, ''),
      doc: JSON.parse(readFileSync(`${SCENES_DIR}/${rel}`, 'utf8')) as unknown,
    }));
}

// The WASM kernel is expensive to instantiate; share one across all scenes
// (and across the torture suite, which evaluates many graphs).
let kernelPromise: Promise<ManifoldKernel> | undefined;
export function getKernel(): Promise<ManifoldKernel> {
  return (kernelPromise ??= loadManifold().then((api) => new ManifoldKernel(api)));
}

// Singleton WasmoonLuaRuntime shared across all scenes in a process.
// LuaNode type registration must happen exactly once — re-registering 'lua'
// throws "already registered". We manage it with a module-level flag.
let luaRuntime: WasmoonLuaRuntime | undefined;

/**
 * Detect whether a scene document is a wrapped scene (has top-level
 * `definitions` and `doc` keys rather than being a bare NodeDoc).
 */
function isWrappedScene(
  doc: unknown,
): doc is { definitions: Record<string, LuaDefinition>; doc: unknown } {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return false;
  const d = doc as Record<string, unknown>;
  return 'definitions' in d && 'doc' in d;
}

/**
 * Recursively walk a JSON tree, substituting any string value that matches a
 * sentinel key (e.g. `"@gear"`) with its replacement string (the computed hash).
 * Non-matching strings and all non-string values are left unchanged.
 */
function substituteSentinels(value: unknown, sentinelMap: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return sentinelMap.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteSentinels(item, sentinelMap));
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = substituteSentinels(v, sentinelMap);
    }
    return result;
  }
  return value;
}

export interface SceneRun {
  readonly result: EvaluateResult;
  readonly mesh: Mesh;
  readonly stl: Uint8Array<ArrayBuffer>;
}

/**
 * Run one scene end-to-end. Each run gets a fresh cache so per-scene stats are
 * isolated and order-independent (the kernel/WASM is reused).
 *
 * Wrapped scenes (`{ definitions, doc }`) are handled by:
 *   1. Hashing each definition value.
 *   2. Building a sentinel→hash substitution map.
 *   3. Walking the `doc` tree and replacing sentinel strings with real hashes.
 *   4. Constructing a resolver and (re-)registering the LuaNode type.
 *   5. Evaluating with an Engine that carries the resolver.
 *
 * Plain scenes (existing corpus) pass through unchanged.
 */
export async function runScene(doc: unknown): Promise<SceneRun> {
  const kernel = await getKernel();

  if (isWrappedScene(doc)) {
    // --- Wrapped scene: sentinel-substitution + LuaNode registration ---

    // 1. Hash each definition and build sentinel→hash map.
    const sentinelMap = new Map<string, string>();
    const defMap = new Map<string, LuaDefinition>();
    for (const [sentinel, def] of Object.entries(doc.definitions)) {
      const hash = await hashLuaDefinition(def, defaultHasher);
      sentinelMap.set(sentinel, hash);
      defMap.set(hash, def);
    }

    // 2. Substitute sentinels in the unwrapped doc tree.
    const unwrapped = substituteSentinels(doc.doc, sentinelMap);

    // 3. Build resolver from hash→definition map.
    const resolver: LuaDefinitionResolver = { get: (h) => defMap.get(h) };

    // 4. Register LuaNode type exactly once per process (re-use singleton runtime).
    //    Unregister first so successive runScene calls within the same suite
    //    don't hit "already registered". The singleton runtime is never disposed
    //    because the WASM state is reused across calls.
    if (!luaRuntime) {
      luaRuntime = new WasmoonLuaRuntime();
    }
    unregisterNodeType('lua');
    registerNodeType(makeLuaNodeType(luaRuntime, resolver));

    // 5. Evaluate with a resolver-aware Engine.
    const engine = new Engine(new MemoryStore(), kernel, { resolver });
    const result = await engine.evaluate(
      await buildGraph(unwrapped, undefined, undefined, resolver),
    );
    return { result, mesh: result.mesh, stl: meshToBinaryStl(result.mesh) };
  }

  // --- Plain scene: existing behavior unchanged ---
  const engine = new Engine(new MemoryStore(), kernel);
  const result = await engine.evaluate(await buildGraph(doc));
  return { result, mesh: result.mesh, stl: meshToBinaryStl(result.mesh) };
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Stable, captureable geometry summary — the golden record for a scene. */
export function summarize({ result, mesh, stl }: SceneRun): Record<string, unknown> {
  const bbox = computeBBox(mesh);
  return {
    nodes: result.stats.nodes,
    triangles: triangleCount(mesh),
    vertices: vertexCount(mesh),
    bbox: bbox && { min: bbox.min.map(round), max: bbox.max.map(round) },
    stlBytes: stl.byteLength,
  };
}
