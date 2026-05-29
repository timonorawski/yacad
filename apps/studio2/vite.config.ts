import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const src = (rel: string) => fileURLToPath(new URL(`../../packages/${rel}`, import.meta.url));
const srcFile = (name: string, file: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/${file}`, import.meta.url));

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
      { find: '@yacad/export-svg', replacement: src('export-svg/src/index.ts') },
      { find: '@yacad/export-dxf', replacement: src('export-dxf/src/index.ts') },
      // Use export-png/browser directly so the bundler doesn't pull the Node
      // (@napi-rs/canvas) path, which can't be browserified.
      { find: '@yacad/export-png', replacement: src('export-png/src/browser.ts') },
      { find: '@yacad/import-stl', replacement: src('import-stl/src/index.ts') },
      { find: '@yacad/import-obj', replacement: src('import-obj/src/index.ts') },
      { find: '@yacad/import-gltf', replacement: src('import-gltf/src/index.ts') },
      { find: '@yacad/lua', replacement: src('lua/src/index.ts') },
      { find: '@yacad/remote-vfs', replacement: src('remote-vfs/src/index.ts') },
      { find: '@yacad/vfs', replacement: src('vfs/src/index.ts') },
      { find: '@yacad/doc-store', replacement: src('doc-store/src/index.ts') },
      { find: '@yacad/selection', replacement: src('selection/src/index.ts') },
      { find: '@yacad/mutations', replacement: src('mutations/src/index.ts') },
      { find: '@yacad/e2e/fixtures', replacement: srcFile('e2e', 'fixtures.ts') },
      {
        find: '@yacad/e2e/showcase/tree',
        replacement: fileURLToPath(
          new URL('../../packages/e2e/showcase/tree/index.ts', import.meta.url),
        ),
      },
      {
        find: '@yacad/e2e/showcase/house',
        replacement: fileURLToPath(
          new URL('../../packages/e2e/showcase/house/index.ts', import.meta.url),
        ),
      },
      {
        find: '@yacad/e2e/showcase/castle',
        replacement: fileURLToPath(
          new URL('../../packages/e2e/showcase/castle/index.ts', import.meta.url),
        ),
      },
      {
        find: '@yacad/e2e/showcase/torus-knot',
        replacement: fileURLToPath(
          new URL('../../packages/e2e/showcase/torus-knot/index.ts', import.meta.url),
        ),
      },
      {
        find: '@yacad/e2e/showcase/chamfered-box',
        replacement: fileURLToPath(
          new URL('../../packages/e2e/showcase/chamfered-box/index.ts', import.meta.url),
        ),
      },
      {
        find: '@yacad/e2e/showcase/filleted-slab',
        replacement: fileURLToPath(
          new URL('../../packages/e2e/showcase/filleted-slab/index.ts', import.meta.url),
        ),
      },
    ],
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
});
