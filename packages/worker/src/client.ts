import type { EvalStats, NodeEval } from '@yacad/engine';
import type { Mesh } from '@yacad/geometry';
import type { LuaDefinition } from '@yacad/lua';
import type { OkResponse, WorkerResponse } from './protocol';

export interface EvaluateOutcome {
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

/** Minimal worker surface — satisfied by the DOM `Worker`. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
}

export interface WorkerClientOptions {
  /** URL of `manifold.wasm`; when given, an `init` message is sent up front. */
  wasmUrl?: string;
  /** URL of the Lua WASM; when given, forwarded in the `init` message so the
   *  worker can instantiate WasmoonLuaRuntime on startup. */
  luaWasmUrl?: string;
}

/**
 * Main-thread proxy to the worker host: a promise-based `evaluate`,
 * `putLuaDefinition`, and `hasLuaDefinition` over the postMessage protocol,
 * correlating responses by request id.
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
      this.worker.postMessage({
        kind: 'init',
        wasmUrl: options.wasmUrl,
        ...(options.luaWasmUrl ? { luaWasmUrl: options.luaWasmUrl } : {}),
      });
    }
  }

  evaluate(doc: unknown, tier = 'final'): Promise<EvaluateOutcome> {
    return this.send<{ id: number; kind: 'evaluate'; doc: unknown; tier: string }, WorkerResponse>(
      { id: 0 /* overwritten by send */, kind: 'evaluate', doc, tier },
    ).then((res) => {
      if (res.kind !== 'result') {
        throw new Error(`unexpected response kind "${res.kind}" for evaluate`);
      }
      if (res.ok) {
        return {
          mesh: res.mesh,
          hash: res.hash,
          stats: res.stats,
          perNode: res.perNode,
          perf: res.perf,
        };
      } else {
        throw new Error(res.error);
      }
    });
  }

  /** Upload a Lua definition to the worker's in-memory map. */
  async putLuaDefinition(hash: string, definition: LuaDefinition): Promise<void> {
    await this.send({ id: 0, kind: 'putLuaDefinition', hash, definition });
  }

  /** Check whether a Lua definition is present in the worker's in-memory map. */
  async hasLuaDefinition(hash: string): Promise<boolean> {
    const res = await this.send({ id: 0, kind: 'hasLuaDefinition', hash });
    return (res as OkResponse).present === true;
  }

  /**
   * Generic correlated request/response helper. Allocates an id, posts the
   * request (overwriting any `id` field on the supplied object), and resolves
   * when the worker posts back a response carrying the same id.
   */
  send<TReq extends { id: number; kind: string }, TRes extends WorkerResponse>(
    req: TReq,
  ): Promise<TRes> {
    const id = ++this.seq;
    return new Promise<TRes>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (res) => resolve(res as TRes),
        reject,
      });
      this.worker.postMessage({ ...req, id });
    });
  }

  private onMessage(res: WorkerResponse): void {
    const pending = this.pending.get(res.id);
    if (!pending) return;
    this.pending.delete(res.id);
    // All response kinds resolve (never reject at the transport level).
    // evaluate() handles ok/error discrimination itself.
    pending.resolve(res);
  }
}
