// Bundles src/server.ts into dist/main.js so Node can run the MCP server.
//
// Why: the workspace's TS packages are compiled with `moduleResolution:
// bundler`, which emits extensionless relative imports (`from './foo'`). That
// is fine for Vite / Vitest, but Node's ESM resolver rejects it. Inlining the
// `@yacad/*` packages with esbuild side-steps the issue and keeps the
// runnable artifact self-contained. Third-party deps (Manifold WASM, Wasmoon,
// ws, MCP SDK) stay external — they have native binaries / WASM siblings that
// must be resolved from node_modules at runtime.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');

await build({
  entryPoints: [resolve(pkgRoot, 'src/server.ts')],
  outfile: resolve(pkgRoot, 'dist/main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  // esbuild auto-injects the shebang from package.json#bin; we just need the
  // CommonJS interop shim so bundled deps that lazy-load via `require()` work.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  // Externalize only what cannot be bundled safely: Node built-ins, packages
  // that ship WASM resolved relative to their on-disk location, and packages
  // with optional native bindings. Everything else (workspace packages + pure
  // JS deps) is inlined, so the runtime doesn't have to walk pnpm's hoisted
  // node_modules tree to find transitive deps.
  external: [
    'manifold-3d',
    'wasmoon',
    'ws',
    'bufferutil',
    'utf-8-validate',
    // @napi-rs/canvas (transitive via @yacad/export-png) loads a platform-
    // specific .node binary at runtime; let Node resolve it from the hoisted
    // node_modules tree rather than trying to inline it.
    '@napi-rs/canvas',
  ],
});
