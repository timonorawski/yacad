import { DagError, type GeometryType, type Node, type NodeDoc } from './types';
import type { Mesh } from '@yacad/geometry';
import type { Hash } from '@yacad/hash';
import { asRecord, optBool, optSegments, posNum, posVec3, vec3 } from './validate';

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
  readonly output: GeometryType;
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

/** An n-ary boolean: one or more 3D children, 3D output, no params. */
function boolean(type: string): KernelNodeType {
  return {
    kind: 'kernel',
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
    output: def.kind === 'kernel' ? def.output : '?',
  }));
}
