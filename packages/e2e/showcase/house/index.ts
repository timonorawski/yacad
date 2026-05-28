import type { DocLibrary } from '@yacad/doc-store';
import { canonicalBytes } from '@yacad/canonical';
import { defaultHasher } from '@yacad/hash';
import type { LuaDefinition } from '@yacad/lua';

// ---------------------------------------------------------------------------
// LuaDefinition — the parametric house
// ---------------------------------------------------------------------------

/**
 * Parametric house: rectangular footprint, hollow walls with window and door
 * cutouts, gable roof. All boolean work is batched into a single
 * `geo.difference` call to keep chain depth at 1 and Manifold fast.
 */
export const HOUSE_DEFINITION: LuaDefinition = {
  schema: {
    inputs: [],
    params: {
      width: { type: 'number', default: 12 },
      depth: { type: 'number', default: 8 },
      floors: { type: 'int', default: 2, min: 1, max: 6 },
      floorHeight: { type: 'number', default: 3 },
      wallThickness: { type: 'number', default: 0.3 },
      windowsPerSide: { type: 'int', default: 3, min: 0, max: 8 },
      windowWidth: { type: 'number', default: 1.0 },
      windowHeight: { type: 'number', default: 1.2 },
      doorWidth: { type: 'number', default: 1.2 },
      doorHeight: { type: 'number', default: 2.2 },
      roofPitch: { type: 'number', default: 35 },
      roofOverhang: { type: 'number', default: 0.4 },
      segments: { type: 'int', default: 1, min: 1, max: 1 },
    },
    output: '3d',
  },
  code: `
-- ── Derived measurements ────────────────────────────────────────────────────
local W  = params.width
local D  = params.depth
local H  = params.floors * params.floorHeight
local wt = params.wallThickness

-- Ridge height from pitch angle and half-width
local ridge_h = (W / 2) * math.tan(params.roofPitch * math.pi / 180)

-- ── Outer wall box (full solid) ──────────────────────────────────────────────
local outer = geo.box({ size = {W, D, H} })

-- ── Inner void (hollow the shell) ───────────────────────────────────────────
-- Inset on X and Y by wallThickness; spans full interior height + small
-- epsilon so the top-face difference works cleanly.
local inner_w = W - 2 * wt
local inner_d = D - 2 * wt
local inner = geo.translate(
  { offset = {wt, wt, wt} },
  { geo.box({ size = {inner_w, inner_d, H} }) }
)

-- ── Door cutter (centred on front face, Y = 0) ───────────────────────────────
local door_x = (W - params.doorWidth) / 2
local door = geo.translate(
  { offset = {door_x, -wt * 0.5, 0} },
  { geo.box({ size = {params.doorWidth, wt * 2, params.doorHeight} }) }
)

-- ── Window cutters ────────────────────────────────────────────────────────────
-- Long walls (front Y≈0, back Y≈D): windowsPerSide windows per floor.
-- Short walls (left X≈0, right X≈W): 1 window per floor.
-- All cutters are collected and unioned, then subtracted in one operation.

local ww = params.windowWidth
local wh = params.windowHeight
local cutters = {}

for floor = 1, params.floors do
  local z_center = (floor - 1) * params.floorHeight + params.floorHeight * 0.6

  -- ── Long walls: front (y ≈ 0) and back (y ≈ D) ──────────────────────────
  if params.windowsPerSide > 0 then
    local spacing = W / (params.windowsPerSide + 1)
    for i = 1, params.windowsPerSide do
      local x_center = i * spacing

      -- Front wall (y = 0 face): cutter punches through wallThickness in Y
      cutters[#cutters + 1] = geo.translate(
        { offset = {x_center - ww / 2, -wt * 0.5, z_center - wh / 2} },
        { geo.box({ size = {ww, wt * 2, wh} }) }
      )

      -- Back wall (y = D face)
      cutters[#cutters + 1] = geo.translate(
        { offset = {x_center - ww / 2, D - wt * 0.5, z_center - wh / 2} },
        { geo.box({ size = {ww, wt * 2, wh} }) }
      )
    end
  end

  -- ── Short walls: left (x = 0) and right (x = W), one window each ─────────
  local y_center = D / 2

  -- Left wall (x = 0 face)
  cutters[#cutters + 1] = geo.translate(
    { offset = {-wt * 0.5, y_center - ww / 2, z_center - wh / 2} },
    { geo.box({ size = {wt * 2, ww, wh} }) }
  )

  -- Right wall (x = W face)
  cutters[#cutters + 1] = geo.translate(
    { offset = {W - wt * 0.5, y_center - ww / 2, z_center - wh / 2} },
    { geo.box({ size = {wt * 2, ww, wh} }) }
  )
end

-- ── Single boolean: outer minus (inner + door + all windows) ─────────────────
-- Batch all cutters so Manifold sees O(1) boolean depth.
local all_cutters = {inner, door}
for _, c in ipairs(cutters) do
  all_cutters[#all_cutters + 1] = c
end

local shell_operands = {outer}
for _, c in ipairs(all_cutters) do
  shell_operands[#shell_operands + 1] = c
end

local shell = geo.difference({}, shell_operands)

-- ── Roof (gable / triangular prism) ──────────────────────────────────────────
-- The gable cross-section is a triangle in the XZ plane, extruded along Y.
-- Ridge is centred on X = W/2.
-- Overhang extends the roof beyond the wall box on all sides.

local ov = params.roofOverhang
local roof_span = W + 2 * ov          -- total base width including overhang
local roof_depth = D + 2 * ov         -- total extrusion depth including overhang

-- Triangle: CCW winding in XZ, defined in 2D as (x, z):
--   bottom-left (-ov, 0),  bottom-right (W + ov, 0),  ridge (W/2, ridge_h)
local gable_pts = {
  {0,       0},
  {roof_span, 0},
  {roof_span / 2, ridge_h},
}

local gable_2d = geo.polygon({ points = gable_pts })
local roof_prism = geo.extrude({ height = roof_depth }, { gable_2d })

-- Rotate +90° around X so the gable's ridge points up (+Z) and the prism's
-- length runs along Y. With -90° the ridge ends up at -Z (roof faces down).
-- Map under +90° X-rotation: (x, y, z) → (x, -z, y).
local roof = geo.rotate(
  { angles = {90, 0, 0} },
  { roof_prism }
)
-- After rotation:
--   X: 0 .. roof_span        (cross-section width, ridge at X = roof_span/2)
--   Y: 0 .. -roof_depth      (extrusion now runs in -Y)
--   Z: 0 .. ridge_h          (ridge up)
-- Translate so the roof sits on the walls with the right overhang:
--   X: left eave at -ov   → offset X by -ov
--   Y: front eave at -ov  → offset Y by D + ov  (compensates for -Y extrusion)
--   Z: base at H          → offset Z by H
roof = geo.translate(
  { offset = {-ov, D + ov, H} },
  { roof }
)

-- ── Combine ───────────────────────────────────────────────────────────────────
return geo.union({}, {shell, roof})
`,
};

// ---------------------------------------------------------------------------
// seedHouseShowcase
// ---------------------------------------------------------------------------

/**
 * Creates a "Showcase: parametric house" document in the given DocLibrary.
 * Idempotent in the sense that calling it adds one document each time — the
 * caller is responsible for deduplication (same pattern as other seed functions
 * in this codebase).
 */
export async function seedHouseShowcase(library: DocLibrary): Promise<void> {
  const defBytes = canonicalBytes(HOUSE_DEFINITION);
  const hash = await defaultHasher.hash(defBytes);

  const doc = {
    type: 'lua' as const,
    params: {
      definitionHash: hash,
      values: {
        width: 12,
        depth: 8,
        floors: 2,
        floorHeight: 3,
        wallThickness: 0.3,
        windowsPerSide: 3,
        windowWidth: 1.0,
        windowHeight: 1.2,
        doorWidth: 1.2,
        doorHeight: 2.2,
        roofPitch: 35,
        roofOverhang: 0.4,
        segments: 1,
      },
    },
  };

  // Skip validation: the blob is not yet in the resolver at create time.
  // addBlob() below persists it before the session is closed.
  const session = await library.create('Showcase: parametric house', doc, {
    skipValidation: true,
  });
  await session.addBlob(defBytes);
  await session.save();
  await session.close();
}
