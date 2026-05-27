import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MemoryStore } from '@yacad/cache';
import { buildGraph } from '@yacad/dag';
import { Engine, type EvaluateResult } from '@yacad/engine';
import { meshToBinaryStl } from '@yacad/export-stl';
import { computeBBox, triangleCount, vertexCount, type Mesh } from '@yacad/geometry';
import { loadManifold, ManifoldKernel } from '@yacad/kernel-manifold';

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

export interface SceneRun {
  readonly result: EvaluateResult;
  readonly mesh: Mesh;
  readonly stl: Uint8Array<ArrayBuffer>;
}

/**
 * Run one scene end-to-end. Each run gets a fresh cache so per-scene stats are
 * isolated and order-independent (the kernel/WASM is reused).
 */
export async function runScene(doc: unknown): Promise<SceneRun> {
  const kernel = await getKernel();
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
