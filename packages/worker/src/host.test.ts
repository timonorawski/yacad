import { describe, expect, it, vi } from 'vitest';
import { startHost, type WorkerScope } from './host';
import type { EvaluateOk, EvaluateErr } from './protocol';

function fakeScope() {
  const messages: unknown[] = [];
  const scope: WorkerScope = {
    postMessage: (m) => void messages.push(m),
    onmessage: null,
  };
  return { scope, messages };
}

describe('startHost', () => {
  it('evaluates a document and posts the resulting mesh', async () => {
    const { scope, messages } = fakeScope();
    startHost(scope);

    scope.onmessage!({
      data: {
        id: 1,
        kind: 'evaluate',
        doc: { type: 'box', params: { size: [10, 10, 10], center: true } },
        tier: 'final',
      },
    });

    await vi.waitFor(() => expect(messages.length).toBe(1), { timeout: 15000 });
    const res = messages[0] as EvaluateOk;
    expect(res.ok).toBe(true);
    expect(res.id).toBe(1);
    expect(res.mesh.vertices.length).toBeGreaterThan(0);
    expect(res.stats.misses).toBe(1);
  });

  it('reports a validation error instead of throwing', async () => {
    const { scope, messages } = fakeScope();
    startHost(scope);

    scope.onmessage!({ data: { id: 2, kind: 'evaluate', doc: { type: 'torus' }, tier: 'final' } });

    await vi.waitFor(() => expect(messages.length).toBe(1), { timeout: 15000 });
    const res = messages[0] as EvaluateErr;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown node type/);
  });
});
