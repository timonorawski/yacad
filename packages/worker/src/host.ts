import { IndexedDbStore, MemoryStore, TieredStore } from '@yacad/cache';
import { buildGraph, getNodeType, registerNodeType, type DefinitionResolver } from '@yacad/dag';
import { Engine } from '@yacad/engine';
import { type Geometry } from '@yacad/geometry';
import { IMPORT_GLTF_NODE_TYPE, IMPORT_GLTF_TYPE } from '@yacad/import-gltf';
import { IMPORT_OBJ_NODE_TYPE, IMPORT_OBJ_TYPE } from '@yacad/import-obj';
import { IMPORT_STL_NODE_TYPE, IMPORT_STL_TYPE } from '@yacad/import-stl';
import { ManifoldKernel, loadManifold } from '@yacad/kernel-manifold';
import {
  makeLuaNodeType,
  WasmoonLuaRuntime,
  type LuaDefinition,
  type LuaDefinitionResolver,
} from '@yacad/lua';
import type {
  ClearCacheRequest,
  EvaluateRequest,
  HasLuaDefinitionRequest,
  HasMeshBlobRequest,
  OkResponse,
  PutLuaDefinitionRequest,
  PutMeshBlobRequest,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

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
 *
 * Lua state (definition map, runtime, resolver) lives inside this closure so
 * multiple test instances can co-exist without shared mutable module state.
 */
export function startHost(scope: WorkerScope): void {
  // ---------------------------------------------------------------------------
  // Lua state — scoped to this host instance so tests are isolated.
  // The resolver is created once and passed to both the node-type registration
  // and the Engine constructor so both see the same live Map.
  // ---------------------------------------------------------------------------
  const luaDefs = new Map<string, LuaDefinition>();
  const luaResolver: LuaDefinitionResolver = { get: (h) => luaDefs.get(h) };
  let luaRegistered = false;

  function ensureLuaRegistered(runtime: WasmoonLuaRuntime): void {
    if (luaRegistered) return;
    registerNodeType(makeLuaNodeType(runtime, luaResolver));
    luaRegistered = true;
  }

  // Mesh-blob state — content-addressable bytes for binary mesh imports
  // (STL, OBJ, glTF; 3MF later). The engine sees one composite resolver that
  // consults both maps; consumers narrow on retrieval.
  const meshBlobs = new Map<string, Uint8Array>();
  const combinedResolver: DefinitionResolver = {
    get: (h) => luaDefs.get(h) ?? meshBlobs.get(h),
  };

  // Decoder node types are static — register once per process, idempotently
  // (the registry is global, so guard with getNodeType to survive multiple
  // host instances in the same module).
  if (!getNodeType(IMPORT_STL_TYPE)) registerNodeType(IMPORT_STL_NODE_TYPE);
  if (!getNodeType(IMPORT_OBJ_TYPE)) registerNodeType(IMPORT_OBJ_NODE_TYPE);
  if (!getNodeType(IMPORT_GLTF_TYPE)) registerNodeType(IMPORT_GLTF_NODE_TYPE);

  let backend: Promise<Backend> | undefined;

  scope.onmessage = (event) => {
    const req = event.data as WorkerRequest;
    if (!req) return;

    if (req.kind === 'init') {
      // Stash the Lua WASM URL and instantiate the runtime — WasmoonLuaRuntime
      // defers actual Wasmoon loading until the first createEngine() call
      // (LuaFactory is lazy internally). Register the node type once.
      if (req.luaWasmUrl) {
        const luaRuntime = new WasmoonLuaRuntime({ wasmUrl: req.luaWasmUrl });
        ensureLuaRegistered(luaRuntime);
      }
      backend = createEngine(() => req.wasmUrl, combinedResolver);
      return;
    }

    if (req.kind === 'putLuaDefinition') {
      handlePutLuaDefinition(scope, luaDefs, req);
      return;
    }

    if (req.kind === 'hasLuaDefinition') {
      handleHasLuaDefinition(scope, luaDefs, req);
      return;
    }

    if (req.kind === 'putMeshBlob') {
      handlePutMeshBlob(scope, meshBlobs, req);
      return;
    }

    if (req.kind === 'hasMeshBlob') {
      handleHasMeshBlob(scope, meshBlobs, req);
      return;
    }

    if (req.kind === 'clearCache') {
      void handleClearCache(scope, backend, req);
      return;
    }

    if (req.kind === 'evaluate') {
      backend ??= createEngine(undefined, combinedResolver);
      void handle(scope, backend, req);
    }
  };
}

async function handleClearCache(
  scope: WorkerScope,
  backend: Promise<Backend> | undefined,
  req: ClearCacheRequest,
): Promise<void> {
  // If the engine hasn't been created yet there's nothing to clear; reply OK
  // so the main thread doesn't hang.
  if (backend) {
    try {
      const { store } = await backend;
      await store.clear();
    } catch (err) {
      console.error('clearCache failed', err);
    }
  }
  const res: OkResponse = { id: req.id, kind: 'ok' };
  scope.postMessage(res);
}

interface Backend {
  readonly engine: Engine;
  readonly store: TieredStore;
}

async function createEngine(
  locateFile: (() => string) | undefined,
  resolver: DefinitionResolver,
): Promise<Backend> {
  const toplevel = await loadManifold(locateFile ? { locateFile } : {});
  const store = new TieredStore(new MemoryStore(), new IndexedDbStore());
  return {
    engine: new Engine(store, new ManifoldKernel(toplevel), { resolver }),
    store,
  };
}

function handlePutLuaDefinition(
  scope: WorkerScope,
  luaDefs: Map<string, LuaDefinition>,
  req: PutLuaDefinitionRequest,
): void {
  luaDefs.set(req.hash, req.definition);
  const res: OkResponse = { id: req.id, kind: 'ok' };
  scope.postMessage(res);
}

function handleHasLuaDefinition(
  scope: WorkerScope,
  luaDefs: Map<string, LuaDefinition>,
  req: HasLuaDefinitionRequest,
): void {
  const res: OkResponse = { id: req.id, kind: 'ok', present: luaDefs.has(req.hash) };
  scope.postMessage(res);
}

function handlePutMeshBlob(
  scope: WorkerScope,
  meshBlobs: Map<string, Uint8Array>,
  req: PutMeshBlobRequest,
): void {
  meshBlobs.set(req.hash, req.bytes);
  const res: OkResponse = { id: req.id, kind: 'ok' };
  scope.postMessage(res);
}

function handleHasMeshBlob(
  scope: WorkerScope,
  meshBlobs: Map<string, Uint8Array>,
  req: HasMeshBlobRequest,
): void {
  const res: OkResponse = { id: req.id, kind: 'ok', present: meshBlobs.has(req.hash) };
  scope.postMessage(res);
}

async function handle(
  scope: WorkerScope,
  backendPromise: Promise<Backend>,
  req: EvaluateRequest,
): Promise<void> {
  if (!req || req.kind !== 'evaluate') return;
  try {
    const workerStart = performance.now();
    // Absolute wall-clock at handler entry; the main thread compares it against
    // its own mainSentAbs to compute the main→worker postMessage latency.
    const workerStartAbs = performance.timeOrigin + workerStart;
    const { engine, store } = await backendPromise;

    const buildStart = performance.now();
    const root = await buildGraph(req.doc);
    const buildGraphMs = performance.now() - buildStart;

    const evalStart = performance.now();
    const result = await engine.evaluate(root, req.tier);
    const engineMs = performance.now() - evalStart;

    // Copy out of the cached geometry so transferring (neutering) the buffers
    // does not detach the artifact still held in L1.
    const copyStart = performance.now();
    let outGeometry: Geometry;
    if (result.geometry.kind === '3d') {
      outGeometry = {
        kind: '3d',
        mesh: {
          vertices: result.geometry.mesh.vertices.slice(),
          indices: result.geometry.mesh.indices.slice(),
        },
      };
    } else {
      // CrossSection is plain nested arrays — spread copy is sufficient.
      outGeometry = {
        kind: '2d',
        section: { polygons: result.geometry.section.polygons.map((p) => [...p]) },
      };
    }
    const copyMeshMs = performance.now() - copyStart;

    const workerEnd = performance.now();
    const workerTotalMs = workerEnd - workerStart;
    const workerPostAbs = performance.timeOrigin + workerEnd;
    const ok: WorkerResponse = {
      id: req.id,
      kind: 'result',
      ok: true,
      geometry: outGeometry,
      hash: result.hash,
      stats: result.stats,
      perNode: result.perNode,
      perf: {
        workerTotalMs,
        buildGraphMs,
        engineMs,
        copyMeshMs,
        workerStartAbs,
        workerPostAbs,
      },
    };
    const transferables: Transferable[] =
      outGeometry.kind === '3d'
        ? [outGeometry.mesh.vertices.buffer, outGeometry.mesh.indices.buffer]
        : [];
    scope.postMessage(ok, transferables);

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
