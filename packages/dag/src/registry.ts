import { DagError, type GeometryType, type Node } from './types';
import { asRecord, optBool, optSegments, posNum, posVec3, vec3 } from './validate';

const DEFAULT_SEGMENTS = 32;

/**
 * Definition of a node operation: its output type, its child arity/type rule
 * (the 2D/3D type system, CLAUDE.md #6), and how to validate + normalize its
 * params. Normalization applies defaults and drops unknown keys so that two
 * documents describing the same geometry hash identically.
 */
export interface NodeTypeDef {
  readonly type: string;
  readonly output: GeometryType;
  /** Validate child count and child output types; throws DagError on mismatch. */
  checkChildren(children: readonly Node[], path: string): void;
  /** Validate and normalize params into the canonical form used for hashing. */
  normalizeParams(params: unknown, path: string): Record<string, unknown>;
}

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
function primitive(type: string, normalizeParams: NodeTypeDef['normalizeParams']): NodeTypeDef {
  return {
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

/** A unary transform: exactly one 3D child, 3D output. */
function transform(type: string, normalizeParams: NodeTypeDef['normalizeParams']): NodeTypeDef {
  return {
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

/** An n-ary boolean: one or more 3D children, 3D output, no params. */
function boolean(type: string): NodeTypeDef {
  return {
    type,
    output: '3d',
    checkChildren(children, path) {
      if (children.length < 1) {
        throw new DagError(`"${type}" requires at least one child`, path);
      }
      expectAllOfType(children, '3d', path);
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
  boolean('union'),
  boolean('difference'),
];

const registry = new Map<string, NodeTypeDef>(defs.map((def) => [def.type, def]));

export function getNodeType(type: string): NodeTypeDef | undefined {
  return registry.get(type);
}

/** Metadata for every registered node type (for UI / introspection). */
export function listNodeTypes(): { type: string; output: GeometryType }[] {
  return defs.map(({ type, output }) => ({ type, output }));
}
