import { describe, expect, it } from 'vitest';
import { WorkerClient, type WorkerLike } from './client';
import type { WorkerResponse } from './protocol';

interface SentRequest {
  id: number;
  kind: string;
  doc: unknown;
  tier: string;
}

/** Worker stand-in that answers each request via a supplied responder. */
class MockWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly sent: SentRequest[] = [];

  constructor(private readonly respond: (req: SentRequest) => WorkerResponse | undefined) {}

  postMessage(message: unknown): void {
    const req = message as SentRequest;
    if (req.kind !== 'evaluate') return; // ignore init etc.
    this.sent.push(req);
    const res = this.respond(req);
    if (res) queueMicrotask(() => this.onmessage?.({ data: res } as MessageEvent));
  }
}

const okResponse = (id: number): WorkerResponse => ({
  id,
  kind: 'result',
  ok: true,
  mesh: { vertices: new Float32Array([1, 2, 3]), indices: new Uint32Array([0]) },
  hash: 'abc',
  stats: {
    nodes: 1,
    hits: 0,
    misses: 1,
    totalMs: 1,
    lookupMs: 0.1,
    kernelMs: 0.8,
    storeMs: 0.1,
    selfMs: 1,
  },
  perNode: [
    {
      id: '$',
      hash: 'abc',
      hit: false,
      totalMs: 1,
      selfMs: 1,
      lookupMs: 0.1,
      kernelMs: 0.8,
      storeMs: 0.1,
    },
  ],
  perf: { workerTotalMs: 3, buildGraphMs: 1, engineMs: 1.6, copyMeshMs: 0.4 },
});

describe('WorkerClient', () => {
  it('sends an evaluate request and resolves with the outcome', async () => {
    const worker = new MockWorker((req) => okResponse(req.id));
    const client = new WorkerClient(worker);

    const outcome = await client.evaluate({ type: 'box' }, 'final');

    expect(worker.sent[0]).toMatchObject({ kind: 'evaluate', tier: 'final' });
    expect(outcome.hash).toBe('abc');
    expect(outcome.stats.misses).toBe(1);
  });

  it('rejects when the worker reports an error', async () => {
    const worker = new MockWorker((req) => ({
      id: req.id,
      kind: 'result',
      ok: false,
      error: 'boom',
    }));
    const client = new WorkerClient(worker);
    await expect(client.evaluate({ type: 'bad' })).rejects.toThrow('boom');
  });

  it('correlates concurrent requests by id', async () => {
    const worker = new MockWorker((req) => okResponse(req.id));
    const client = new WorkerClient(worker);
    const [a, b] = await Promise.all([client.evaluate({}), client.evaluate({})]);
    expect(a.hash).toBe('abc');
    expect(b.hash).toBe('abc');
    expect(worker.sent.map((r) => r.id)).toEqual([1, 2]);
  });
});
