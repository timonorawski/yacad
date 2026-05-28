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

describe('DocSession.addBlob', () => {
  it('hashes the bytes, stores them in session.blobs, and uploads via the uploader', async () => {
    const putCalls: Array<{ hash: string; bytes: Uint8Array }> = [];
    const uploader: BlobUploader = {
      putMeshBlob: async (hash, bytes) => {
        putCalls.push({ hash, bytes });
      },
      hasMeshBlob: async () => false,
      putLuaDefinition: async () => {},
      hasLuaDefinition: async () => true,
    };
    const lib = new DocLibrary(new MemoryVfs(), uploader);
    const session = await lib.create('A');

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const hash = await session.addBlob(bytes);

    expect(hash).toMatch(/^[0-9a-f]+$/i);
    expect(session.blobs.get(hash)).toEqual(bytes);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]!.hash).toBe(hash);
  });

  it('is idempotent for the same bytes (one upload, one map entry)', async () => {
    const putCalls: string[] = [];
    const uploader: BlobUploader = {
      putMeshBlob: async (hash) => {
        putCalls.push(hash);
      },
      hasMeshBlob: async (hash) => putCalls.includes(hash),
      putLuaDefinition: async () => {},
      hasLuaDefinition: async () => true,
    };
    const lib = new DocLibrary(new MemoryVfs(), uploader);
    const session = await lib.create('A');

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const h1 = await session.addBlob(bytes);
    const h2 = await session.addBlob(bytes);
    expect(h1).toBe(h2);
    expect(putCalls).toHaveLength(1);
    expect(session.blobs.size).toBe(1);
  });

  it('does not upload when the worker already has the blob', async () => {
    let putCount = 0;
    const uploader: BlobUploader = {
      putMeshBlob: async () => {
        putCount++;
      },
      hasMeshBlob: async () => true, // worker already has every blob
      putLuaDefinition: async () => {},
      hasLuaDefinition: async () => true,
    };
    const lib = new DocLibrary(new MemoryVfs(), uploader);
    const session = await lib.create('A');

    await session.addBlob(new Uint8Array([9, 9, 9]));
    expect(putCount).toBe(0);
  });
});

describe('DocSession.updateMeta', () => {
  it('updates the name, emits meta-changed, and marks dirty', async () => {
    const lib = new DocLibrary(new MemoryVfs(), noopUploader);
    const session = await lib.create('Original');
    const events: DocEvent[] = [];
    session.subscribe((e) => events.push(e));

    session.updateMeta({ name: 'Renamed' });

    expect(session.meta.name).toBe('Renamed');
    expect(events.some((e) => e.kind === 'meta-changed')).toBe(true);
    expect(session.isDirty).toBe(true);
  });

  it('is a no-op when the name is unchanged', async () => {
    const lib = new DocLibrary(new MemoryVfs(), noopUploader);
    const session = await lib.create('Same');
    const events: DocEvent[] = [];
    session.subscribe((e) => events.push(e));

    session.updateMeta({ name: 'Same' });

    expect(events).toEqual([]);
    expect(session.isDirty).toBe(false);
  });

  it('persists the new name on save', async () => {
    const vfs = new MemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('Original');
    session.updateMeta({ name: 'New' });
    await session.save();

    const metaBytes = await vfs.read(`/docs/${session.id}/meta.json`);
    const parsed = JSON.parse(new TextDecoder().decode(metaBytes!));
    expect(parsed.name).toBe('New');
  });
});

describe('DocSession deep-freeze', () => {
  it('session.doc is deep-frozen', async () => {
    const session = await freshSession();
    expect(Object.isFrozen(session.doc)).toBe(true);
    // Frozen mutations throw in strict mode (vitest runs strict).
    expect(() => {
      (session.doc as { type: string }).type = 'changed';
    }).toThrow();
  });
});

describe('DocSession.undo/redo mutating guard', () => {
  it('undo() is a no-op while mutate() is in flight', async () => {
    const session = await freshSession();
    await session.mutate(() => ({ type: 'sphere', params: { radius: 5 } }));
    const sphereDoc = session.doc;

    // `mutating` is set synchronously at the start of mutate() before the
    // first await, so the guard fires when undo() is called during the
    // microtask gap. Racing via Promise resolution ordering:
    let undoCalledDuringMutate = false;
    const inflight = session.mutate(() => {
      // Call undo synchronously from within the mutate fn (mutating = true).
      // undo() must ignore this call; if it doesn't, doc would regress.
      session.undo();
      undoCalledDuringMutate = true;
      return { type: 'cylinder', params: { height: 1, radius: 1 } };
    });

    await inflight;
    expect(undoCalledDuringMutate).toBe(true);
    // Undo inside mutate fn was a no-op — cylinder committed successfully.
    expect(session.doc).toMatchObject({ type: 'cylinder' });
    // Undo now works (not mutating): reverts to sphere.
    session.undo();
    expect(session.doc).toEqual(sphereDoc);
  });
});

describe('DocSession persistence', () => {
  it('save() writes document.json + meta.json to the VFS', async () => {
    const vfs = new MemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A');
    await session.mutate(() => ({ type: 'sphere', params: { radius: 7 } }));
    await session.save();

    const docBytes = await vfs.read(`/docs/${session.id}/document.json`);
    expect(docBytes).toBeDefined();
    expect(JSON.parse(new TextDecoder().decode(docBytes!))).toMatchObject({
      type: 'sphere',
      params: { radius: 7 },
    });
    expect(session.isDirty).toBe(false);
  });

  it('save() also writes any added blobs under /docs/{id}/blobs/{hash}.bin', async () => {
    const vfs = new MemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A');
    const hash = await session.addBlob(new Uint8Array([1, 2, 3]));
    await session.save();

    const blobBytes = await vfs.read(`/docs/${session.id}/blobs/${hash}.bin`);
    expect(blobBytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('save() emits a persisted event', async () => {
    const vfs = new MemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A');
    const events: DocEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.save();
    expect(events.some((e) => e.kind === 'persisted')).toBe(true);
  });

  it('autosave fires after the debounce window following a mutation', async () => {
    const vfs = new MemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A', undefined, { autosaveMs: 30 });
    await session.mutate(() => ({ type: 'sphere', params: { radius: 1 } }));
    expect(session.isDirty).toBe(true);

    // Wait past the debounce window.
    await new Promise((r) => setTimeout(r, 80));
    expect(session.isDirty).toBe(false);
  });

  it('autosave coalesces rapid mutations into one VFS write', async () => {
    // Subclass MemoryVfs to count document.json writes. A Proxy works too,
    // but unbinds `this` for the non-intercepted methods and breaks the
    // library's internal read/list calls — subclassing keeps `this` correct.
    class CountingMemoryVfs extends MemoryVfs {
      docWriteCount = 0;
      override async write(key: string, value: Uint8Array): Promise<void> {
        if (key.endsWith('document.json')) this.docWriteCount++;
        return super.write(key, value);
      }
    }
    const vfs = new CountingMemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A', undefined, { autosaveMs: 30 });
    // Reset the counter after create() (which writes once).
    vfs.docWriteCount = 0;

    for (let i = 1; i <= 5; i++) {
      await session.mutate(() => ({ type: 'sphere', params: { radius: i } }));
    }
    await new Promise((r) => setTimeout(r, 80));
    expect(vfs.docWriteCount).toBe(1);
  });

  it('close() drains a pending autosave', async () => {
    const vfs = new MemoryVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A', undefined, { autosaveMs: 500 });
    await session.mutate(() => ({ type: 'sphere', params: { radius: 1 } }));
    // Don't wait for the debounce — close() should flush immediately.
    await session.close();
    expect(session.isDirty).toBe(false);
    const bytes = await vfs.read(`/docs/${session.id}/document.json`);
    expect(JSON.parse(new TextDecoder().decode(bytes!))).toMatchObject({ type: 'sphere' });
  });

  it('serializes concurrent save calls', async () => {
    // Use a VFS that records its write order so we can detect interleaving.
    class OrderTrackingVfs extends MemoryVfs {
      readonly writes: string[] = [];
      override async write(key: string, value: Uint8Array): Promise<void> {
        this.writes.push(`begin:${key}`);
        // Yield once so concurrent saves can interleave if not serialized.
        await new Promise((r) => setTimeout(r, 0));
        await super.write(key, value);
        this.writes.push(`end:${key}`);
      }
    }
    const vfs = new OrderTrackingVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    const session = await lib.create('A');
    await session.mutate(() => ({ type: 'sphere', params: { radius: 1 } }));

    // Fire two saves concurrently. Without serialization, their writes
    // would interleave (begin:meta, begin:meta, end:meta, end:meta, ...).
    // With serialization, each save's writes complete before the next starts.
    await Promise.all([session.save(), session.save()]);

    // Find every "begin:X" / "end:X" pair and assert they bracket without
    // another begin in between for the SAME key.
    const balance = new Map<string, number>();
    for (const entry of vfs.writes) {
      const [kind, key] = entry.split(':');
      const cur = balance.get(key!) ?? 0;
      if (kind === 'begin') {
        // Should not see another begin for this key while one is open.
        expect(cur).toBe(0);
        balance.set(key!, cur + 1);
      } else {
        balance.set(key!, cur - 1);
      }
    }
  });

  it('autosave failures are caught and logged, not propagated as unhandled rejection', async () => {
    class FailingVfs extends MemoryVfs {
      writeCount = 0;
      override async write(key: string, value: Uint8Array): Promise<void> {
        this.writeCount++;
        // Allow first two writes (meta.json and document.json from create()).
        // Fail on subsequent writes (during autosave).
        if (this.writeCount > 2 && key.endsWith('document.json')) {
          throw new Error('disk full');
        }
        await super.write(key, value);
      }
    }
    const vfs = new FailingVfs();
    const lib = new DocLibrary(vfs, noopUploader);
    // Override console.error for this test to capture the log.
    const origErr = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const session = await lib.create('A', undefined, { autosaveMs: 10 });
      await session.mutate(() => ({ type: 'sphere', params: { radius: 1 } }));
      // Wait for the autosave timer to fire and fail.
      await new Promise((r) => setTimeout(r, 60));
      expect(errors.length).toBeGreaterThan(0);
      // The first console.error call's first arg should mention 'autosave failed'.
      const firstCallMessage = String((errors[0] as unknown[])[0] ?? '');
      expect(firstCallMessage).toMatch(/autosave failed/i);
    } finally {
      console.error = origErr;
    }
  });
});
