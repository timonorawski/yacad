/**
 * Showcase (exploratory): chamfered box via boolean decomposition.
 *
 * Demonstrates that a chamfered cuboid is just `difference(box, union(wedges))`
 * — one right-triangular prism per edge, twelve in total — with no BREP kernel
 * required. The wedge geometry is computed analytically from the box dimensions
 * inside the Lua expansion; the kernel sees pure primitives + transforms +
 * booleans.
 *
 * Tests the architectural claim in
 * `docs/superpowers/specs/2026-05-29-fillet-chamfer-decomposition-design.md`:
 * for known-edge bodies, BREP fillet/chamfer reduces to existing Manifold ops.
 *
 * ## Construction
 *
 * For each of the 12 box edges we build a right-triangular prism whose
 * right-angle apex sits on the edge, with the two legs of length `c` extending
 * along the two adjacent faces. The hypotenuse becomes the chamfered face
 * after subtraction.
 *
 * The construction trick: `geo.polygon` is always in the XY plane and
 * `geo.extrude` always extrudes along Z. To place a wedge on an edge with
 * arbitrary axis we (a) pre-compute the triangle's 2D corners so that, after
 * a single rotation aligning Z with the edge axis, the legs point in the
 * desired world directions, then (b) rotate + translate the prism into place.
 *
 * For the four X-aligned edges: rotate the prism +90° around Y, which sends
 * the canonical (a, b, 0) plane → (0, b, -a). So a triangle corner (c, 0) in
 * the pre-rotation plane lands on world -Z, and (0, c) lands on world +Y.
 *
 * For the four Y-aligned edges: rotate the prism -90° around X, which sends
 * (a, b, 0) → (a, 0, b). Pre-rotation (c, 0) → world +X; (0, c) → world +Z.
 *
 * The four Z-aligned (vertical) edges need no axis-realigning rotation — only
 * a rotZ to point the legs at the right corner.
 */
import { canonicalBytes } from '@yacad/canonical';
import type { NodeDoc } from '@yacad/dag';
import type { DocLibrary } from '@yacad/doc-store';
import { defaultHasher } from '@yacad/hash';
import type { LuaDefinition } from '@yacad/lua';

export const CHAMFERED_BOX_DEFINITION: LuaDefinition = {
  schema: {
    inputs: [],
    params: {
      width: { type: 'number', default: 50 },
      depth: { type: 'number', default: 50 },
      height: { type: 'number', default: 50 },
      chamfer: { type: 'number', default: 5 },
    },
    output: '3d',
  },
  code: [
    'local hw = params.width / 2',
    'local hd = params.depth / 2',
    'local hh = params.height / 2',
    'local c = params.chamfer',
    '',
    '-- The body. geo.box is centered at the origin.',
    'local body = geo.box({ size = { params.width, params.depth, params.height } })',
    '',
    '-- Build a wedge from explicit pre-rotation triangle corners + a single',
    '-- rotation that aligns the prism Z axis with the edge axis. geo.extrude has',
    '-- no `center` option so the extrusion lives in z ∈ [0, edgeLen]; we shift',
    '-- it by -edgeLen/2 before rotation so the post-rotation midpoint maps to',
    '-- the edge midpoint after the final translate.',
    'local function wedge(triPoints, edgeLen, rx, ry, rz)',
    '  local tri = geo.polygon({ points = triPoints })',
    '  local prism = geo.extrude({ height = edgeLen }, { tri })',
    '  local centered = geo.translate({ offset = { 0, 0, -edgeLen / 2 } }, { prism })',
    '  return geo.rotate({ angles = { rx, ry, rz } }, { centered })',
    'end',
    '',
    'local cuts = {}',
    '',
    '-- 4 vertical edges (Z-aligned). Canonical pre-rotation triangle (0,0),(c,0),(0,c)',
    "-- has legs in world +X and +Y. rotZ by the corner's angle aims the legs",
    '-- inward toward the box center.',
    'local vertical = {',
    '  { x = -hw, y = -hd, rz =   0 }, -- legs +X +Y',
    '  { x =  hw, y = -hd, rz =  90 }, -- legs -X +Y (was +X) etc.',
    '  { x =  hw, y =  hd, rz = 180 },',
    '  { x = -hw, y =  hd, rz = 270 },',
    '}',
    'for i = 1, #vertical do',
    '  local v = vertical[i]',
    '  local w = wedge({ { 0, 0 }, { c, 0 }, { 0, c } }, params.height, 0, 0, v.rz)',
    '  cuts[#cuts + 1] = geo.translate({ offset = { v.x, v.y, 0 } }, { w })',
    'end',
    '',
    '-- 4 X-aligned top/bottom edges. Rotation rotY(+90°) sends pre-rotation',
    '-- (a, b, 0) → world (0, b, -a). So a pre-rotation corner at (c, 0) lands',
    '-- on world -Z (the inward direction for a top edge), and (0, c) lands on',
    '-- world +Y, (0, -c) on -Y. Pre-rotation (-c, 0) lands on world +Z (inward',
    '-- for a bottom edge).',
    '--',
    '-- Triangle corner order must be CCW in the canonical XY plane — Manifold',
    '-- treats CW outer boundaries as holes-without-outers and emits an empty',
    '-- CrossSection that breaks downstream extrude.',
    'local xEdges = {',
    '  -- top-front (y=+hd, z=+hh): legs -Z, -Y',
    '  { tri = { { 0, 0 }, { 0, -c }, { c,  0 } }, y =  hd, z =  hh },',
    '  -- top-back  (y=-hd, z=+hh): legs -Z, +Y',
    '  { tri = { { 0, 0 }, { c,  0 }, { 0,  c } }, y = -hd, z =  hh },',
    '  -- bot-front (y=+hd, z=-hh): legs +Z, -Y',
    '  { tri = { { 0, 0 }, {-c,  0 }, { 0, -c } }, y =  hd, z = -hh },',
    '  -- bot-back  (y=-hd, z=-hh): legs +Z, +Y',
    '  { tri = { { 0, 0 }, { 0,  c }, {-c,  0 } }, y = -hd, z = -hh },',
    '}',
    'for i = 1, #xEdges do',
    '  local e = xEdges[i]',
    '  local w = wedge(e.tri, params.width, 0, 90, 0)',
    '  cuts[#cuts + 1] = geo.translate({ offset = { 0, e.y, e.z } }, { w })',
    'end',
    '',
    '-- 4 Y-aligned top/bottom edges. Rotation rotX(-90°) sends (a, b, 0) →',
    '-- (a, 0, b). Pre-rotation (c, 0) → world +X; (0, c) → world +Z;',
    '-- (-c, 0) → -X; (0, -c) → -Z. Same CCW caveat as above.',
    'local yEdges = {',
    '  -- top-right (x=+hw, z=+hh): legs -X, -Z',
    '  { tri = { { 0, 0 }, {-c,  0 }, { 0, -c } }, x =  hw, z =  hh },',
    '  -- top-left  (x=-hw, z=+hh): legs +X, -Z',
    '  { tri = { { 0, 0 }, { 0, -c }, { c,  0 } }, x = -hw, z =  hh },',
    '  -- bot-right (x=+hw, z=-hh): legs -X, +Z',
    '  { tri = { { 0, 0 }, { 0,  c }, {-c,  0 } }, x =  hw, z = -hh },',
    '  -- bot-left  (x=-hw, z=-hh): legs +X, +Z',
    '  { tri = { { 0, 0 }, { c,  0 }, { 0,  c } }, x = -hw, z = -hh },',
    '}',
    'for i = 1, #yEdges do',
    '  local e = yEdges[i]',
    '  local w = wedge(e.tri, params.depth, -90, 0, 0)',
    '  cuts[#cuts + 1] = geo.translate({ offset = { e.x, 0, e.z } }, { w })',
    'end',
    '',
    'return geo.difference({}, { body, geo.union({}, cuts) })',
  ].join('\n'),
};

/**
 * Seed a chamfered-box scene into the supplied library. Prefixed "Exploratory:"
 * in the picker so its experimental status is visible.
 */
export async function seedChamferedBoxShowcase(library: DocLibrary): Promise<void> {
  const defBytes = canonicalBytes(CHAMFERED_BOX_DEFINITION);
  const defHash = await defaultHasher.hash(defBytes);
  const doc: NodeDoc = {
    type: 'lua',
    params: {
      definitionHash: defHash,
      values: {
        width: 50,
        depth: 50,
        height: 50,
        chamfer: 5,
      },
    },
  };
  const session = await library.create('Exploratory: chamfered box (boolean decomposition)', doc, {
    skipValidation: true,
  });
  await session.addBlob(defBytes);
  await session.save();
  await session.close();
}
