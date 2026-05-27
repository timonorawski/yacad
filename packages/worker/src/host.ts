import { IndexedDbStore, MemoryStore, TieredStore } from '@yacad/cache';
import { buildGraph } from '@yacad/dag';
import { Engine } from '@yacad/engine';
import { ManifoldKernel, loadManifold } from '@yacad/kernel-manifold';
import type { EvaluateRequest, WorkerRequest, WorkerResponse } from './protocol';

/** Minimal worker-scope surface — satisfied by DedicatedWorkerGlobalScope. */
export interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/**
 * Wire the evaluation backend into a worker scope: it owns the kernel, the
 * tiered cache (including the persistent IndexedDB tier), and the engine. The
 * main thread only ever sends documents and receives meshes — all geometry
 * compute stays off the UI thread.
 *
 * The engine is created lazily: an `init` message supplies the WASM URL in
 * bundled contexts; otherwise it falls back to Emscripten's default lookup
 * (which works under Node).
 */
export function startHost(scope: WorkerScope): void {
  let engine: Promise<Engine> | undefined;
  scope.onmessage = (event) => {
    const req = event.data as WorkerRequest;
    if (!req) return;
    if (req.kind === 'init') {
      engine = createEngine(() => req.wasmUrl);
      return;
    }
    if (req.kind === 'evaluate') {
      engine ??= createEngine();
      void handle(scope, engine, req);
    }
  };
}

async function createEngine(locateFile?: () => string): Promise<Engine> {
  const toplevel = await loadManifold(locateFile ? { locateFile } : {});
  const store = new TieredStore(new MemoryStore(), new IndexedDbStore());
  return new Engine(store, new ManifoldKernel(toplevel));
}

async function handle(
  scope: WorkerScope,
  enginePromise: Promise<Engine>,
  req: EvaluateRequest,
): Promise<void> {
  if (!req || req.kind !== 'evaluate') return;
  try {
    const engine = await enginePromise;
    const root = await buildGraph(req.doc);
    const result = await engine.evaluate(root, req.tier);

    // Copy out of the cached mesh so transferring (neutering) the buffers does
    // not detach the artifact still held in L1.
    const vertices = result.mesh.vertices.slice();
    const indices = result.mesh.indices.slice();
    const ok: WorkerResponse = {
      id: req.id,
      kind: 'result',
      ok: true,
      mesh: { vertices, indices },
      hash: result.hash,
      stats: result.stats,
      perNode: result.perNode,
    };
    scope.postMessage(ok, [vertices.buffer, indices.buffer] as Transferable[]);
  } catch (err) {
    const fail: WorkerResponse = {
      id: req.id,
      kind: 'result',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    scope.postMessage(fail);
  }
}
