import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbVfs } from './indexeddb-vfs';
import { MemoryVfs } from './memory-vfs';
import type { Vfs } from './types';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

/** Make a unique IndexedDb name per test so parallel tests don't collide. */
let dbCounter = 0;
function makeIndexedDbVfs(): IndexedDbVfs {
  return new IndexedDbVfs(`yacad-vfs-test-${++dbCounter}`);
}

const impls: { name: string; factory: () => Vfs; teardown?: (v: Vfs) => Promise<void> }[] = [
  { name: 'MemoryVfs', factory: () => new MemoryVfs() },
  {
    name: 'IndexedDbVfs',
    factory: () => makeIndexedDbVfs(),
    teardown: async (v) => {
      await (v as IndexedDbVfs).close();
    },
  },
];

describe.each(impls)('Vfs contract — $name', ({ factory, teardown }) => {
  let vfs: Vfs;

  afterEach(async () => {
    if (teardown) await teardown(vfs);
  });

  it('write then read round-trips bytes', async () => {
    vfs = factory();
    await vfs.write('/hello', ENC.encode('world'));
    const got = await vfs.read('/hello');
    expect(got).toBeDefined();
    expect(DEC.decode(got!)).toBe('world');
  });

  it('read of an unknown key returns undefined', async () => {
    vfs = factory();
    expect(await vfs.read('/missing')).toBeUndefined();
  });

  it('write overwrites the previous value at the same key', async () => {
    vfs = factory();
    await vfs.write('/k', ENC.encode('first'));
    await vfs.write('/k', ENC.encode('second'));
    expect(DEC.decode((await vfs.read('/k'))!)).toBe('second');
  });

  it('delete removes the key; subsequent read returns undefined', async () => {
    vfs = factory();
    await vfs.write('/k', ENC.encode('v'));
    await vfs.delete('/k');
    expect(await vfs.read('/k')).toBeUndefined();
  });

  it('delete of an unknown key is a no-op (no throw)', async () => {
    vfs = factory();
    await expect(vfs.delete('/never-existed')).resolves.toBeUndefined();
  });

  it('list returns only keys with the given prefix', async () => {
    vfs = factory();
    await vfs.write('/docs/a/meta.json', ENC.encode('a'));
    await vfs.write('/docs/a/document.json', ENC.encode('a'));
    await vfs.write('/docs/b/meta.json', ENC.encode('b'));
    await vfs.write('/other/x', ENC.encode('x'));

    const aKeys = [...(await vfs.list('/docs/a/'))].sort();
    expect(aKeys).toEqual(['/docs/a/document.json', '/docs/a/meta.json']);

    const docsKeys = [...(await vfs.list('/docs/'))].sort();
    expect(docsKeys).toEqual(['/docs/a/document.json', '/docs/a/meta.json', '/docs/b/meta.json']);
  });

  it('list returns an empty array for a prefix with no matches', async () => {
    vfs = factory();
    expect(await vfs.list('/nothing/')).toEqual([]);
  });
});
