/**
 * Showcase: parametric castle
 *
 * Four corner towers, four curtain walls, battlemented parapets, and a gate.
 * Demonstrates Lua loops for repeating decorative geometry (crenellations).
 */

import type { DocLibrary } from '@yacad/doc-store';
import { canonicalBytes } from '@yacad/canonical';
import { defaultHasher } from '@yacad/hash';
import type { LuaDefinition } from '@yacad/lua';

// ─── LuaDefinition ───────────────────────────────────────────────────────────

export const CASTLE_DEFINITION: LuaDefinition = {
  schema: {
    inputs: [],
    params: {
      courtyardSize: { type: 'number', default: 20 },
      wallHeight: { type: 'number', default: 8 },
      wallThickness: { type: 'number', default: 2 },
      towerRadius: { type: 'number', default: 3 },
      towerHeight: { type: 'number', default: 12 },
      towerSegments: { type: 'int', default: 16, min: 6, max: 64 },
      crenellationCount: { type: 'int', default: 6, min: 1, max: 32 },
      merlonWidth: { type: 'number', default: 1.2 },
      crenellationHeight: { type: 'number', default: 1.5 },
      crenellationDepth: { type: 'number', default: 2 },
      gateWidth: { type: 'number', default: 3 },
      gateHeight: { type: 'number', default: 5 },
    },
    output: '3d',
  },
  code: `
-- ─── derived measurements ────────────────────────────────────────────────────
local half   = params.courtyardSize / 2 + params.wallThickness
local wt     = params.wallThickness
local wh     = params.wallHeight
local tr     = params.towerRadius
local th     = params.towerHeight
local seg    = params.towerSegments
local cc     = params.crenellationCount
local mw     = params.merlonWidth
local ch     = params.crenellationHeight
local cd     = params.crenellationDepth
local gw     = params.gateWidth
local gh     = params.gateHeight

-- ─── south wall with gate cutout ─────────────────────────────────────────────
-- Wall box: x from -half to +half, y from -half to -half+wt, z from 0 to wh
local south_wall_solid = geo.translate(
  { offset = {-half, -half, 0} },
  { geo.box({ size = {2 * half, wt, wh} }) }
)
-- Gate cutter: centred at x=0, front face at y=-half, oversized by 1 in Y
local gate_cutter = geo.translate(
  { offset = {-gw / 2, -half - 1, 0} },
  { geo.box({ size = {gw, wt + 2, gh} }) }
)
local south_wall = geo.difference({}, { south_wall_solid, gate_cutter })

-- ─── north wall ──────────────────────────────────────────────────────────────
local north_wall = geo.translate(
  { offset = {-half, half - wt, 0} },
  { geo.box({ size = {2 * half, wt, wh} }) }
)

-- ─── west wall ───────────────────────────────────────────────────────────────
local west_wall = geo.translate(
  { offset = {-half, -half, 0} },
  { geo.box({ size = {wt, 2 * half, wh} }) }
)

-- ─── east wall ───────────────────────────────────────────────────────────────
local east_wall = geo.translate(
  { offset = {half - wt, -half, 0} },
  { geo.box({ size = {wt, 2 * half, wh} }) }
)

-- ─── corner towers ───────────────────────────────────────────────────────────
local corner_coords = {
  { half,  half},
  {-half,  half},
  {-half, -half},
  { half, -half},
}
local towers = {}
for _, c in ipairs(corner_coords) do
  towers[#towers + 1] = geo.translate(
    { offset = {c[1], c[2], 0} },
    { geo.cylinder({ radius = tr, height = th, segments = seg, center = false }) }
  )
end

-- ─── battlements (merlons) ───────────────────────────────────────────────────
-- Merlons are additive boxes placed on top of each wall.
-- Wall length = 2*half; pitch = wall_length / cc
-- Merlon i (1-indexed) is centred at -half + pitch*(i-0.5) along the wall axis.
local pitch = (2 * half) / cc
local merlons = {}

-- South and north walls: merlons run along X, at y = -half or y = half-cd
for i = 1, cc do
  local cx = -half + pitch * (i - 0.5)
  -- south battlement (y = -half .. -half+cd)
  merlons[#merlons + 1] = geo.translate(
    { offset = {cx - mw / 2, -half, wh} },
    { geo.box({ size = {mw, cd, ch} }) }
  )
  -- north battlement (y = half-cd .. half)
  merlons[#merlons + 1] = geo.translate(
    { offset = {cx - mw / 2, half - cd, wh} },
    { geo.box({ size = {mw, cd, ch} }) }
  )
end

-- West and east walls: merlons run along Y, at x = -half or x = half-cd
for i = 1, cc do
  local cy = -half + pitch * (i - 0.5)
  -- west battlement (x = -half .. -half+cd)
  merlons[#merlons + 1] = geo.translate(
    { offset = {-half, cy - mw / 2, wh} },
    { geo.box({ size = {cd, mw, ch} }) }
  )
  -- east battlement (x = half-cd .. half)
  merlons[#merlons + 1] = geo.translate(
    { offset = {half - cd, cy - mw / 2, wh} },
    { geo.box({ size = {cd, mw, ch} }) }
  )
end

-- ─── assemble ────────────────────────────────────────────────────────────────
local all_parts = { south_wall, north_wall, west_wall, east_wall }
for _, t in ipairs(towers) do
  all_parts[#all_parts + 1] = t
end
for _, m in ipairs(merlons) do
  all_parts[#all_parts + 1] = m
end

return geo.union({}, all_parts)
`.trim(),
};

// ─── Seeder ───────────────────────────────────────────────────────────────────

/**
 * Seed the castle showcase document into `library`.
 *
 * Creates a single doc named "Showcase: parametric castle" using the default
 * parameter values. The LuaDefinition blob is persisted via `addBlob` so the
 * worker can resolve it on first open.
 */
export async function seedCastleShowcase(library: DocLibrary): Promise<void> {
  const defBytes = canonicalBytes(CASTLE_DEFINITION);
  const hash = await defaultHasher.hash(defBytes);

  const session = await library.create(
    'Showcase: parametric castle',
    {
      type: 'lua',
      params: {
        definitionHash: hash,
        values: {
          courtyardSize: 20,
          wallHeight: 8,
          wallThickness: 2,
          towerRadius: 3,
          towerHeight: 12,
          towerSegments: 16,
          crenellationCount: 6,
          merlonWidth: 1.2,
          crenellationHeight: 1.5,
          crenellationDepth: 2,
          gateWidth: 3,
          gateHeight: 5,
        },
      },
    },
    { skipValidation: true },
  );

  await session.addBlob(defBytes);
  await session.save();
  await session.close();
}
