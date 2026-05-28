import { type Manifold as Solid, type ManifoldToplevel } from 'manifold-3d';
import type { Node, Vec3 } from '@yacad/dag';
import type { Geometry, Mesh } from '@yacad/geometry';
import { KERNEL_NAME, KERNEL_VERSION } from './loader';

/** Wall-clock breakdown of one kernel evaluation, in milliseconds. */
export interface KernelTimings {
  /** Rebuilding child solids from their cached meshes (0 for leaf primitives). */
  readonly importMs: number;
  /** The Manifold operation itself (primitive construction, transform, boolean). */
  readonly opMs: number;
  /** Extracting the result mesh out of WASM. */
  readonly exportMs: number;
}

export interface KernelResult {
  readonly geometry: Geometry;
  readonly timings: KernelTimings;
}

/**
 * Evaluates one DAG node to a geometry, given its children's already-evaluated
 * geometries. Deterministic given its inputs (CLAUDE.md #2): no clock, RNG, or I/O.
 */
export interface Kernel {
  readonly name: string;
  readonly version: string;
  /** Evaluate to a geometry. */
  evaluate(node: Node, childGeometries: readonly Geometry[]): Geometry;
  /** Evaluate to a geometry plus a per-phase timing breakdown. */
  evaluateTimed(node: Node, childGeometries: readonly Geometry[]): KernelResult;
}

/** Thrown when a node receives a child geometry of the wrong kind. */
class KernelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelError';
  }
}

function asMesh(g: Geometry, nodeId: string, i: number): Mesh {
  if (g.kind !== '3d') {
    throw new KernelError(`node ${nodeId}: expected 3D child at index ${i}, got 2D`);
  }
  return g.mesh;
}

/**
 * The primary kernel (CLAUDE.md #7), backed by Manifold WASM.
 *
 * Children arrive as meshes — the cached artifact type — so transforms and
 * booleans reconstruct Manifold solids from them via the Manifold constructor,
 * which re-welds coincident vertices into a watertight solid. That import is
 * timed separately because, when an ancestor recomputes, it pays to re-import
 * its children's cached meshes even though their geometry was cached.
 */
export class ManifoldKernel implements Kernel {
  readonly name = KERNEL_NAME;
  readonly version = KERNEL_VERSION;

  constructor(private readonly api: ManifoldToplevel) {}

  evaluate(node: Node, childGeometries: readonly Geometry[]): Geometry {
    return this.evaluateTimed(node, childGeometries).geometry;
  }

  evaluateTimed(node: Node, childGeometries: readonly Geometry[]): KernelResult {
    // Dispatch to 2D handler for 2D node types (no import needed — no child meshes).
    if (node.type === 'circle') {
      return this.evaluateCircle(node);
    }
    if (node.type === 'rectangle') {
      return this.evaluateRectangle(node);
    }

    // Import: rebuild every child solid up front so the op phase measures only
    // the Manifold operation.
    const importStart = performance.now();
    const childSolids = childGeometries.map((g, i) => this.toSolid(asMesh(g, node.id, i)));
    const importMs = performance.now() - importStart;

    const opStart = performance.now();
    let result: Solid;
    try {
      result = this.runOp(node, childSolids);
    } finally {
      for (const s of childSolids) s.delete();
    }
    const opMs = performance.now() - opStart;

    const exportStart = performance.now();
    try {
      const mesh = this.toMesh(result);
      return {
        geometry: { kind: '3d', mesh },
        timings: { importMs, opMs, exportMs: performance.now() - exportStart },
      };
    } finally {
      result.delete();
    }
  }

  private evaluateCircle(node: Node): KernelResult {
    const importMs = 0; // leaf: no child meshes to import
    const opStart = performance.now();
    const radius = node.params['radius'] as number;
    const segments = node.params['segments'] as number;
    const cs = this.api.CrossSection.circle(radius, segments);
    const opMs = performance.now() - opStart;

    const exportStart = performance.now();
    const polygons = cs.toPolygons() as ReadonlyArray<ReadonlyArray<[number, number]>>;
    cs.delete?.();
    const exportMs = performance.now() - exportStart;

    return {
      geometry: { kind: '2d', section: { polygons } },
      timings: { importMs, opMs, exportMs },
    };
  }

  private evaluateRectangle(node: Node): KernelResult {
    const importMs = 0; // leaf: no child meshes to import
    const opStart = performance.now();
    const size = node.params['size'] as [number, number];
    const center = node.params['center'] as boolean;
    const cs = this.api.CrossSection.square(size, center);
    const opMs = performance.now() - opStart;

    const exportStart = performance.now();
    const polygons = cs.toPolygons() as ReadonlyArray<ReadonlyArray<[number, number]>>;
    cs.delete?.();
    const exportMs = performance.now() - exportStart;

    return {
      geometry: { kind: '2d', section: { polygons } },
      timings: { importMs, opMs, exportMs },
    };
  }

  /** Run the node's Manifold operation over already-imported child solids. */
  private runOp(node: Node, childSolids: readonly Solid[]): Solid {
    const { Manifold } = this.api;
    switch (node.type) {
      case 'box': {
        const p = node.params as { size: Vec3; center: boolean };
        return Manifold.cube(p.size, p.center);
      }
      case 'sphere': {
        const p = node.params as { radius: number; segments: number };
        return Manifold.sphere(p.radius, p.segments);
      }
      case 'cylinder': {
        const p = node.params as {
          height: number;
          radius: number;
          segments: number;
          center: boolean;
        };
        return Manifold.cylinder(p.height, p.radius, p.radius, p.segments, p.center);
      }
      case 'translate': {
        const p = node.params as { offset: Vec3 };
        return childSolids[0]!.translate(p.offset);
      }
      case 'rotate': {
        const p = node.params as { angles: Vec3 };
        return childSolids[0]!.rotate(p.angles);
      }
      case 'union':
        return Manifold.union(childSolids as Solid[]);
      case 'difference':
        return Manifold.difference(childSolids as Solid[]);
      default:
        throw new Error(`manifold kernel cannot evaluate node type "${node.type}"`);
    }
  }

  private toSolid(mesh: Mesh): Solid {
    const meshGL = new this.api.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(mesh.vertices),
      triVerts: new Uint32Array(mesh.indices),
    });
    return new this.api.Manifold(meshGL);
  }

  private toMesh(solid: Solid): Mesh {
    const gl = solid.getMesh();
    const { numProp, vertProperties, triVerts } = gl;
    const indices = new Uint32Array(triVerts);

    if (numProp === 3) {
      // Copy out of WASM-owned memory into JS-owned arrays.
      return { vertices: new Float32Array(vertProperties), indices };
    }

    // Strip any extra per-vertex properties down to XYZ positions.
    const count = vertProperties.length / numProp;
    const vertices = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      vertices[i * 3] = vertProperties[i * numProp]!;
      vertices[i * 3 + 1] = vertProperties[i * numProp + 1]!;
      vertices[i * 3 + 2] = vertProperties[i * numProp + 2]!;
    }
    return { vertices, indices };
  }
}
