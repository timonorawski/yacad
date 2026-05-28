import {
  getKernelTypeDoc,
  getNodeType,
  listNodeTypes,
  type KernelTypeDocSummary,
  type ParamDoc,
} from '@yacad/dag';

/**
 * Per-type documentation descriptors for every kernel-backed node type.
 * The studio v1 Lua API docs panel is generated from this map. Spec 2 split
 * the documentation: type-system-level docs (summary/outputDoc/paramSchema)
 * live in @yacad/dag's registry; the Lua-specific source-snippet `example`
 * stays here as a per-type map. KERNEL_TYPE_DOCS is the join.
 *
 * Re-exported types and the export shape are preserved for backwards
 * compatibility with v1's Lua-docs panel and any external readers.
 */

export type { ParamDoc };

export interface KernelTypeDoc extends KernelTypeDocSummary {
  readonly type: string;
  readonly example: string;
}

/**
 * Lua source examples per kernel type. Adding a new kernel type requires both
 * a registry entry (in @yacad/dag) AND an example here.
 */
const EXAMPLES: Record<string, string> = {
  box: 'return geo.box({ size = {20, 20, 20}, center = true })',
  sphere: 'return geo.sphere({ radius = 10, segments = 48 })',
  cylinder: 'return geo.cylinder({ height = 30, radius = 8, segments = 64, center = true })',
  translate: 'return geo.translate({ offset = {15, 0, 0} }, { geo.box({ size = {10, 10, 10} }) })',
  rotate:
    'return geo.rotate({ angles = {0, 90, 0} }, { geo.cylinder({ height = 30, radius = 6 }) })',
  union: 'return geo.union({}, { geo.box({ size = {10, 10, 10} }), geo.sphere({ radius = 6 }) })',
  difference:
    'return geo.difference({}, { geo.box({ size = {30, 30, 30}, center = true }), geo.sphere({ radius = 19 }) })',
  intersection:
    'return geo.intersection({}, { geo.box({ size = {10, 10, 10}, center = true }), geo.sphere({ radius = 6 }) })',
  hull: 'return geo.hull({}, { geo.circle({ radius = 1 }), geo.translate_2d({ offset = {10, 0} }, { geo.circle({ radius = 1 }) }) })',
  circle: 'return geo.circle({ radius = 5, segments = 48 })',
  rectangle: 'return geo.rectangle({ size = {10, 20}, center = true })',
  polygon: 'return geo.polygon({ points = { {0,0}, {10,0}, {5,10} } })',
  spline:
    'return geo.spline({ points = { {10,0}, {3,3}, {0,10}, {-3,3}, {-10,0}, {-3,-3}, {0,-10}, {3,-3} } })',
  extrude: 'return geo.extrude({ height = 10 }, { geo.circle({ radius = 5 }) })',
  revolve:
    'return geo.revolve({ axis = "y" }, { geo.polygon({ points = { {3,0}, {4,5}, {0,5} } }) })',
  section:
    'return geo.section({ origin = {0, 0, 0}, normal = {0, 0, 1} }, { geo.box({ size = {20, 20, 20}, center = true }) })',
  translate_2d: 'return geo.translate_2d({ offset = {5, 0} }, { geo.circle({ radius = 1 }) })',
  rotate_2d: 'return geo.rotate_2d({ angle = 45 }, { geo.rectangle({ size = {2, 1} }) })',
  refine: 'return geo.refine({ n = 2 }, { geo.box({ size = {1, 1, 1} }) })',
  offset_2d:
    'return geo.offset_2d({ delta = 2, joinType = "round" }, { geo.rectangle({ size = {10, 10}, center = true }) })',
  warp: `-- Bend a cylinder by shifting Z proportional to X.
return geo.warp(
  { code = 'return x, y, z + params.k * x', values = { k = 0.2 } },
  { geo.cylinder({ height = 20, radius = 5, center = true }) }
)`,
};

/**
 * Build the derived KERNEL_TYPE_DOCS array by joining the registry's
 * type-system-level docs with the local example map. Filters to kernel-kind
 * node types only.
 */
function buildKernelTypeDocs(): readonly KernelTypeDoc[] {
  const docs: KernelTypeDoc[] = [];
  for (const meta of listNodeTypes()) {
    const def = getNodeType(meta.type);
    if (!def || def.kind !== 'kernel') continue;
    const summary = getKernelTypeDoc(meta.type);
    if (!summary) continue;
    const example = EXAMPLES[meta.type] ?? '';
    docs.push({
      type: meta.type,
      summary: summary.summary,
      outputDoc: summary.outputDoc,
      paramSchema: summary.paramSchema,
      example,
    });
  }
  return docs;
}

export const KERNEL_TYPE_DOCS: readonly KernelTypeDoc[] = buildKernelTypeDocs();
