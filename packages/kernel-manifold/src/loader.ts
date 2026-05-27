import Module, { type ManifoldToplevel } from 'manifold-3d';

/** Identity recorded in cache keys' `produced_by` for this kernel. */
export const KERNEL_NAME = 'manifold';

/**
 * Kernel version recorded in `produced_by`. Kept in sync with the manifold-3d
 * dependency; bumping it correctly invalidates artifacts produced by an older
 * kernel (CLAUDE.md #3).
 */
export const KERNEL_VERSION = '3.5.0';

export interface ManifoldLoadOptions {
  /**
   * Return the URL of `manifold.wasm`. Required in bundled/browser contexts
   * (e.g. Vite's `import wasmUrl from 'manifold-3d/manifold.wasm?url'`); omit it
   * under Node, where Emscripten finds the file beside `manifold.js`.
   */
  locateFile?: () => string;
}

/** Instantiate the Manifold WASM module and run its required `setup()`. */
export async function loadManifold(options?: ManifoldLoadOptions): Promise<ManifoldToplevel> {
  const wasm = options?.locateFile
    ? await Module({ locateFile: options.locateFile })
    : await Module();
  wasm.setup();
  return wasm;
}
