import { getNodeType, listNodeTypes, type NodeDoc } from '@yacad/dag';

/** Wrapper functions for known kernel node types, keyed by type name. */
export type GeoWrappers = Record<
  string,
  (params?: Record<string, unknown>, children?: NodeDoc[]) => NodeDoc
>;

export type GeoApi = GeoWrappers & {
  node: (type: string, params?: Record<string, unknown>, children?: NodeDoc[]) => NodeDoc;
};

export function buildGeoApi(): GeoApi {
  function node(
    type: string,
    params: Record<string, unknown> = {},
    children: NodeDoc[] = [],
  ): NodeDoc {
    if (type.startsWith('__')) {
      throw new Error(`reserved node type "${type}" cannot be constructed via geo`);
    }
    const def = getNodeType(type);
    if (!def) throw new Error(`unknown node type "${type}"`);
    if (def.kind === 'expandable') {
      throw new Error(`cannot construct expandable node "${type}" from Lua (v1 restriction)`);
    }
    return { type, params, children };
  }

  const api: GeoApi = { node } as GeoApi;
  for (const { type } of listNodeTypes()) {
    if (type.startsWith('__')) continue;
    const def = getNodeType(type);
    if (!def) continue;
    if (def.kind === 'expandable') continue;
    // Kernel and decoder types are both constructible via geo.
    // Decoder types (import-stl, import-obj, import-gltf) use a hyphenated
    // type string; expose them in Lua with underscores so they are valid
    // Lua identifiers (e.g. geo.import_gltf).
    const luaKey = type.replace(/-/g, '_');
    api[luaKey] = (params, children) => node(type, params, children);
  }
  return api;
}
