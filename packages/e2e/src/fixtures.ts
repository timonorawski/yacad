import type { LuaDefinition } from '@yacad/lua';

/**
 * Procedural involute spur gear.
 *
 * Generates a real spur gear from standard gear-design parameters: tooth count,
 * `module` (pitch-diameter / teeth), pressure angle, face width, and optional
 * arbor (center-bore) radius. The 2D tooth profile is built as a single closed
 * polygon walking the outline once: for each tooth the path traces a root
 * (dedendum) arc gap, a right-flank involute curve from base/root radius up to
 * the addendum, a short addendum arc, and a mirrored left-flank involute back
 * down. The polygon is then extruded to `thickness`; if `arbor > 0` a center
 * cylinder is subtracted for the shaft bore.
 *
 * Conventions follow standard involute spur-gear math:
 *   pitch radius     r_p = teeth * module / 2
 *   base radius      r_b = r_p * cos(pressure_angle)
 *   addendum radius  r_a = r_p + module                  (tooth tip)
 *   dedendum radius  r_d = max(eps, r_p - 1.25 * module) (tooth root)
 *   tooth angular thickness at pitch circle = pi / teeth
 *
 * Shared by the lua-gear E2E scene and the chunk-5 perf bench
 * (constraint 6 — single canonical definition, no duplication).
 */
export const GEAR_DEFINITION: LuaDefinition = {
  schema: {
    inputs: [],
    params: {
      teeth: { type: 'int', default: 18, min: 8, max: 96 },
      module: { type: 'number', default: 1.0 },
      pressureAngle: { type: 'number', default: 20 },
      thickness: { type: 'number', default: 4 },
      arbor: { type: 'number', default: 2 },
      samplesPerFlank: { type: 'int', default: 6, min: 3, max: 20 },
    },
    output: '3d',
  },
  code: [
    '-- Involute spur gear: walk the 2D outline once, then extrude.',
    'local teeth = params.teeth',
    'local m = params.module',
    'local pa = params.pressureAngle * math.pi / 180',
    'local thickness = params.thickness',
    'local arbor = params.arbor',
    'local samples = params.samplesPerFlank',
    '',
    '-- Defensive parameter checks (in addition to schema bounds).',
    'if not (m > 0) then error("module must be > 0") end',
    'if not (thickness > 0) then error("thickness must be > 0") end',
    'if not (pa > 0 and pa < math.pi / 2) then error("pressureAngle must be in (0, 90)") end',
    '',
    '-- Standard radii.',
    'local rp = teeth * m / 2',
    'local rb = rp * math.cos(pa)',
    'local ra = rp + m',
    'local rd = rp - 1.25 * m',
    'if rd < 0.01 then rd = 0.01 end',
    '',
    '-- Tooth flank lives between r_flank_start and r_flank_end.',
    '-- If the base circle is below the dedendum (typical), the involute starts at the root;',
    '-- otherwise it starts at the base circle and a short radial segment fills the gap.',
    'local r_flank_start = rb',
    'if rd > rb then r_flank_start = rd end',
    'local r_flank_end = ra',
    '',
    '-- Involute angle at radius r (>= rb): inv(alpha) = tan(alpha) - alpha where cos(alpha)=rb/r.',
    'local function inv_at_r(r)',
    '  if r <= rb then return 0 end',
    '  local alpha = math.acos(rb / r)',
    '  return math.tan(alpha) - alpha',
    'end',
    '',
    'local inv_p = inv_at_r(rp)',
    'local inv_a = inv_at_r(ra)',
    'local inv_start = inv_at_r(r_flank_start)',
    '',
    '-- Half tooth angular thickness at the pitch circle.',
    'local half_tooth = math.pi / (2 * teeth)',
    'local tooth_pitch = 2 * math.pi / teeth',
    '',
    '-- Right-flank angle at radius r (tooth centered on angle 0):',
    '--   theta_r(r) = -half_tooth - inv_p + inv_at_r(r)',
    '-- At r = rp this gives -half_tooth (correct: pitch point on tooth right side).',
    '-- Left flank is the mirror.',
    '',
    'local pts = {}',
    'local function push(r, ang)',
    '  pts[#pts + 1] = { r * math.cos(ang), r * math.sin(ang) }',
    'end',
    '',
    'local root_samples = 2  -- intermediate root-arc points between adjacent teeth',
    'local addendum_samples = 1  -- intermediate point on the tooth-tip arc',
    '',
    'for i = 0, teeth - 1 do',
    '  local center = i * tooth_pitch',
    '',
    '  -- (a) Root arc into this tooth: from prev tooth left-flank end to this tooth right-flank start.',
    '  local prev_left_end = (i - 1) * tooth_pitch + half_tooth + inv_p - inv_start',
    '  local right_start = center - half_tooth - inv_p + inv_start',
    '  for k = 1, root_samples do',
    '    local t = k / (root_samples + 1)',
    '    local ang = prev_left_end + t * (right_start - prev_left_end)',
    '    push(r_flank_start, ang)',
    '  end',
    '',
    '  -- (b) Right flank: r from r_flank_start up to r_flank_end (samples points inclusive).',
    '  for k = 0, samples - 1 do',
    '    local t = k / (samples - 1)',
    '    local r = r_flank_start + t * (r_flank_end - r_flank_start)',
    '    local ang = center - half_tooth - inv_p + inv_at_r(r)',
    '    push(r, ang)',
    '  end',
    '',
    '  -- (c) Addendum arc: from right-flank tip angle to left-flank tip angle at radius ra.',
    '  local right_tip = center - half_tooth - inv_p + inv_a',
    '  local left_tip = center + half_tooth + inv_p - inv_a',
    '  for k = 1, addendum_samples do',
    '    local t = k / (addendum_samples + 1)',
    '    local ang = right_tip + t * (left_tip - right_tip)',
    '    push(ra, ang)',
    '  end',
    '',
    '  -- (d) Left flank: r from r_flank_end down to r_flank_start.',
    '  for k = 0, samples - 1 do',
    '    local t = k / (samples - 1)',
    '    local r = r_flank_end - t * (r_flank_end - r_flank_start)',
    '    local ang = center + half_tooth + inv_p - inv_at_r(r)',
    '    push(r, ang)',
    '  end',
    'end',
    '',
    'local profile = geo.polygon({ points = pts })',
    'local body = geo.extrude({ height = thickness }, { profile })',
    '',
    'if arbor > 0 then',
    '  -- Slightly oversize the bore in Z so the boolean is clean.',
    '  local bore = geo.cylinder({',
    '    radius = arbor,',
    '    height = thickness + 0.2,',
    '    segments = 48,',
    '    center = false,',
    '  })',
    '  local bore_shifted = geo.translate({ offset = { 0, 0, -0.1 } }, { bore })',
    '  return geo.difference({}, { body, bore_shifted })',
    'end',
    '',
    'return body',
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
