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
  let backend: Promise<Backend> | undefined;
  scope.onmessage = (event) => {
    const req = event.data as WorkerRequest;
    if (!req) return;
    if (req.kind === 'init') {
      backend = createEngine(() => req.wasmUrl);
      return;
    }
    if (req.kind === 'evaluate') {
      backend ??= createEngine();
      void handle(scope, backend, req);
    }
  };
}

interface Backend {
  readonly engine: Engine;
  readonly store: TieredStore;
}

async function createEngine(locateFile?: () => string): Promise<Backend> {
  const toplevel = await loadManifold(locateFile ? { locateFile } : {});
  const store = new TieredStore(new MemoryStore(), new IndexedDbStore());
  return { engine: new Engine(store, new ManifoldKernel(toplevel)), store };
}

async function handle(
  scope: WorkerScope,
  backendPromise: Promise<Backend>,
  req: EvaluateRequest,
): Promise<void> {
  if (!req || req.kind !== 'evaluate') return;
  try {
    const workerStart = performance.now();
    const { engine, store } = await backendPromise;

    const buildStart = performance.now();
    const root = await buildGraph(req.doc);
    const buildGraphMs = performance.now() - buildStart;

    const evalStart = performance.now();
    const result = await engine.evaluate(root, req.tier);
    const engineMs = performance.now() - evalStart;

    // Copy out of the cached mesh so transferring (neutering) the buffers does
    // not detach the artifact still held in L1.
    const copyStart = performance.now();
    const vertices = result.mesh.vertices.slice();
    const indices = result.mesh.indices.slice();
    const copyMeshMs = performance.now() - copyStart;

    const workerTotalMs = performance.now() - workerStart;
    const ok: WorkerResponse = {
      id: req.id,
      kind: 'result',
      ok: true,
      mesh: { vertices, indices },
      hash: result.hash,
      stats: result.stats,
      perNode: result.perNode,
      perf: { workerTotalMs, buildGraphMs, engineMs, copyMeshMs },
    };
    scope.postMessage(ok, [vertices.buffer, indices.buffer] as Transferable[]);

    // Persist artifacts to IndexedDB after the result is sent — write-behind,
    // off the response critical path.
    await store.flush();
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
