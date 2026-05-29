import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { Vfs } from '@yacad/vfs';

export interface FilesystemVfsOptions {
  /** Absolute or cwd-relative directory holding the VFS contents. */
  readonly rootDir: string;
}

/**
 * Filesystem-backed `Vfs` for Node hosts (the MCP server). Mirrors the path
 * layout of `IndexedDbVfs` so consumers — primarily `DocLibrary` — don't care
 * which backend is in use. Writes are atomic: `${key}.tmp` is written then
 * renamed over the destination, so a crashed process can't leave half-written
 * meta.json / document.json files.
 *
 * Keys are virtual paths with `/` separators; the implementation translates
 * them to filesystem paths under `rootDir` using `path.join`, which normalises
 * the separator to whatever the OS uses.
 */
export class FilesystemVfs implements Vfs {
  private readonly rootDir: string;

  constructor(opts: FilesystemVfsOptions) {
    this.rootDir = opts.rootDir;
  }

  async read(key: string): Promise<Uint8Array | undefined> {
    try {
      const bytes = await readFile(this.toFsPath(key));
      // readFile returns a Buffer (Uint8Array subclass) — narrow for callers
      // that may rely on the exact constructor.
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async write(key: string, value: Uint8Array): Promise<void> {
    const fsPath = this.toFsPath(key);
    await mkdir(dirname(fsPath), { recursive: true });
    const tmpPath = `${fsPath}.tmp`;
    await writeFile(tmpPath, value);
    await rename(tmpPath, fsPath);
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.toFsPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async list(prefix: string): Promise<readonly string[]> {
    const out: string[] = [];
    await this.walk(this.rootDir, out);
    return out.filter((k) => k.startsWith(prefix));
  }

  private async walk(dir: string, into: string[]): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.walk(full, into);
        } else if (entry.isFile() && !entry.name.endsWith('.tmp')) {
          into.push(this.toKey(full));
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  private toFsPath(key: string): string {
    if (!key.startsWith('/')) {
      throw new Error(`FilesystemVfs key must start with '/': ${key}`);
    }
    // Drop the leading '/' so join doesn't treat it as absolute.
    return join(this.rootDir, key.slice(1));
  }

  private toKey(fsPath: string): string {
    const rel = relative(this.rootDir, fsPath).split(sep).join('/');
    return `/${rel}`;
  }
}
