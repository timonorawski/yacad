import { getNodeType, listNodeTypes, type NodeDoc } from '@yacad/dag';

export type GeoApi = {
  node: (type: string, params?: Record<string, unknown>, children?: NodeDoc[]) => NodeDoc;
  [wrapper: string]: (params?: Record<string, unknown>, children?: NodeDoc[]) => NodeDoc;
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
    if (def?.kind !== 'kernel') continue;
    api[type] = (params, children) => node(type, params, children);
  }
  return api;
}
