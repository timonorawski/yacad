import type { LuaDefinition } from '@yacad/lua';

/**
 * Procedural gear: a union of `teeth` cylinders rotated evenly around a ring
 * of radius `radius`. Shared by the lua-gear E2E scene and the chunk-5 perf
 * bench (constraint 6 — single canonical definition, no duplication).
 */
export const GEAR_DEFINITION: LuaDefinition = {
  schema: {
    inputs: [],
    params: {
      teeth: { type: 'int', default: 8, min: 3, max: 64 },
      radius: { type: 'number', default: 5.0 },
    },
    output: '3d',
  },
  code: [
    'local parts = {}',
    'for i = 1, params.teeth do',
    '  local angle = (i - 1) * 360 / params.teeth',
    '  parts[#parts + 1] = geo.rotate({angles = {0, 0, angle}}, {',
    '    geo.translate({offset = {params.radius, 0, 0}}, {',
    '      geo.cylinder({radius = 0.5, height = 1.0, center = true})',
    '    })',
    '  })',
    'end',
    'return geo.union({}, parts)',
  ].join('\n'),
};

/**
 * Procedural flower: alternating outer/inner radii produce `petals` petal-points
 * as a 2D polygon. Output is 2D — compose with an `extrude` node for 3D.
 * Shared by the lua-2d-flower E2E scene and the studio's Lua flower sample scene.
 */
export const FLOWER_DEFINITION: LuaDefinition = {
  schema: {
    inputs: [],
    params: {
      petals: { type: 'int', default: 6, min: 3, max: 16 },
      innerRadius: { type: 'number', default: 4 },
      outerRadius: { type: 'number', default: 10 },
    },
    output: '2d',
  },
  code: [
    'local pts = {}',
    'local total = params.petals * 2',
    'for i = 0, total - 1 do',
    '  local angle = (i / total) * 2 * math.pi',
    '  local r = (i % 2 == 0) and params.outerRadius or params.innerRadius',
    '  pts[#pts + 1] = { r * math.cos(angle), r * math.sin(angle) }',
    'end',
    'return geo.polygon({ points = pts })',
  ].join('\n'),
};

/**
 * Array-along-X: repeats a child body `count` times along the X axis with
 * `spacing` between each copy. Shared by the lua-with-input E2E scene and the
 * studio's "lua-array-of-spheres" sample scene.
 */
export const ARRAY_ALONG_X_DEFINITION: LuaDefinition = {
  schema: {
    inputs: [{ name: 'body', type: '3d' }],
    params: {
      count: { type: 'int', default: 3, min: 1, max: 16 },
      spacing: { type: 'number', default: 3.0 },
    },
    output: '3d',
  },
  code: [
    'local parts = {}',
    'for i = 1, params.count do',
    '  parts[#parts + 1] = geo.translate({offset = {(i - 1) * params.spacing, 0, 0}}, { inputs.body })',
    'end',
    'return geo.union({}, parts)',
  ].join('\n'),
};
