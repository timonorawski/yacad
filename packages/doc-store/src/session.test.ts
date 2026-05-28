import { beforeEach, describe, expect, it } from 'vitest';
import type { NodeDoc } from '@yacad/dag';
import { MemoryVfs } from '@yacad/vfs';
import { DocLibrary } from './library';
import type { DocSession } from './session';
import type { BlobUploader, DocEvent } from './types';

const noopUploader: BlobUploader = {
  putMeshBlob: async () => {},
  hasMeshBlob: async () => true,
  putLuaDefinition: async () => {},
  hasLuaDefinition: async () => true,
};

async function freshSession(seed?: NodeDoc): Promise<DocSession> {
  const lib = new DocLibrary(new MemoryVfs(), noopUploader);
  return lib.create('Test', seed);
}

describe('DocSession.mutate', () => {
  let session: DocSession;

  beforeEach(async () => {
    session = await freshSession();
  });

  it('commits a valid transformation and emits doc-changed', async () => {
    const events: DocEvent[] = [];
    session.subscribe((e) => events.push(e));

    await session.mutate(() => ({
      type: 'sphere',
      params: { radius: 5, segments: 16 },
    }));

    expect(session.doc).toMatchObject({ type: 'sphere' });
    expect(events.some((e) => e.kind === 'doc-changed')).toBe(true);
    expect(session.isDirty).toBe(true);
  });

  it('rejects an invalid transformation; state unchanged; no event emitted', async () => {
    const events: DocEvent[] = [];
    session.subscribe((e) => events.push(e));
    const before = session.doc;

    await expect(
      session.mutate(() => ({ type: 'not-a-real-type', params: {} }) as NodeDoc),
    ).rejects.toThrow();

    expect(session.doc).toBe(before);
    expect(events).toEqual([]);
  });

  it('canUndo becomes true after a commit; undo restores the previous doc', async () => {
    const original = session.doc;
    expect(session.canUndo).toBe(false);

    await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    expect(session.canUndo).toBe(true);

    session.undo();
    expect(session.doc).toEqual(original);
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(true);
  });

  it('redo restores the most recently undone doc', async () => {
    await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    const afterMutate = session.doc;
    session.undo();
    session.redo();
    expect(session.doc).toEqual(afterMutate);
  });

  it('a new mutation after undo invalidates the redo stack', async () => {
    await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    session.undo();
    expect(session.canRedo).toBe(true);

    await session.mutate(() => ({ type: 'cylinder', params: { height: 1, radius: 1 } }));
    expect(session.canRedo).toBe(false);
  });

  it('undo / redo emit doc-changed events', async () => {
    await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    const events: DocEvent[] = [];
    session.subscribe((e) => events.push(e));

    session.undo();
    session.redo();

    expect(events.filter((e) => e.kind === 'doc-changed')).toHaveLength(2);
  });

  it('subscribe returns an unsubscribe function', async () => {
    const events: DocEvent[] = [];
    const unsubscribe = session.subscribe((e) => events.push(e));
    unsubscribe();
    await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    expect(events).toEqual([]);
  });

  it('rejects overlapping mutate calls', async () => {
    const first = session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    await expect(
      session.mutate(() => ({ type: 'cylinder', params: { height: 1, radius: 1 } })),
    ).rejects.toThrow(/in progress/);
    await first;
    expect(session.doc).toMatchObject({ type: 'sphere' });
  });

  it('a throwing subscriber does not block other subscribers', async () => {
    const received: string[] = [];
    session.subscribe(() => {
      throw new Error('subscriber A boom');
    });
    session.subscribe(() => received.push('B'));
    // Silence expected console.error in this test.
    const origErr = console.error;
    console.error = () => {};
    try {
      await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    } finally {
      console.error = origErr;
    }
    expect(received).toEqual(['B']);
  });

  it('a subscriber unsubscribed by an earlier subscriber still receives the in-flight event', async () => {
    const received: string[] = [];
    const unsubscribeB = session.subscribe(() => received.push('B'));
    session.subscribe(() => {
      received.push('A');
      unsubscribeB();
    });
    await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    // Both fire on the snapshot of subscribers taken at emit time, even
    // though the second subscriber unsubscribes B mid-emit.
    expect(received.sort()).toEqual(['A', 'B']);
  });
});
