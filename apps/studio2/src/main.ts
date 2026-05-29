import './app.css';
import { mount } from 'svelte';
import {
  registerNodeType,
  getNodeType,
  DagError,
  type ExpandableNodeType,
  type GeometryType,
} from '@yacad/dag';
import { IMPORT_STL_NODE_TYPE, IMPORT_STL_TYPE } from '@yacad/import-stl';
import { IMPORT_OBJ_NODE_TYPE, IMPORT_OBJ_TYPE } from '@yacad/import-obj';
import { IMPORT_GLTF_NODE_TYPE, IMPORT_GLTF_TYPE } from '@yacad/import-gltf';
import type { LuaDefinition } from '@yacad/lua';
import { IndexedDbVfs, type Vfs } from '@yacad/vfs';
import { RemoteVfs } from '@yacad/remote-vfs';
import App from './App.svelte';

const DEC = new TextDecoder();

/** Parse a LuaDefinition from canonical-JSON bytes the resolver returns. */
function decodeDefinition(raw: unknown): LuaDefinition | undefined {
  if (!(raw instanceof Uint8Array)) return undefined;
  try {
    return JSON.parse(DEC.decode(raw)) as LuaDefinition;
  } catch {
    return undefined;
  }
}

// Register node types that live outside the core @yacad/dag registry so the
// main-thread DocSession can build / validate DAGs containing them. The worker
// registers the same set (plus full Lua runtime). The lua stub here is
// intentionally lenient — it skips definition-lookup so documents can be
// persisted before blobs are added to the session.
if (!getNodeType(IMPORT_STL_TYPE)) registerNodeType(IMPORT_STL_NODE_TYPE);
if (!getNodeType(IMPORT_OBJ_TYPE)) registerNodeType(IMPORT_OBJ_NODE_TYPE);
if (!getNodeType(IMPORT_GLTF_TYPE)) registerNodeType(IMPORT_GLTF_NODE_TYPE);

const LUA_STUB: ExpandableNodeType = {
  kind: 'expandable',
  type: 'lua',
  resolveOutput(params, resolver): GeometryType {
    // Read the LuaDefinition from the session resolver to learn the actual
    // declared output type. Falls back to '3d' if the definition isn't
    // loaded yet (e.g., during a partial seed) — better to be permissive on
    // the main thread; the worker validates authoritatively at eval time.
    const hash = (params as Record<string, unknown>)['definitionHash'];
    if (typeof hash !== 'string') return '3d';
    const def = decodeDefinition(resolver.get(hash));
    return def?.schema.output ?? '3d';
  },
  checkChildren() {
    // No structural constraint enforced on the main thread.
  },
  normalizeParams(params, _resolver, path) {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      throw new DagError('lua node params must be an object', path);
    }
    const record = params as Record<string, unknown>;
    if (typeof record['definitionHash'] !== 'string') {
      throw new DagError('"definitionHash" must be a string', path);
    }
    // Pass values through; worker performs the real normalisation.
    return { definitionHash: record['definitionHash'], values: record['values'] ?? {} };
  },
  inputNames() {
    return [];
  },
  async expand() {
    throw new Error('lua expand called on main thread — use the worker');
  },
};
if (!getNodeType('lua')) registerNodeType(LUA_STUB);

const params = new URLSearchParams(window.location.search);
const backendKind = params.get('backend') ?? 'indexeddb';
const viewerMode = backendKind === 'remote';

let vfs: Vfs;
if (backendKind === 'remote') {
  const ws = params.get('ws');
  if (!ws) throw new Error('?backend=remote requires &ws=ws://...');
  vfs = new RemoteVfs({ url: ws });
} else {
  vfs = new IndexedDbVfs();
}

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');
mount(App, { target: root, props: { vfs, viewerMode } });
