import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const src = (rel: string) => fileURLToPath(new URL(`../../packages/${rel}`, import.meta.url));
const srcFile = (name: string, file: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/${file}`, import.meta.url));

// Alias workspace packages to their TypeScript source so `dev` needs no prior
// `tsc -b` and edits to packages hot-reload. The '/host' subpath is listed
// first so it wins over the bare '@yacad/worker' prefix match.
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: [
      { find: '@yacad/worker/host', replacement: src('worker/src/host.ts') },
      { find: '@yacad/worker', replacement: src('worker/src/index.ts') },
      { find: '@yacad/canonical', replacement: src('canonical/src/index.ts') },
      { find: '@yacad/hash', replacement: src('hash/src/index.ts') },
      { find: '@yacad/geometry', replacement: src('geometry/src/index.ts') },
      { find: '@yacad/dag', replacement: src('dag/src/index.ts') },
      { find: '@yacad/cache', replacement: src('cache/src/index.ts') },
      { find: '@yacad/kernel-manifold', replacement: src('kernel-manifold/src/index.ts') },
      { find: '@yacad/engine', replacement: src('engine/src/index.ts') },
      { find: '@yacad/render', replacement: src('render/src/index.ts') },
      { find: '@yacad/export-stl', replacement: src('export-stl/src/index.ts') },
      { find: '@yacad/import-stl', replacement: src('import-stl/src/index.ts') },
      { find: '@yacad/import-obj', replacement: src('import-obj/src/index.ts') },
      { find: '@yacad/import-gltf', replacement: src('import-gltf/src/index.ts') },
      { find: '@yacad/lua', replacement: src('lua/src/index.ts') },
      // Sub-path alias for the shared E2E fixtures (mirrors vitest.config.ts)
      { find: '@yacad/e2e/fixtures', replacement: srcFile('e2e', 'fixtures.ts') },
    ],
  },
  // ES-format workers so the host can `import` engine/kernel modules.
  worker: { format: 'es' },
  // Emscripten-built WASM module doesn't pre-bundle cleanly.
  optimizeDeps: { exclude: ['manifold-3d'] },
  server: {
    allowedHosts: ['127.0.0.1', '::1', 'cad.yamplay.cc'],
  }
});
