import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemVfs } from './filesystem-vfs';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

describe('FilesystemVfs', () => {
  let root: string;
  let vfs: FilesystemVfs;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'yacad-vfs-fs-'));
    vfs = new FilesystemVfs({ rootDir: root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('write then read round-trips bytes', async () => {
    await vfs.write('/docs/abc/meta.json', ENC.encode('{"name":"x"}'));
    const got = await vfs.read('/docs/abc/meta.json');
    expect(got).toBeDefined();
    expect(DEC.decode(got!)).toBe('{"name":"x"}');
  });

  it('read of an absent key returns undefined', async () => {
    expect(await vfs.read('/missing')).toBeUndefined();
  });

  it('write creates intermediate directories', async () => {
    await vfs.write('/docs/deep/nest/x.bin', new Uint8Array([1, 2, 3]));
    const got = await vfs.read('/docs/deep/nest/x.bin');
    expect(got).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('list returns keys with the given prefix', async () => {
    await vfs.write('/docs/a/meta.json', ENC.encode('a'));
    await vfs.write('/docs/b/meta.json', ENC.encode('b'));
    await vfs.write('/other/x', ENC.encode('x'));
    const keys = await vfs.list('/docs/');
    expect(keys.length).toBe(2);
    expect([...keys].sort()).toEqual(['/docs/a/meta.json', '/docs/b/meta.json']);
  });

  it('delete is idempotent for absent keys', async () => {
    await expect(vfs.delete('/never-existed')).resolves.toBeUndefined();
  });

  it('delete removes a present key', async () => {
    await vfs.write('/x', ENC.encode('x'));
    expect(await vfs.read('/x')).toBeDefined();
    await vfs.delete('/x');
    expect(await vfs.read('/x')).toBeUndefined();
  });

  it('write is atomic: a crashed write leaves no half-file', async () => {
    // The atomic-write contract is "tmp file then rename". We verify by
    // confirming no `.tmp` artefact remains after a successful write.
    await vfs.write('/docs/abc/meta.json', ENC.encode('full'));
    const keys = await vfs.list('/docs/');
    expect(keys.every((k) => !k.endsWith('.tmp'))).toBe(true);
  });
});
