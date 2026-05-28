import type { EvalStats, NodeEval } from '@yacad/engine';
import type { Geometry } from '@yacad/geometry';
import type { LuaDefinition } from '@yacad/lua';

/**
 * One-shot initialization carrying the `manifold.wasm` URL, which the main
 * thread resolves (bundlers resolve package asset URLs there, not in the worker
 * sub-bundle) and forwards to the kernel loader.
 *
 * `luaWasmUrl`, if provided, is stashed and used to instantiate WasmoonLuaRuntime.
 * Actual Wasmoon loading is deferred until the first Lua-node evaluation.
 */
export interface InitRequest {
  readonly kind: 'init';
  readonly wasmUrl: string;
  readonly luaWasmUrl?: string;
}

/** Request to evaluate a document (raw parsed JSON) to its root mesh. */
export interface EvaluateRequest {
  readonly id: number;
  readonly kind: 'evaluate';
  readonly doc: unknown;
  readonly tier: string;
}

/**
 * Store a Lua definition in the worker's in-memory definition map.
 * The worker echoes `{ id, kind: 'ok' }` on success.
 */
export interface PutLuaDefinitionRequest {
  readonly id: number;
  readonly kind: 'putLuaDefinition';
  readonly hash: string;
  readonly definition: LuaDefinition;
}

/**
 * Check whether a Lua definition is present in the worker's in-memory map.
 * The worker echoes `{ id, kind: 'ok', present: boolean }`.
 */
export interface HasLuaDefinitionRequest {
  readonly id: number;
  readonly kind: 'hasLuaDefinition';
  readonly hash: string;
}

/**
 * Store a mesh blob (binary STL / 3MF / glTF / …) in the worker's blob map.
 * The DAG references it by `params.blobHash` on an import-* node; decoders
 * read the bytes back through the resolver at evaluation time.
 */
export interface PutMeshBlobRequest {
  readonly id: number;
  readonly kind: 'putMeshBlob';
  readonly hash: string;
  readonly bytes: Uint8Array;
}

/** Check whether a mesh blob is registered under the given hash. */
export interface HasMeshBlobRequest {
  readonly id: number;
  readonly kind: 'hasMeshBlob';
  readonly hash: string;
}

export type WorkerRequest =
  | InitRequest
  | EvaluateRequest
  | PutLuaDefinitionRequest
  | HasLuaDefinitionRequest
  | PutMeshBlobRequest
  | HasMeshBlobRequest;

export interface EvaluateOk {
  readonly id: number;
  readonly kind: 'result';
  readonly ok: true;
  readonly geometry: Geometry;
  readonly hash: string;
  readonly stats: EvalStats;
  readonly perNode: readonly NodeEval[];
  readonly perf: {
    readonly workerTotalMs: number;
    readonly buildGraphMs: number;
    readonly engineMs: number;
    readonly copyMeshMs: number;
    /**
     * Absolute timestamps `performance.timeOrigin + performance.now()` so the
     * main thread can compute postMessage transport latency in both directions
     * (worker and main contexts have different `performance.timeOrigin`s, but
     * the sum is comparable wall-clock-ms-since-epoch on both sides).
     */
    readonly workerStartAbs: number;
    readonly workerPostAbs: number;
  };
}

export interface EvaluateErr {
  readonly id: number;
  readonly kind: 'result';
  readonly ok: false;
  readonly error: string;
}

/**
 * Generic acknowledgement for `putLuaDefinition` and `hasLuaDefinition`.
 * `present` is only set on `hasLuaDefinition` responses.
 */
export interface OkResponse {
  readonly id: number;
  readonly kind: 'ok';
  readonly present?: boolean;
}

export type WorkerResponse = EvaluateOk | EvaluateErr | OkResponse;
