import type { EvalStats, NodeEval } from '@yacad/engine';
import type { Geometry } from '@yacad/geometry';
import { LuaValidationError, type LuaDefinition } from '@yacad/lua';
import type {
  GetGeometryOk,
  OkResponse,
  ValidationErrorResponse,
  WorkerResponse,
} from './protocol';

export interface EvaluateOutcome {
  readonly geometry: Geometry;
  readonly hash: string;
  readonly stats: EvalStats;
  readonly perNode: readonly NodeEval[];
  readonly perf: {
    readonly workerTotalMs: number;
    readonly buildGraphMs: number;
    readonly engineMs: number;
    readonly copyMeshMs: number;
    /** Main → worker postMessage latency (clone + queue + dispatch). */
    readonly transportInMs: number;
    /** Worker → main postMessage latency (clone + queue + dispatch). */
    readonly transportOutMs: number;
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
    // Stamp the moment we postMessage so we can compare against workerStartAbs
    // (recorded by the worker on entry) for the inbound transport latency.
    const mainSentAbs = performance.timeOrigin + performance.now();
    const id = ++this.seq;
    return new Promise<EvaluateOutcome>((resolve, reject) => {
      this.pending.set(id, {
        // The resolver runs synchronously inside onMessage, so capturing now()
        // here is the actual receive timestamp.
        resolve: (res) => {
          const mainRecvAbs = performance.timeOrigin + performance.now();
          if (res.kind !== 'result') {
            reject(new Error(`unexpected response kind "${res.kind}" for evaluate`));
            return;
          }
          if (!res.ok) {
            reject(new Error(res.error));
            return;
          }
          resolve({
            geometry: res.geometry,
            hash: res.hash,
            stats: res.stats,
            perNode: res.perNode,
            perf: {
              workerTotalMs: res.perf.workerTotalMs,
              buildGraphMs: res.perf.buildGraphMs,
              engineMs: res.perf.engineMs,
              copyMeshMs: res.perf.copyMeshMs,
              transportInMs: Math.max(0, res.perf.workerStartAbs - mainSentAbs),
              transportOutMs: Math.max(0, mainRecvAbs - res.perf.workerPostAbs),
            },
          });
        },
        reject,
      });
      this.worker.postMessage({ id, kind: 'evaluate', doc, tier });
    });
  }

  /** Upload a Lua definition to the worker's in-memory map.
   *  Throws `LuaValidationError` if the worker rejects the definition. */
  async putLuaDefinition(hash: string, definition: LuaDefinition): Promise<void> {
    const res = await this.send({ id: 0, kind: 'putLuaDefinition', hash, definition });
    if ((res as ValidationErrorResponse).kind === 'validation-error') {
      throw new LuaValidationError((res as ValidationErrorResponse).issues);
    }
  }

  /** Check whether a Lua definition is present in the worker's in-memory map. */
  async hasLuaDefinition(hash: string): Promise<boolean> {
    const res = await this.send({ id: 0, kind: 'hasLuaDefinition', hash });
    return (res as OkResponse).present === true;
  }

  /** Upload a mesh blob (binary STL / 3MF / …) to the worker's blob map. */
  async putMeshBlob(hash: string, bytes: Uint8Array): Promise<void> {
    await this.send({ id: 0, kind: 'putMeshBlob', hash, bytes });
  }

  /** Check whether a mesh blob is registered under the given hash. */
  async hasMeshBlob(hash: string): Promise<boolean> {
    const res = await this.send({ id: 0, kind: 'hasMeshBlob', hash });
    return (res as OkResponse).present === true;
  }

  /**
   * Look up a cached geometry by its semantic hash. Returns the geometry if
   * found, or `null` if nothing is cached for that hash. This is a pure cache
   * read — no DAG walking or evaluation.
   */
  async getGeometry(hash: string, tier = 'final'): Promise<Geometry | null> {
    const res = await this.send({ id: 0, kind: 'getGeometry', hash, tier });
    const g = res as GetGeometryOk | { ok: false };
    if (g.ok) return (g as GetGeometryOk).geometry;
    return null;
  }

  /** Drop every artifact in the worker's cache (L1 + L2). The next evaluate
   *  will be all misses, so the demo can show the rebuild cost vs. cache hits. */
  async clearCache(): Promise<void> {
    await this.send({ id: 0, kind: 'clearCache' });
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
