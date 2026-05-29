/**
 * Showcase (exploratory): filleted slab via offset_2d + extrude + warp.
 *
 * Stage A — XY corner fillets via `offset_2d(round)`:
 *
 *   rectangle(W, D)  →  offset_2d(-rc, round)  →  offset_2d(+rc, round)
 *                                                       │
 *                                                       ▼
 *                                                  extrude(h)
 *
 *   The −r/+r pair with round joins is the canonical 2D corner-rounding trick.
 *   The vertical edges of the resulting slab become quarter-cylinder fillets.
 *
 * Stage B — Z edge fillets via `warp` (only when edgeRadius > 0):
 *
 *   For each vertex (x, y, z) within `edgeRadius` of the top or bottom face,
 *   project radially in the (dz, -d_xy) plane onto the rolling-ball fillet
 *   surface, where d_xy is the signed perpendicular distance from the
 *   rounded-rect XY profile (negative inside).
 *
 * Together these decompose a fully-filleted slab into pure compositions of
 * existing Manifold-backed ops. No BREP required for this known-edge case.
 *
 * Spec: `docs/superpowers/specs/2026-05-29-fillet-chamfer-decomposition-design.md`.
 */
import { canonicalBytes } from '@yacad/canonical';
import type { NodeDoc } from '@yacad/dag';
import type { DocLibrary } from '@yacad/doc-store';
import { defaultHasher } from '@yacad/hash';
import type { LuaDefinition } from '@yacad/lua';

export const FILLETED_SLAB_DEFINITION: LuaDefinition = {
  schema: {
    inputs: [],
    params: {
      width: { type: 'number', default: 60 },
      depth: { type: 'number', default: 40 },
      height: { type: 'number', default: 20 },
      cornerRadius: { type: 'number', default: 8 },
      edgeRadius: { type: 'number', default: 3 },
    },
    output: '3d',
  },
  code: [
    '-- Stage A: build the slab with XY corner fillets via offset_2d round-trip.',
    'local rect = geo.rectangle({ size = { params.width, params.depth } })',
    "local shrunk = geo.offset_2d({ delta = -params.cornerRadius, joinType = 'round' }, { rect })",
    "local rounded = geo.offset_2d({ delta = params.cornerRadius, joinType = 'round' }, { shrunk })",
    'local slab = geo.extrude({ height = params.height }, { rounded })',
    '',
    '-- Stage B: round the top + bottom Z edges via a rolling-ball warp.',
    '-- Skipped when edgeRadius is zero — the slab is already shipped.',
    'if params.edgeRadius <= 0 then',
    '  return slab',
    'end',
    '',
    "-- The warp's per-vertex callback. Pure function of (x, y, z) + params.values.",
    '-- See spec § Architecture / Scene 2 for the geometric derivation.',
    'local warp_code = [[',
    '  local r  = params.edgeRadius',
    '  local h  = params.height',
    '  local hw = params.width / 2',
    '  local hd = params.depth / 2',
    '  local rc = params.cornerRadius',
    '',
    '  -- Distance to nearest horizontal face. Slab extrudes from z=0 to z=h.',
    '  local dz_top = h - z',
    '  local dz_bot = z',
    '  local dz, top',
    '  if dz_top < dz_bot then',
    '    dz  = dz_top',
    '    top = true',
    '  else',
    '    dz  = dz_bot',
    '    top = false',
    '  end',
    '',
    '  -- Bail out early if not near a horizontal face.',
    '  if dz >= r then return x, y, z end',
    '',
    '  -- Compute signed distance from the rounded-rect XY profile (d_xy negative',
    '  -- inside) AND the outward unit normal at the nearest outline point.',
    '  local ax  = math.abs(x)',
    '  local ay  = math.abs(y)',
    '  local sx  = (x >= 0) and 1 or -1',
    '  local sy  = (y >= 0) and 1 or -1',
    '  local d_xy, nx_abs, ny_abs',
    '',
    "  -- The rounded-rect's four straight strips and four corner arcs decompose",
    '  -- by quadrant via (ax, ay). Boundaries: ax = hw - rc, ay = hd - rc.',
    '  if ax > hw - rc and ay > hd - rc then',
    '    -- Corner-arc zone: arc center at (hw-rc, hd-rc) (abs coords), radius rc.',
    '    local cx = hw - rc',
    '    local cy = hd - rc',
    '    local vx = ax - cx',
    '    local vy = ay - cy',
    '    local len = math.sqrt(vx * vx + vy * vy)',
    '    if len < 1e-9 then',
    '      d_xy = -rc',
    '      nx_abs, ny_abs = 1, 0',
    '    else',
    '      d_xy = len - rc',
    '      nx_abs = vx / len',
    '      ny_abs = vy / len',
    '    end',
    '  elseif ax > hw - rc then',
    '    -- X-face strip: nearest outline point is (hw, ay); normal points along +X.',
    '    d_xy = ax - hw',
    '    nx_abs, ny_abs = 1, 0',
    '  elseif ay > hd - rc then',
    '    -- Y-face strip: nearest outline point (ax, hd); normal +Y.',
    '    d_xy = ay - hd',
    '    nx_abs, ny_abs = 0, 1',
    '  else',
    '    -- Deep interior: nearest outline point is on whichever strip is closer.',
    '    if hd - ay < hw - ax then',
    '      d_xy = ay - hd',
    '      nx_abs, ny_abs = 0, 1',
    '    else',
    '      d_xy = ax - hw',
    '      nx_abs, ny_abs = 1, 0',
    '    end',
    '  end',
    '',
    "  -- Outside the outline shouldn't happen for surface vertices of an extruded",
    '  -- closed profile, but guard anyway. Skip vertices that are deeper than r',
    '  -- from the outline.',
    '  if d_xy >= 0 or -d_xy >= r then return x, y, z end',
    '',
    '  -- Real-coordinate outward normal.',
    '  local nx = sx * nx_abs',
    '  local ny = sy * ny_abs',
    '',
    '  -- Local fillet coordinates: (s, t) = (dz, -d_xy), both in [0, r].',
    '  local s = dz',
    '  local t = -d_xy',
    '',
    '  -- Project (s, t) radially from the fillet center (r, r) onto the fillet',
    '  -- circle (s-r)² + (t-r)² = r².',
    '  local vs = s - r',
    '  local vt = t - r',
    '  local vlen = math.sqrt(vs * vs + vt * vt)',
    '  if vlen < 1e-9 then return x, y, z end',
    '  local new_s = r + (vs / vlen) * r',
    '  local new_t = r + (vt / vlen) * r',
    '',
    '  -- Translate back to world coordinates. The change in t is the inward push;',
    '  -- the change in s is the change in distance to the nearest horizontal face.',
    '  local delta_t = new_t - t',
    '  local nxw = x - delta_t * nx',
    '  local nyw = y - delta_t * ny',
    '  local nz',
    '  if top then',
    '    nz = h - new_s',
    '  else',
    '    nz = new_s',
    '  end',
    '  return nxw, nyw, nz',
    ']]',
    '',
    'return geo.warp(',
    '  {',
    '    code = warp_code,',
    '    values = {',
    '      edgeRadius = params.edgeRadius,',
    '      height = params.height,',
    '      width = params.width,',
    '      depth = params.depth,',
    '      cornerRadius = params.cornerRadius,',
    '    },',
    '  },',
    '  { slab }',
    ')',
  ].join('\n'),
};

/**
 * Seed a filleted-slab scene into the supplied library. Prefixed "Exploratory:"
 * in the picker so its experimental status is visible.
 */
export async function seedFilletedSlabShowcase(library: DocLibrary): Promise<void> {
  const defBytes = canonicalBytes(FILLETED_SLAB_DEFINITION);
  const defHash = await defaultHasher.hash(defBytes);
  const doc: NodeDoc = {
    type: 'lua',
    params: {
      definitionHash: defHash,
      values: {
        width: 60,
        depth: 40,
        height: 20,
        cornerRadius: 8,
        edgeRadius: 3,
      },
    },
  };
  const session = await library.create('Exploratory: filleted slab (offset + warp)', doc, {
    skipValidation: true,
  });
  await session.addBlob(defBytes);
  await session.save();
  await session.close();
}
