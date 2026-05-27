import type { EvalStats, NodeEval } from '@yacad/engine';
import type { Mesh } from '@yacad/geometry';

/**
 * One-shot initialization carrying the `manifold.wasm` URL, which the main
 * thread resolves (bundlers resolve package asset URLs there, not in the worker
 * sub-bundle) and forwards to the kernel loader.
 */
export interface InitRequest {
  readonly kind: 'init';
  readonly wasmUrl: string;
}

/** Request to evaluate a document (raw parsed JSON) to its root mesh. */
export interface EvaluateRequest {
  readonly id: number;
  readonly kind: 'evaluate';
  readonly doc: unknown;
  readonly tier: string;
}

export type WorkerRequest = InitRequest | EvaluateRequest;

export interface EvaluateOk {
  readonly id: number;
  readonly kind: 'result';
  readonly ok: true;
  readonly mesh: Mesh;
  readonly hash: string;
  readonly stats: EvalStats;
  readonly perNode: readonly NodeEval[];
  readonly perf: {
    readonly workerTotalMs: number;
    readonly buildGraphMs: number;
    readonly engineMs: number;
    readonly copyMeshMs: number;
  };
}

export interface EvaluateErr {
  readonly id: number;
  readonly kind: 'result';
  readonly ok: false;
  readonly error: string;
}

export type WorkerResponse = EvaluateOk | EvaluateErr;
