import { DagError, type GeometryType, type Node, type NodeDoc } from './types';
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
export interface KernelNodeType {
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

export type NodeTypeDef = KernelNodeType | ExpandableNodeType;

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
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '3d',
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
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '2d',
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
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '3d',
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
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '3d',
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
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '2d',
    checkChildren(children, path) {
      if (children.length !== 1) {
        throw new DagError(`"${type}" takes exactly one child`, path);
      }
      expectAllOfType(children, '2d', path);
    },
    normalizeParams,
  };
}

/** An N-ary operation that accepts ≥minChildren children, all of the same
 *  output type (either all-2D or all-3D). Output type matches the children's
 *  type. No params. Used by union, difference, intersection, hull. */
function overloaded(type: string, minChildren: number): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: (children) => children[0]!.outputType,
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
  primitive('box', (params, path) => {
    const p = asRecord(params, path);
    return { size: posVec3(p, 'size', path), center: optBool(p, 'center', path, false) };
  }),
  primitive('sphere', (params, path) => {
    const p = asRecord(params, path);
    return {
      radius: posNum(p, 'radius', path),
      segments: optSegments(p, 'segments', path, DEFAULT_SEGMENTS),
    };
  }),
  primitive('cylinder', (params, path) => {
    const p = asRecord(params, path);
    return {
      height: posNum(p, 'height', path),
      radius: posNum(p, 'radius', path),
      segments: optSegments(p, 'segments', path, DEFAULT_SEGMENTS),
      center: optBool(p, 'center', path, false),
    };
  }),
  transform('translate', (params, path) => {
    const p = asRecord(params, path);
    return { offset: vec3(p, 'offset', path) };
  }),
  transform('rotate', (params, path) => {
    const p = asRecord(params, path);
    // Euler angles in degrees, applied X then Y then Z (Manifold convention).
    return { angles: vec3(p, 'angles', path) };
  }),
  overloaded('union', 1),
  overloaded('difference', 1),
  overloaded('intersection', 2),
  overloaded('hull', 1),
  primitive2d('circle', (params, path) => {
    const p = asRecord(params, path);
    return {
      radius: posNum(p, 'radius', path),
      segments: optSegments(p, 'segments', path, DEFAULT_SEGMENTS),
    };
  }),
  primitive2d('rectangle', (params, path) => {
    const p = asRecord(params, path);
    return {
      size: posVec2(p, 'size', path),
      center: optBool(p, 'center', path, false),
    };
  }),
  primitive2d('polygon', (params, path) => {
    const p = asRecord(params, path);
    return { points: vec2Array(p, 'points', path, 3) };
  }),
  primitive2d('spline', (params, path) => {
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
  }),
  bridge2dTo3d('extrude', (params, path) => {
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
        p['scaleTop'] === undefined ? [1, 1] : vec2(p as Record<string, unknown>, 'scaleTop', path),
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
  }),
  bridge2dTo3d('revolve', (params, path) => {
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
  }),
  transform2d('translate_2d', (params, path) => {
    const p = asRecord(params, path);
    return { offset: vec2(p, 'offset', path) };
  }),
  transform2d('rotate_2d', (params, path) => {
    const p = asRecord(params, path);
    return { angle: num(p, 'angle', path) };
  }),
];

const registry = new Map<string, NodeTypeDef>(defs.map((def) => [def.type, def]));

/** No-op resolver: expandable nodes that require a real resolver will fail at expand time. */
export const NOOP_RESOLVER: DefinitionResolver = { get: () => undefined };

export function getNodeType(type: string): NodeTypeDef | undefined {
  return registry.get(type);
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
