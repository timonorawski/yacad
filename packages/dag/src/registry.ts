import { DagError, type GeometryType, type Node, type NodeDoc } from './types';
import type { KernelTypeDocSummary } from './schema-docs';
import type { Mesh } from '@yacad/geometry';
import type { Hash } from '@yacad/hash';
import {
  asRecord,
  num,
  optBool,
  optSegments,
  posNum,
  posVec2,
  posVec3,
  vec2,
  vec2Array,
  vec3,
} from './validate';

const DEFAULT_SEGMENTS = 32;

/** Generic interface for whatever a definition-driven expandable node looks up.
 *  Each ExpandableNodeType narrows the return value to its own definition shape. */
export interface DefinitionResolver {
  get(hash: Hash): unknown | undefined;
}

/**
 * Existing path: a kernel-backed node. Evaluation produces a mesh by calling
 * a geometry kernel on the node's child meshes. Signature unchanged from the
 * pre-discriminated `NodeTypeDef`.
 */
export interface KernelNodeType extends KernelTypeDocSummary {
  readonly kind: 'kernel';
  readonly type: string;
  /** Static output type OR a function resolving it from the (already-built)
   *  children. The function form is used by type-overloaded ops like `union`. */
  readonly output: GeometryType | ((children: readonly Node[]) => GeometryType);
  checkChildren(children: readonly Node[], path: string): void;
  normalizeParams(params: unknown, path: string): Record<string, unknown>;
}

/**
 * New path: an expandable node. Evaluation produces a sub-DAG (NodeDoc tree)
 * that the engine then walks normally. Signature widened with `params` and
 * `resolver` because output type and child checks may depend on a stored
 * definition (e.g., LuaDefinition).
 *
 * `expand` is the contract: deterministic function of normalized params + input
 * refs, returns a NodeDoc whose `__input_ref` sentinels the engine substitutes
 * with the expandable node's children.
 */
export interface ExpandableNodeType {
  readonly kind: 'expandable';
  readonly type: string;
  resolveOutput(params: Record<string, unknown>, resolver: DefinitionResolver): GeometryType;
  checkChildren(
    children: readonly Node[],
    params: Record<string, unknown>,
    resolver: DefinitionResolver,
    path: string,
  ): void;
  normalizeParams(
    params: unknown,
    resolver: DefinitionResolver,
    path: string,
  ): Record<string, unknown>;
  /**
   * Declared positional input names. The engine reads these to resolve
   * `__input_ref` sentinels by name when walking an emitted sub-DAG. For
   * LuaNode this maps to schema.inputs[*].name; for static expanders it's
   * a constant array. Required from day one so chunk 4's tests compile.
   */
  inputNames(params: Record<string, unknown>, resolver: DefinitionResolver): readonly string[];
  expand(params: Record<string, unknown>, inputs: readonly InputRef[]): Promise<NodeDoc>;
}

/** Reference to a child input of an expandable node, supplied by the engine.
 *  Declared HERE (in @yacad/dag) because ExpandableNodeType.expand's signature
 *  references it. @yacad/lua re-exports it for its public surface — do NOT
 *  redeclare in chunks 2/3. */
export interface InputRef {
  readonly name: string;
  readonly type: GeometryType;
  outputType(): GeometryType;
}

/**
 * Decoder-backed leaf node — reads an external blob (STL, 3MF, glTF, …) from
 * the resolver and decodes it into a Mesh. Unlike a kernel, the decoder is
 * async (blob fetch); unlike an expandable, it produces a Mesh directly with
 * no sub-DAG. This is the shape for external-format imports.
 */
export interface DecoderNodeType {
  readonly kind: 'decoder';
  readonly type: string;
  readonly output: GeometryType;
  checkChildren(children: readonly Node[], path: string): void;
  normalizeParams(params: unknown, path: string): Record<string, unknown>;
  decode(params: Record<string, unknown>, resolver: DefinitionResolver): Promise<Mesh>;
}

export type NodeTypeDef = KernelNodeType | ExpandableNodeType | DecoderNodeType;

function expectAllOfType(children: readonly Node[], type: GeometryType, path: string): void {
  children.forEach((child, i) => {
    if (child.outputType !== type) {
      throw new DagError(
        `child ${i} must be a ${type} solid but is ${child.outputType}`,
        `${path}/${i}`,
      );
    }
  });
}

/** A leaf primitive: no children, 3D output. */
function primitive(
  type: string,
  docs: KernelTypeDocSummary,
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '3d',
    summary: docs.summary,
    outputDoc: docs.outputDoc,
    paramSchema: docs.paramSchema,
    checkChildren(children, path) {
      if (children.length !== 0) {
        throw new DagError(`"${type}" takes no children`, path);
      }
    },
    normalizeParams,
  };
}

/** A 2D leaf primitive: no children, '2d' output. */
function primitive2d(
  type: string,
  docs: KernelTypeDocSummary,
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '2d',
    summary: docs.summary,
    outputDoc: docs.outputDoc,
    paramSchema: docs.paramSchema,
    checkChildren(children, path) {
      if (children.length !== 0) {
        throw new DagError(`"${type}" takes no children`, path);
      }
    },
    normalizeParams,
  };
}

/** A unary transform: exactly one 3D child, 3D output. */
function transform(
  type: string,
  docs: KernelTypeDocSummary,
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '3d',
    summary: docs.summary,
    outputDoc: docs.outputDoc,
    paramSchema: docs.paramSchema,
    checkChildren(children, path) {
      if (children.length !== 1) {
        throw new DagError(`"${type}" takes exactly one child`, path);
      }
      expectAllOfType(children, '3d', path);
    },
    normalizeParams,
  };
}

/** A 2D→3D bridge: exactly one 2D child, '3d' output. */
function bridge2dTo3d(
  type: string,
  docs: KernelTypeDocSummary,
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '3d',
    summary: docs.summary,
    outputDoc: docs.outputDoc,
    paramSchema: docs.paramSchema,
    checkChildren(children, path) {
      if (children.length !== 1) {
        throw new DagError(`"${type}" takes exactly one child`, path);
      }
      expectAllOfType(children, '2d', path);
    },
    normalizeParams,
  };
}

/** A unary 2D transform: exactly one 2D child, '2d' output. */
function transform2d(
  type: string,
  docs: KernelTypeDocSummary,
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '2d',
    summary: docs.summary,
    outputDoc: docs.outputDoc,
    paramSchema: docs.paramSchema,
    checkChildren(children, path) {
      if (children.length !== 1) {
        throw new DagError(`"${type}" takes exactly one child`, path);
      }
      expectAllOfType(children, '2d', path);
    },
    normalizeParams,
  };
}

/** A 2D→2D refinement: exactly one 2D child, '2d' output. */
function refinement2d(
  type: string,
  docs: KernelTypeDocSummary,
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '2d',
    summary: docs.summary,
    outputDoc: docs.outputDoc,
    paramSchema: docs.paramSchema,
    checkChildren(children, path) {
      if (children.length !== 1) {
        throw new DagError(`"${type}" takes exactly one child`, path);
      }
      expectAllOfType(children, '2d', path);
    },
    normalizeParams,
  };
}

/** A 3D→3D refinement: exactly one 3D child, '3d' output. */
function refinement3d(
  type: string,
  docs: KernelTypeDocSummary,
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '3d',
    summary: docs.summary,
    outputDoc: docs.outputDoc,
    paramSchema: docs.paramSchema,
    checkChildren(children, path) {
      if (children.length !== 1) {
        throw new DagError(`"${type}" takes exactly one child`, path);
      }
      expectAllOfType(children, '3d', path);
    },
    normalizeParams,
  };
}

/** An N-ary operation that accepts ≥minChildren children, all of the same
 *  output type (either all-2D or all-3D). Output type matches the children's
 *  type. No params. Used by union, difference, intersection, hull. */
function overloaded(type: string, minChildren: number, docs: KernelTypeDocSummary): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: (children) => children[0]!.outputType,
    summary: docs.summary,
    outputDoc: docs.outputDoc,
    paramSchema: docs.paramSchema,
    checkChildren(children, path) {
      if (children.length < minChildren) {
        throw new DagError(
          `"${type}" requires at least ${minChildren} child${minChildren > 1 ? 'ren' : ''}`,
          path,
        );
      }
      const first = children[0]!.outputType;
      for (let i = 1; i < children.length; i++) {
        if (children[i]!.outputType !== first) {
          throw new DagError(
            `"${type}" expects all children of the same dimension; ` +
              `got ${children.map((c) => c.outputType).join(', ')}`,
            path,
          );
        }
      }
    },
    normalizeParams(params, path) {
      asRecord(params, path);
      return {};
    },
  };
}

const defs: NodeTypeDef[] = [
  primitive(
    'box',
    {
      summary: 'A rectangular cuboid aligned to the world axes.',
      outputDoc: '3D mesh',
      paramSchema: [
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
    },
    (params, path) => {
      const p = asRecord(params, path);
      return { size: posVec3(p, 'size', path), center: optBool(p, 'center', path, false) };
    },
  ),
  primitive(
    'sphere',
    {
      summary: 'A spherical solid approximated by a geodesic mesh.',
      outputDoc: '3D mesh',
      paramSchema: [
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
    },
    (params, path) => {
      const p = asRecord(params, path);
      return {
        radius: posNum(p, 'radius', path),
        segments: optSegments(p, 'segments', path, DEFAULT_SEGMENTS),
      };
    },
  ),
  primitive(
    'cylinder',
    {
      summary: 'A right circular cylinder aligned along the Z axis.',
      outputDoc: '3D mesh',
      paramSchema: [
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
    },
    (params, path) => {
      const p = asRecord(params, path);
      return {
        height: posNum(p, 'height', path),
        radius: posNum(p, 'radius', path),
        segments: optSegments(p, 'segments', path, DEFAULT_SEGMENTS),
        center: optBool(p, 'center', path, false),
      };
    },
  ),
  transform(
    'translate',
    {
      summary: 'Moves a 3D solid by an offset vector.',
      outputDoc: '3D mesh',
      paramSchema: [
        {
          name: 'offset',
          type: 'vec3',
          required: true,
          doc: 'Translation vector [x, y, z] (any finite values).',
        },
      ],
    },
    (params, path) => {
      const p = asRecord(params, path);
      return { offset: vec3(p, 'offset', path) };
    },
  ),
  transform(
    'rotate',
    {
      summary: 'Rotates a 3D solid by Euler angles (X → Y → Z, in degrees).',
      outputDoc: '3D mesh',
      paramSchema: [
        {
          name: 'angles',
          type: 'vec3',
          required: true,
          doc: 'Rotation angles in degrees [rx, ry, rz], applied X then Y then Z (Manifold convention).',
        },
      ],
    },
    (params, path) => {
      const p = asRecord(params, path);
      // Euler angles in degrees, applied X then Y then Z (Manifold convention).
      return { angles: vec3(p, 'angles', path) };
    },
  ),
  overloaded('union', 1, {
    summary:
      'Boolean union of ≥1 children — accepts all-2D or all-3D children (output matches children).',
    outputDoc: 'matches children',
    paramSchema: [],
  }),
  overloaded('difference', 1, {
    summary:
      'Subtracts all subsequent children from the first — accepts all-2D or all-3D children (output matches children).',
    outputDoc: 'matches children',
    paramSchema: [],
  }),
  overloaded('intersection', 2, {
    summary:
      'Volume common to all ≥2 children — accepts all-2D or all-3D children (output matches children).',
    outputDoc: 'matches children',
    paramSchema: [],
  }),
  overloaded('hull', 1, {
    summary:
      'Convex hull of the union of ≥1 children — accepts all-2D or all-3D children (output matches children).',
    outputDoc: 'matches children',
    paramSchema: [],
  }),
  primitive2d(
    'circle',
    {
      summary: 'A filled 2D circle (CrossSection) approximated as a polygon.',
      outputDoc: '2D cross-section',
      paramSchema: [
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
    },
    (params, path) => {
      const p = asRecord(params, path);
      return {
        radius: posNum(p, 'radius', path),
        segments: optSegments(p, 'segments', path, DEFAULT_SEGMENTS),
      };
    },
  ),
  primitive2d(
    'rectangle',
    {
      summary: 'A filled 2D axis-aligned rectangle.',
      outputDoc: '2D cross-section',
      paramSchema: [
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
    },
    (params, path) => {
      const p = asRecord(params, path);
      return {
        size: posVec2(p, 'size', path),
        center: optBool(p, 'center', path, false),
      };
    },
  ),
  primitive2d(
    'polygon',
    {
      summary: 'A filled 2D polygon defined by an explicit list of vertices.',
      outputDoc: '2D cross-section',
      paramSchema: [
        {
          name: 'points',
          type: 'vec2',
          required: true,
          doc: 'Array of [x, y] pairs (length ≥ 3); the polygon is automatically closed.',
        },
      ],
    },
    (params, path) => {
      const p = asRecord(params, path);
      return { points: vec2Array(p, 'points', path, 3) };
    },
  ),
  primitive2d(
    'spline',
    {
      summary: 'A closed 2D Catmull-Rom spline that passes through every control point.',
      outputDoc: '2D cross-section',
      paramSchema: [
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
    },
    (params, path) => {
      const p = asRecord(params, path);
      const segmentsPerCurve = p['segmentsPerCurve'];
      const tension = p['tension'];
      return {
        points: vec2Array(p, 'points', path, 3),
        segmentsPerCurve:
          segmentsPerCurve === undefined
            ? 16
            : (() => {
                if (
                  typeof segmentsPerCurve !== 'number' ||
                  !Number.isInteger(segmentsPerCurve) ||
                  segmentsPerCurve < 1
                ) {
                  throw new DagError(`"segmentsPerCurve" must be a positive integer`, path);
                }
                return segmentsPerCurve;
              })(),
        tension:
          tension === undefined
            ? 0.5
            : (() => {
                if (typeof tension !== 'number' || !Number.isFinite(tension)) {
                  throw new DagError(`"tension" must be a finite number`, path);
                }
                return tension;
              })(),
      };
    },
  ),
  bridge2dTo3d(
    'extrude',
    {
      summary: 'Lifts a 2D region along the +Z axis to produce a 3D solid.',
      outputDoc: '3D mesh',
      paramSchema: [
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
    },
    (params, path) => {
      const p = asRecord(params, path);
      const twist = p['twist'];
      const segments = p['segments'];
      return {
        height: posNum(p, 'height', path),
        twist:
          twist === undefined
            ? 0
            : (() => {
                if (typeof twist !== 'number' || !Number.isFinite(twist)) {
                  throw new DagError(`"twist" must be a finite number`, path);
                }
                return twist;
              })(),
        scaleTop:
          p['scaleTop'] === undefined
            ? [1, 1]
            : vec2(p as Record<string, unknown>, 'scaleTop', path),
        segments:
          segments === undefined
            ? 1
            : (() => {
                if (typeof segments !== 'number' || !Number.isInteger(segments) || segments < 1) {
                  throw new DagError(`"segments" must be a positive integer`, path);
                }
                return segments;
              })(),
      };
    },
  ),
  bridge2dTo3d(
    'revolve',
    {
      summary: 'Sweeps a 2D region around the chosen axis to produce a 3D solid.',
      outputDoc: '3D mesh',
      paramSchema: [
        {
          name: 'axis',
          type: 'string',
          required: false,
          default: 'y',
          enum: ['y', 'x'],
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
    },
    (params, path) => {
      const p = asRecord(params, path);
      const axisRaw = p['axis'] ?? 'y';
      if (axisRaw !== 'y' && axisRaw !== 'x') {
        throw new DagError(`"axis" must be 'y' or 'x'`, path);
      }
      const segmentsRaw = p['segments'];
      const degreesRaw = p['degrees'];
      return {
        axis: axisRaw,
        segments:
          segmentsRaw === undefined
            ? DEFAULT_SEGMENTS
            : optSegments(p, 'segments', path, DEFAULT_SEGMENTS),
        degrees:
          degreesRaw === undefined
            ? 360
            : (() => {
                if (typeof degreesRaw !== 'number' || !Number.isFinite(degreesRaw)) {
                  throw new DagError(`"degrees" must be a finite number`, path);
                }
                return degreesRaw;
              })(),
      };
    },
  ),
  transform2d(
    'translate_2d',
    {
      summary: 'Moves a 2D cross-section by a 2D offset vector.',
      outputDoc: '2D cross-section',
      paramSchema: [
        {
          name: 'offset',
          type: 'vec2',
          required: true,
          doc: 'Translation vector [x, y].',
        },
      ],
    },
    (params, path) => {
      const p = asRecord(params, path);
      return { offset: vec2(p, 'offset', path) };
    },
  ),
  transform2d(
    'rotate_2d',
    {
      summary: 'Rotates a 2D cross-section around the Z axis by an angle in degrees.',
      outputDoc: '2D cross-section',
      paramSchema: [
        {
          name: 'angle',
          type: 'number',
          required: true,
          doc: 'Rotation angle in degrees (positive = counter-clockwise).',
        },
      ],
    },
    (params, path) => {
      const p = asRecord(params, path);
      return { angle: num(p, 'angle', path) };
    },
  ),
  refinement3d(
    'refine',
    {
      summary: 'Subdivides each triangle to produce a denser 3D mesh.',
      outputDoc: '3D mesh',
      paramSchema: [
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
    },
    (params, path) => {
      const p = asRecord(params, path);
      const n = p['n'];
      const maxEdgeLength = p['maxEdgeLength'];
      if (n === undefined && maxEdgeLength === undefined) {
        throw new DagError(`"refine" requires either "n" or "maxEdgeLength"`, path);
      }
      if (n !== undefined && maxEdgeLength !== undefined) {
        throw new DagError(`"refine" must specify exactly one of "n" or "maxEdgeLength"`, path);
      }
      if (n !== undefined) {
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
          throw new DagError(`"n" must be a positive integer`, path);
        }
        return { n };
      }
      if (
        typeof maxEdgeLength !== 'number' ||
        !Number.isFinite(maxEdgeLength) ||
        maxEdgeLength <= 0
      ) {
        throw new DagError(`"maxEdgeLength" must be a positive finite number`, path);
      }
      return { maxEdgeLength };
    },
  ),
  (() => {
    const OFFSET_JOIN_TYPES = ['round', 'square', 'miter'] as const;
    type OffsetJoinType = (typeof OFFSET_JOIN_TYPES)[number];
    return refinement2d(
      'offset_2d',
      {
        summary: 'Grows or shrinks a 2D shape by a signed offset distance.',
        outputDoc: '2D cross-section',
        paramSchema: [
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
            enum: ['round', 'square', 'miter'],
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
      },
      (params, path) => {
        const p = asRecord(params, path);
        const deltaRaw = p['delta'];
        if (typeof deltaRaw !== 'number' || !Number.isFinite(deltaRaw)) {
          throw new DagError(`"delta" must be a finite number`, path);
        }
        const joinTypeRaw = p['joinType'] ?? 'round';
        if (!OFFSET_JOIN_TYPES.includes(joinTypeRaw as OffsetJoinType)) {
          throw new DagError(`"joinType" must be one of ${OFFSET_JOIN_TYPES.join(' | ')}`, path);
        }
        const miterLimitRaw = p['miterLimit'];
        const segmentsRaw = p['segments'];
        return {
          delta: deltaRaw,
          joinType: joinTypeRaw as OffsetJoinType,
          miterLimit:
            miterLimitRaw === undefined
              ? 2
              : (() => {
                  if (typeof miterLimitRaw !== 'number' || !Number.isFinite(miterLimitRaw)) {
                    throw new DagError(`"miterLimit" must be a finite number`, path);
                  }
                  return miterLimitRaw;
                })(),
          segments: segmentsRaw === undefined ? 16 : optSegments(p, 'segments', path, 16),
        };
      },
    );
  })(),
];

const registry = new Map<string, NodeTypeDef>(defs.map((def) => [def.type, def]));

/** No-op resolver: expandable nodes that require a real resolver will fail at expand time. */
export const NOOP_RESOLVER: DefinitionResolver = { get: () => undefined };

export function getNodeType(type: string): NodeTypeDef | undefined {
  return registry.get(type);
}

/**
 * Returns the schema-summary documentation for a kernel-backed node type, or
 * `undefined` if `type` is not registered or is not a kernel node.
 */
export function getKernelTypeDoc(type: string): KernelTypeDocSummary | undefined {
  const def = getNodeType(type);
  if (!def || def.kind !== 'kernel') return undefined;
  return def; // KernelNodeType extends KernelTypeDocSummary
}

export function registerNodeType(def: NodeTypeDef): void {
  if (registry.has(def.type)) {
    throw new Error(`node type "${def.type}" already registered`);
  }
  registry.set(def.type, def);
}

/** Test-only — remove a previously-registered external node type. */
export function unregisterNodeType(type: string): void {
  registry.delete(type);
}

/** Metadata for every registered node type (for UI / introspection). */
export function listNodeTypes(): { type: string; output: GeometryType | '?' }[] {
  return [...registry.values()].map((def) => ({
    type: def.type,
    output: def.kind === 'kernel' ? (typeof def.output === 'function' ? '?' : def.output) : '?',
  }));
}
