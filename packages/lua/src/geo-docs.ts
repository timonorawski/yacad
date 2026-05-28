/**
 * Per-type documentation descriptors for every kernel-backed node type.
 * The studio Lua API docs panel is generated from this map — adding a new
 * kernel node type means adding an entry here and it appears automatically.
 */

export interface ParamDoc {
  readonly name: string;
  readonly type: 'number' | 'int' | 'boolean' | 'string' | 'vec2' | 'vec3';
  readonly required: boolean;
  readonly default?: unknown;
  readonly doc: string; // one short sentence
}

export interface KernelTypeDoc {
  readonly type: string;
  readonly summary: string; // one-line description
  readonly outputDoc: string; // e.g. "3D mesh"
  readonly params: readonly ParamDoc[];
  readonly example: string; // Lua snippet
}

export const KERNEL_TYPE_DOCS: readonly KernelTypeDoc[] = [
  // ── 3D primitives ──────────────────────────────────────────────────────────
  {
    type: 'box',
    summary: 'A rectangular cuboid aligned to the world axes.',
    outputDoc: '3D mesh',
    params: [
      {
        name: 'size',
        type: 'vec3',
        required: true,
        doc: 'Positive [x, y, z] dimensions of the box.',
      },
      {
        name: 'center',
        type: 'boolean',
        required: false,
        default: false,
        doc: 'When true the box is centered on the origin; otherwise its corner is at the origin.',
      },
    ],
    example: `return geo.box({ size = {20, 20, 20}, center = true })`,
  },
  {
    type: 'sphere',
    summary: 'A spherical solid approximated by a geodesic mesh.',
    outputDoc: '3D mesh',
    params: [
      {
        name: 'radius',
        type: 'number',
        required: true,
        doc: 'Positive radius of the sphere.',
      },
      {
        name: 'segments',
        type: 'int',
        required: false,
        default: 32,
        doc: 'Number of latitudinal/longitudinal subdivisions (integer ≥ 3).',
      },
    ],
    example: `return geo.sphere({ radius = 10, segments = 48 })`,
  },
  {
    type: 'cylinder',
    summary: 'A right circular cylinder aligned along the Z axis.',
    outputDoc: '3D mesh',
    params: [
      {
        name: 'height',
        type: 'number',
        required: true,
        doc: 'Positive height of the cylinder along the Z axis.',
      },
      {
        name: 'radius',
        type: 'number',
        required: true,
        doc: 'Positive radius of the circular cross-section.',
      },
      {
        name: 'segments',
        type: 'int',
        required: false,
        default: 32,
        doc: 'Number of circumferential subdivisions (integer ≥ 3).',
      },
      {
        name: 'center',
        type: 'boolean',
        required: false,
        default: false,
        doc: 'When true centered on the origin; otherwise the base sits on Z=0.',
      },
    ],
    example: `return geo.cylinder({ height = 30, radius = 8, segments = 64, center = true })`,
  },

  // ── 2D primitives ──────────────────────────────────────────────────────────
  {
    type: 'circle',
    summary: 'A filled 2D circle (CrossSection) approximated as a polygon.',
    outputDoc: '2D cross-section',
    params: [
      {
        name: 'radius',
        type: 'number',
        required: true,
        doc: 'Positive radius of the circle.',
      },
      {
        name: 'segments',
        type: 'int',
        required: false,
        default: 32,
        doc: 'Number of polygon vertices approximating the circle (integer ≥ 3).',
      },
    ],
    example: `return geo.circle({ radius = 5, segments = 48 })`,
  },
  {
    type: 'rectangle',
    summary: 'A filled 2D axis-aligned rectangle.',
    outputDoc: '2D cross-section',
    params: [
      {
        name: 'size',
        type: 'vec2',
        required: true,
        doc: 'Positive [x, y] dimensions of the rectangle.',
      },
      {
        name: 'center',
        type: 'boolean',
        required: false,
        default: false,
        doc: 'When true centered on the origin; otherwise the corner is at the origin.',
      },
    ],
    example: `return geo.rectangle({ size = {10, 20}, center = true })`,
  },
  {
    type: 'polygon',
    summary: 'A filled 2D polygon defined by an explicit list of vertices.',
    outputDoc: '2D cross-section',
    params: [
      {
        name: 'points',
        type: 'vec2',
        required: true,
        doc: 'Array of [x, y] pairs (length ≥ 3); the polygon is automatically closed.',
      },
    ],
    example: `return geo.polygon({ points = {{0,0},{10,0},{5,10}} })`,
  },
  {
    type: 'spline',
    summary: 'A closed 2D Catmull-Rom spline that passes through every control point.',
    outputDoc: '2D cross-section',
    params: [
      {
        name: 'points',
        type: 'vec2',
        required: true,
        doc: 'Array of [x, y] control points (length ≥ 3); automatically closed loop.',
      },
      {
        name: 'segmentsPerCurve',
        type: 'int',
        required: false,
        default: 16,
        doc: 'Tessellation density between consecutive control points (positive integer).',
      },
      {
        name: 'tension',
        type: 'number',
        required: false,
        default: 0.5,
        doc: 'Catmull-Rom tension — lower values tighten curves, higher values loosen them.',
      },
    ],
    example: `return geo.spline({
  points = {{10,0},{3,3},{0,10},{-3,3},{-10,0},{-3,-3},{0,-10},{3,-3}},
  segmentsPerCurve = 12,
  tension = 0.5,
})`,
  },

  // ── 3D transforms ──────────────────────────────────────────────────────────
  {
    type: 'translate',
    summary: 'Moves a 3D solid by an offset vector.',
    outputDoc: '3D mesh',
    params: [
      {
        name: 'offset',
        type: 'vec3',
        required: true,
        doc: 'Translation vector [x, y, z] (any finite values).',
      },
    ],
    example: `local box = geo.box({ size = {10, 10, 10}, center = true })
return geo.translate({ offset = {15, 0, 0} }, { box })`,
  },
  {
    type: 'rotate',
    summary: 'Rotates a 3D solid by Euler angles (X → Y → Z, in degrees).',
    outputDoc: '3D mesh',
    params: [
      {
        name: 'angles',
        type: 'vec3',
        required: true,
        doc: 'Rotation angles in degrees [rx, ry, rz], applied X then Y then Z (Manifold convention).',
      },
    ],
    example: `local cyl = geo.cylinder({ height = 30, radius = 6, segments = 64, center = true })
return geo.rotate({ angles = {90, 0, 0} }, { cyl })`,
  },

  // ── 2D transforms ──────────────────────────────────────────────────────────
  {
    type: 'translate_2d',
    summary: 'Moves a 2D cross-section by a 2D offset vector.',
    outputDoc: '2D cross-section',
    params: [
      {
        name: 'offset',
        type: 'vec2',
        required: true,
        doc: 'Translation vector [x, y].',
      },
    ],
    example: `local c = geo.circle({ radius = 1 })
return geo.translate_2d({ offset = {5, 0} }, { c })`,
  },
  {
    type: 'rotate_2d',
    summary: 'Rotates a 2D cross-section around the Z axis by an angle in degrees.',
    outputDoc: '2D cross-section',
    params: [
      {
        name: 'angle',
        type: 'number',
        required: true,
        doc: 'Rotation angle in degrees (positive = counter-clockwise).',
      },
    ],
    example: `local r = geo.rectangle({ size = {6, 2}, center = true })
return geo.rotate_2d({ angle = 45 }, { r })`,
  },

  // ── Type-overloaded ops ────────────────────────────────────────────────────
  {
    type: 'union',
    summary:
      'Boolean union of ≥1 children — accepts all-2D or all-3D children (output matches children).',
    outputDoc: 'matches children',
    params: [],
    example: `-- 3D union
local a = geo.box({ size = {20, 20, 10}, center = true })
local b = geo.sphere({ radius = 5 })
return geo.union({}, { a, b })

-- 2D union
local c1 = geo.circle({ radius = 5 })
local r1 = geo.rectangle({ size = {4, 4}, center = true })
return geo.union({}, { c1, r1 })`,
  },
  {
    type: 'difference',
    summary:
      'Subtracts all subsequent children from the first — accepts all-2D or all-3D children (output matches children).',
    outputDoc: 'matches children',
    params: [],
    example: `local outer = geo.box({ size = {30, 30, 30}, center = true })
local inner = geo.sphere({ radius = 19 })
return geo.difference({}, { outer, inner })`,
  },
  {
    type: 'intersection',
    summary:
      'Volume common to all ≥2 children — accepts all-2D or all-3D children (output matches children).',
    outputDoc: 'matches children',
    params: [],
    example: `local box = geo.box({ size = {10, 10, 10}, center = true })
local sph = geo.sphere({ radius = 6 })
return geo.intersection({}, { box, sph })`,
  },
  {
    type: 'hull',
    summary:
      'Convex hull of the union of ≥1 children — accepts all-2D or all-3D children (output matches children).',
    outputDoc: 'matches children',
    params: [],
    example: `local c1 = geo.circle({ radius = 1 })
local c2 = geo.translate_2d({ offset = {10, 0} }, { geo.circle({ radius = 1 }) })
return geo.hull({}, { c1, c2 })`,
  },

  // ── 2D refinement ─────────────────────────────────────────────────────────
  {
    type: 'offset_2d',
    summary: 'Grows or shrinks a 2D shape by a signed offset distance.',
    outputDoc: '2D cross-section',
    params: [
      {
        name: 'delta',
        type: 'number',
        required: true,
        doc: 'Positive values grow the shape outward; negative values shrink it inward.',
      },
      {
        name: 'joinType',
        type: 'string',
        required: false,
        default: 'round',
        doc: 'Corner join style: "round", "square", or "miter".',
      },
      {
        name: 'miterLimit',
        type: 'number',
        required: false,
        default: 2,
        doc: 'Caps spike length when joinType is "miter".',
      },
      {
        name: 'segments',
        type: 'int',
        required: false,
        default: 16,
        doc: 'Controls roundness on circular joins (positive integer).',
      },
    ],
    example: `local rect = geo.rectangle({ size = {10, 10}, center = true })
return geo.offset_2d({ delta = 2, joinType = "round" }, { rect })`,
  },

  // ── 3D refinement ─────────────────────────────────────────────────────────
  {
    type: 'refine',
    summary: 'Subdivides each triangle to produce a denser 3D mesh.',
    outputDoc: '3D mesh',
    params: [
      {
        name: 'n',
        type: 'int',
        required: false,
        doc: 'Subdivide each triangle edge into n segments (each triangle becomes n² triangles); mutually exclusive with maxEdgeLength.',
      },
      {
        name: 'maxEdgeLength',
        type: 'number',
        required: false,
        doc: 'Refine until no edge exceeds this length; mutually exclusive with n.',
      },
    ],
    example: `local box = geo.box({ size = {1, 1, 1} })
return geo.refine({ n = 2 }, { box })`,
  },

  // ── 2D→3D bridges ─────────────────────────────────────────────────────────
  {
    type: 'extrude',
    summary: 'Lifts a 2D region along the +Z axis to produce a 3D solid.',
    outputDoc: '3D mesh',
    params: [
      {
        name: 'height',
        type: 'number',
        required: true,
        doc: 'Positive height of the extrusion along the Z axis.',
      },
      {
        name: 'twist',
        type: 'number',
        required: false,
        default: 0,
        doc: 'Total twist in degrees applied linearly along the extrusion.',
      },
      {
        name: 'scaleTop',
        type: 'vec2',
        required: false,
        default: [1, 1],
        doc: 'XY scale factor at the top face — values below 1 taper, above 1 flare.',
      },
      {
        name: 'segments',
        type: 'int',
        required: false,
        default: 1,
        doc: 'Z-axis subdivisions — relevant when twist ≠ 0 or scaleTop is non-uniform.',
      },
    ],
    example: `local profile = geo.circle({ radius = 5 })
return geo.extrude({ height = 10, twist = 45, segments = 16 }, { profile })`,
  },
  {
    type: 'revolve',
    summary: 'Sweeps a 2D region around the chosen axis to produce a 3D solid.',
    outputDoc: '3D mesh',
    params: [
      {
        name: 'axis',
        type: 'string',
        required: false,
        default: 'y',
        doc: 'Axis of revolution: "y" (default) or "x".',
      },
      {
        name: 'segments',
        type: 'int',
        required: false,
        default: 32,
        doc: 'Number of subdivisions around the sweep (integer ≥ 3).',
      },
      {
        name: 'degrees',
        type: 'number',
        required: false,
        default: 360,
        doc: 'Sweep arc in degrees — less than 360 produces an open arc.',
      },
    ],
    example: `local profile = geo.polygon({
  points = {{3,0},{4,5},{3,10},{0,10},{0,0}},
})
return geo.revolve({ axis = "y", segments = 64, degrees = 360 }, { profile })`,
  },
];
