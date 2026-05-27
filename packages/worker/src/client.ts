import type { EvalStats, NodeEval } from '@yacad/engine';
import type { Mesh } from '@yacad/geometry';
import type { WorkerResponse } from './protocol';

export interface EvaluateOutcome {
  readonly mesh: Mesh;
  readonly hash: string;
  readonly stats: EvalStats;
  readonly perNode: readonly NodeEval[];
}

/** Minimal worker surface — satisfied by the DOM `Worker`. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

interface Pending {
  resolve: (outcome: EvaluateOutcome) => void;
  reject: (error: Error) => void;
}

export interface WorkerClientOptions {
  /** URL of `manifold.wasm`; when given, an `init` message is sent up front. */
  wasmUrl?: string;
}

/**
 * Main-thread proxy to the worker host: a promise-based `evaluate` over the
 * postMessage protocol, correlating responses by request id.
 */
export class WorkerClient {
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly worker: WorkerLike,
    options: WorkerClientOptions = {},
  ) {
    worker.onmessage = (event) => this.onMessage(event.data as WorkerResponse);
    if (options.wasmUrl) {
      this.worker.postMessage({ kind: 'init', wasmUrl: options.wasmUrl });
    }
  }

  evaluate(doc: unknown, tier = 'final'): Promise<EvaluateOutcome> {
    const id = ++this.seq;
    return new Promise<EvaluateOutcome>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, kind: 'evaluate', doc, tier });
    });
  }

  private onMessage(res: WorkerResponse): void {
    const pending = this.pending.get(res.id);
    if (!pending) return;
    this.pending.delete(res.id);
    if (res.ok) {
      pending.resolve({ mesh: res.mesh, hash: res.hash, stats: res.stats, perNode: res.perNode });
    } else {
      pending.reject(new Error(res.error));
    }
  }
}
