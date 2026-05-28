import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

const pkgFile = (name: string, file: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Resolve workspace packages to their TypeScript source so tests run
    // without a prior `tsc -b`. Only bare top-level specifiers are used.
    alias: {
      '@yacad/canonical': pkg('canonical'),
      '@yacad/hash': pkg('hash'),
      '@yacad/geometry': pkg('geometry'),
      '@yacad/dag': pkg('dag'),
      '@yacad/doc-store': pkg('doc-store'),
      '@yacad/cache': pkg('cache'),
      '@yacad/kernel-manifold': pkg('kernel-manifold'),
      '@yacad/engine': pkg('engine'),
      '@yacad/lua': pkg('lua'),
      '@yacad/worker': pkg('worker'),
      '@yacad/render': pkg('render'),
      '@yacad/mutations': pkg('mutations'),
      '@yacad/selection': pkg('selection'),
      '@yacad/export-stl': pkg('export-stl'),
      '@yacad/export-dxf': pkg('export-dxf'),
      '@yacad/export-svg': pkg('export-svg'),
      '@yacad/export-png': pkg('export-png'),
      '@yacad/import-stl': pkg('import-stl'),
      '@yacad/import-obj': pkg('import-obj'),
      '@yacad/import-gltf': pkg('import-gltf'),
      '@yacad/vfs': pkg('vfs'),
      // Sub-path alias for the shared E2E fixtures (used by bench/lua.bench.ts)
      '@yacad/e2e/fixtures': pkgFile('e2e', 'fixtures.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    passWithNoTests: true,
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/showcase/**/*.test.ts',
      'apps/studio2/src/**/*.test.ts',
      'bench/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/.git/**', 'bench/**/*.bench.ts'],
  },
});
