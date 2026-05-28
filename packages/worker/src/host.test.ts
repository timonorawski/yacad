import { defaultHasher } from '@yacad/hash';
import { hashLuaDefinition, type LuaDefinition } from '@yacad/lua';
import { describe, expect, it, vi } from 'vitest';
import { startHost, type WorkerScope } from './host';
import type { EvaluateErr, EvaluateOk, OkResponse, ValidationErrorResponse } from './protocol';

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
    expect(res.geometry.kind).toBe('3d');
    if (res.geometry.kind === '3d') {
      expect(res.geometry.mesh.vertices.length).toBeGreaterThan(0);
    }
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

describe('putLuaDefinition / hasLuaDefinition', () => {
  const def: LuaDefinition = {
    schema: { inputs: [], params: {}, output: '3d' },
    code: 'return geo.box({size = {1, 1, 1}})',
  };

  it('responds to hasLuaDefinition (present: false) before put', async () => {
    const { scope, messages } = fakeScope();
    startHost(scope);

    // Use a unique hash so this test is independent of module-level state
    const hash = await hashLuaDefinition(
      { schema: { inputs: [], params: {}, output: '3d' }, code: 'return geo.box({size={2,2,2}})' },
      defaultHasher,
    );

    scope.onmessage!({ data: { id: 10, kind: 'hasLuaDefinition', hash } });
    await vi.waitFor(() => expect(messages.length).toBe(1), { timeout: 5000 });
    const before = messages[0] as OkResponse;
    expect(before.kind).toBe('ok');
    expect(before.id).toBe(10);
    expect(before.present).toBe(false);
  });

  it('responds ok to putLuaDefinition and then present: true on hasLuaDefinition', async () => {
    const { scope, messages } = fakeScope();
    startHost(scope);

    const hash = await hashLuaDefinition(def, defaultHasher);

    // 1. put
    scope.onmessage!({ data: { id: 20, kind: 'putLuaDefinition', hash, definition: def } });
    await vi.waitFor(() => expect(messages.length).toBe(1), { timeout: 5000 });
    const putRes = messages[0] as OkResponse;
    expect(putRes.kind).toBe('ok');
    expect(putRes.id).toBe(20);
    expect(putRes.present).toBeUndefined();

    // 2. has — should now be present
    scope.onmessage!({ data: { id: 21, kind: 'hasLuaDefinition', hash } });
    await vi.waitFor(() => expect(messages.length).toBe(2), { timeout: 5000 });
    const hasRes = messages[1] as OkResponse;
    expect(hasRes.kind).toBe('ok');
    expect(hasRes.id).toBe(21);
    expect(hasRes.present).toBe(true);
  });

  it('put/has round-trip works without init (no kernel needed for definition management)', async () => {
    // putLuaDefinition and hasLuaDefinition are handled synchronously on the
    // message loop — they don't require the backend to be ready, so no WASM
    // loading is triggered. This confirms the protocol works in isolation.
    const { scope, messages } = fakeScope();
    startHost(scope);

    const hash = 'smoke-test-hash';
    const smokeDef: LuaDefinition = {
      schema: { inputs: [], params: {}, output: '3d' },
      code: 'return geo.box({size={3,3,3}})',
    };

    // Check absent first
    scope.onmessage!({ data: { id: 30, kind: 'hasLuaDefinition', hash } });
    await vi.waitFor(() => expect(messages.length).toBe(1), { timeout: 5000 });
    expect((messages[0] as OkResponse).present).toBe(false);

    // Store
    scope.onmessage!({ data: { id: 31, kind: 'putLuaDefinition', hash, definition: smokeDef } });
    await vi.waitFor(() => expect(messages.length).toBe(2), { timeout: 5000 });
    expect((messages[1] as OkResponse).kind).toBe('ok');

    // Check present
    scope.onmessage!({ data: { id: 32, kind: 'hasLuaDefinition', hash } });
    await vi.waitFor(() => expect(messages.length).toBe(3), { timeout: 5000 });
    expect((messages[2] as OkResponse).present).toBe(true);
  });
});

describe('putLuaDefinition validation', () => {
  it('rejects a definition with an undeclared param reference', async () => {
    const { scope, messages } = fakeScope();
    startHost(scope);

    // References params.teeth but the schema has an empty params object.
    const bad: LuaDefinition = {
      schema: { inputs: [], params: {}, output: '3d' },
      code: 'return { type = "box", params = { size = { params.teeth, 1, 1 } } }',
    };
    const hash = await hashLuaDefinition(bad, defaultHasher);

    scope.onmessage!({ data: { id: 40, kind: 'putLuaDefinition', hash, definition: bad } });
    await vi.waitFor(() => expect(messages.length).toBe(1), { timeout: 5000 });

    const res = messages[0] as ValidationErrorResponse;
    expect(res.kind).toBe('validation-error');
    expect(res.id).toBe(40);
    expect(res.issues.length).toBeGreaterThan(0);
    expect(res.issues.some((i) => i.category === 'undeclared-param')).toBe(true);

    // The bad definition must NOT have been stored.
    scope.onmessage!({ data: { id: 41, kind: 'hasLuaDefinition', hash } });
    await vi.waitFor(() => expect(messages.length).toBe(2), { timeout: 5000 });
    expect((messages[1] as OkResponse).present).toBe(false);
  });

  it('stores valid definitions and responds ok (validation does not break the happy path)', async () => {
    const { scope, messages } = fakeScope();
    startHost(scope);

    const good: LuaDefinition = {
      schema: { inputs: [], params: { side: { type: 'number', default: 1 } }, output: '3d' },
      code: 'return geo.box({size = {params.side, params.side, params.side}})',
    };
    const hash = await hashLuaDefinition(good, defaultHasher);

    scope.onmessage!({ data: { id: 50, kind: 'putLuaDefinition', hash, definition: good } });
    await vi.waitFor(() => expect(messages.length).toBe(1), { timeout: 5000 });
    expect((messages[0] as OkResponse).kind).toBe('ok');
    expect((messages[0] as OkResponse).id).toBe(50);

    // Confirm it was actually stored.
    scope.onmessage!({ data: { id: 51, kind: 'hasLuaDefinition', hash } });
    await vi.waitFor(() => expect(messages.length).toBe(2), { timeout: 5000 });
    expect((messages[1] as OkResponse).present).toBe(true);
  });
});
