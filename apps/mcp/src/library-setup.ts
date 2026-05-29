import { MemoryStore } from '@yacad/cache';
import { getNodeType, registerNodeType, type DefinitionResolver } from '@yacad/dag';
import { DocLibrary } from '@yacad/doc-store';
import { Engine } from '@yacad/engine';
import { IMPORT_GLTF_NODE_TYPE, IMPORT_GLTF_TYPE } from '@yacad/import-gltf';
import { IMPORT_OBJ_NODE_TYPE, IMPORT_OBJ_TYPE } from '@yacad/import-obj';
import { IMPORT_STL_NODE_TYPE, IMPORT_STL_TYPE } from '@yacad/import-stl';
import { ManifoldKernel, loadManifold } from '@yacad/kernel-manifold';
import {
  WasmoonLuaRuntime,
  WasmoonWarpEvaluator,
  makeLuaNodeType,
  type LuaDefinition,
  type LuaDefinitionResolver,
} from '@yacad/lua';
import { FilesystemVfs } from '@yacad/vfs-fs';

/**
 * Composes the full yacad runtime over a filesystem VFS — equivalent to what
 * the worker host wires up in the browser, but headless and synchronous-to-
 * construct (the WASM module loads here so first tool call is fast).
 */
export interface Runtime {
  readonly library: DocLibrary;
  readonly engine: Engine;
  readonly luaDefs: Map<string, LuaDefinition>;
  readonly meshBlobs: Map<string, Uint8Array>;
}

export async function setupRuntime(libraryDir: string): Promise<Runtime> {
  // Mesh-blob + Lua-def maps: same composite-resolver pattern the worker uses.
  const meshBlobs = new Map<string, Uint8Array>();
  const luaDefs = new Map<string, LuaDefinition>();
  const luaResolver: LuaDefinitionResolver = { get: (h) => luaDefs.get(h) };
  const combinedResolver: DefinitionResolver = {
    get: (h) => luaDefs.get(h) ?? meshBlobs.get(h),
  };

  // Register decoder + Lua node types if not already registered (DAG registry
  // is process-global; multiple Runtime instances must not double-register).
  if (!getNodeType(IMPORT_STL_TYPE)) registerNodeType(IMPORT_STL_NODE_TYPE);
  if (!getNodeType(IMPORT_OBJ_TYPE)) registerNodeType(IMPORT_OBJ_NODE_TYPE);
  if (!getNodeType(IMPORT_GLTF_TYPE)) registerNodeType(IMPORT_GLTF_NODE_TYPE);
  const luaRuntime = new WasmoonLuaRuntime();
  if (!getNodeType('lua')) registerNodeType(makeLuaNodeType(luaRuntime, luaResolver));

  // Kernel + warp evaluator share the same Lua sandbox config under the hood.
  const manifold = await loadManifold();
  const warpEvaluator = new WasmoonWarpEvaluator();
  const kernel = new ManifoldKernel(manifold, { warpEvaluator });

  const store = new MemoryStore();
  const engine = new Engine(store, kernel, { resolver: combinedResolver });

  // Filesystem VFS + DocLibrary. The library handles blob upload via the
  // BlobUploader contract; we point that at the luaDefs + meshBlobs maps so
  // tools that add blobs (Lua defs, mesh imports) feed the resolver.
  const vfs = new FilesystemVfs({ rootDir: libraryDir });
  const library = new DocLibrary(vfs, {
    putMeshBlob: async (hash, bytes) => {
      meshBlobs.set(hash, bytes);
    },
    hasMeshBlob: async (hash) => meshBlobs.has(hash),
    putLuaDefinition: async (hash, def) => {
      luaDefs.set(hash, def);
    },
    hasLuaDefinition: async (hash) => luaDefs.has(hash),
  });

  return { library, engine, luaDefs, meshBlobs };
}
