import './app.css';
import { mount } from 'svelte';
import { registerNodeType, getNodeType, DagError, type ExpandableNodeType } from '@yacad/dag';
import { IMPORT_STL_NODE_TYPE, IMPORT_STL_TYPE } from '@yacad/import-stl';
import { IMPORT_OBJ_NODE_TYPE, IMPORT_OBJ_TYPE } from '@yacad/import-obj';
import { IMPORT_GLTF_NODE_TYPE, IMPORT_GLTF_TYPE } from '@yacad/import-gltf';
import App from './App.svelte';

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
  resolveOutput() {
    return '3d';
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

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');
mount(App, { target: root });
