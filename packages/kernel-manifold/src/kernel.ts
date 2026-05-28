import {
  type CrossSection as ManifoldCrossSection,
  type Manifold as Solid,
  type ManifoldToplevel,
} from 'manifold-3d';
import type { Node, Vec3 } from '@yacad/dag';
import type { CrossSection, Geometry, Mesh } from '@yacad/geometry';
import { KERNEL_NAME, KERNEL_VERSION } from './loader';
import { catmullRomClosed } from './spline';

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

function asCrossSection(g: Geometry, nodeId: string, i: number): CrossSection {
  if (g.kind !== '2d') {
    throw new KernelError(`node ${nodeId}: expected 2D child at index ${i}, got 3D`);
  }
  return g.section;
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
    if (node.type === 'polygon') {
      return this.evaluatePolygon(node);
    }
    if (node.type === 'spline') {
      return this.evaluateSpline(node);
    }
    if (node.type === 'translate_2d') {
      return this.evaluateTranslate2d(node, childGeometries);
    }
    if (node.type === 'rotate_2d') {
      return this.evaluateRotate2d(node, childGeometries);
    }
    if (node.type === 'offset_2d') {
      return this.evaluateOffset2d(node, childGeometries);
    }

    // 2D boolean ops: dispatch on child kind when children are 2D.
    if (
      (node.type === 'union' ||
        node.type === 'difference' ||
        node.type === 'intersection' ||
        node.type === 'hull') &&
      childGeometries.length > 0 &&
      childGeometries[0]!.kind === '2d'
    ) {
      return this.evaluate2dOp(node, childGeometries);
    }

    // 2D→3D bridge: extrude a CrossSection into a 3D Manifold.
    if (node.type === 'extrude') {
      return this.evaluateExtrude(node, childGeometries);
    }

    // 2D→3D bridge: revolve a CrossSection around Y (or X) axis.
    if (node.type === 'revolve') {
      return this.evaluateRevolve(node, childGeometries);
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

  private evaluatePolygon(node: Node): KernelResult {
    const importMs = 0;
    const opStart = performance.now();
    const points = node.params['points'] as ReadonlyArray<readonly [number, number]>;
    // Cast away readonly: Manifold's ofPolygons expects mutable arrays.
    const cs = this.api.CrossSection.ofPolygons([points] as unknown as [number, number][][]);
    const opMs = performance.now() - opStart;
    const exportStart = performance.now();
    const polygons = cs.toPolygons() as ReadonlyArray<ReadonlyArray<[number, number]>>;
    cs.delete?.();
    return {
      geometry: { kind: '2d', section: { polygons } },
      timings: { importMs, opMs, exportMs: performance.now() - exportStart },
    };
  }

  private evaluateSpline(node: Node): KernelResult {
    const importMs = 0;
    const opStart = performance.now();
    const points = node.params['points'] as ReadonlyArray<readonly [number, number]>;
    const segmentsPerCurve = node.params['segmentsPerCurve'] as number;
    const tension = node.params['tension'] as number;
    const tess = catmullRomClosed(points, segmentsPerCurve, tension);
    // Cast away readonly: Manifold's ofPolygons expects mutable arrays.
    const cs = this.api.CrossSection.ofPolygons([tess] as unknown as [number, number][][]);
    const opMs = performance.now() - opStart;
    const exportStart = performance.now();
    const polygons = cs.toPolygons() as ReadonlyArray<ReadonlyArray<[number, number]>>;
    cs.delete?.();
    return {
      geometry: { kind: '2d', section: { polygons } },
      timings: { importMs, opMs, exportMs: performance.now() - exportStart },
    };
  }

  private evaluateTranslate2d(node: Node, childGeometries: readonly Geometry[]): KernelResult {
    const child = asCrossSection(childGeometries[0]!, node.id, 0);
    const importStart = performance.now();
    // Cast readonly nested arrays to the mutable form Manifold's ofPolygons expects.
    const cs = this.api.CrossSection.ofPolygons(child.polygons as unknown as [number, number][][]);
    const importMs = performance.now() - importStart;
    const opStart = performance.now();
    const [dx, dy] = node.params['offset'] as [number, number];
    const translated = cs.translate([dx, dy]);
    const opMs = performance.now() - opStart;
    const exportStart = performance.now();
    const polygons = translated.toPolygons() as ReadonlyArray<ReadonlyArray<[number, number]>>;
    cs.delete?.();
    translated.delete?.();
    return {
      geometry: { kind: '2d', section: { polygons } },
      timings: { importMs, opMs, exportMs: performance.now() - exportStart },
    };
  }

  private evaluateRotate2d(node: Node, childGeometries: readonly Geometry[]): KernelResult {
    const child = asCrossSection(childGeometries[0]!, node.id, 0);
    const importStart = performance.now();
    const cs = this.api.CrossSection.ofPolygons(child.polygons as unknown as [number, number][][]);
    const importMs = performance.now() - importStart;
    const opStart = performance.now();
    const angle = node.params['angle'] as number;
    const rotated = cs.rotate(angle);
    const opMs = performance.now() - opStart;
    const exportStart = performance.now();
    const polygons = rotated.toPolygons() as ReadonlyArray<ReadonlyArray<[number, number]>>;
    cs.delete?.();
    rotated.delete?.();
    return {
      geometry: { kind: '2d', section: { polygons } },
      timings: { importMs, opMs, exportMs: performance.now() - exportStart },
    };
  }

  private evaluateOffset2d(node: Node, childGeometries: readonly Geometry[]): KernelResult {
    const child = asCrossSection(childGeometries[0]!, node.id, 0);
    const importStart = performance.now();
    const cs = this.api.CrossSection.ofPolygons(
      child.polygons as unknown as [number, number][][],
    );
    const importMs = performance.now() - importStart;

    const opStart = performance.now();
    const delta = node.params['delta'] as number;
    const joinType = node.params['joinType'] as 'round' | 'square' | 'miter';
    const miterLimit = node.params['miterLimit'] as number;
    const segments = node.params['segments'] as number;

    // Manifold's JoinType uses capitalized strings: 'Round'|'Square'|'Miter'.
    // Map our lowercase DAG values to the enum Manifold expects.
    const manifoldJoinType = (joinType.charAt(0).toUpperCase() + joinType.slice(1)) as
      | 'Round'
      | 'Square'
      | 'Miter';

    // CrossSection.offset(delta, joinType?, miterLimit?, circularSegments?)
    // circularSegments is the number of vertices per 360° of rounded corners.
    const offsetted = cs.offset(delta, manifoldJoinType, miterLimit, segments);
    const opMs = performance.now() - opStart;

    const exportStart = performance.now();
    const polygons = offsetted.toPolygons() as ReadonlyArray<ReadonlyArray<[number, number]>>;
    cs.delete?.();
    offsetted.delete?.();
    return {
      geometry: { kind: '2d', section: { polygons } },
      timings: { importMs, opMs, exportMs: performance.now() - exportStart },
    };
  }

  private evaluateRevolve(node: Node, childGeometries: readonly Geometry[]): KernelResult {
    const child = asCrossSection(childGeometries[0]!, node.id, 0);
    const importStart = performance.now();
    // Manifold.revolve takes a CrossSection or Polygons (array of SimplePolygon).
    // We pass the stored polygons directly, cast to the mutable form Manifold expects.
    const polygons = child.polygons as unknown as [number, number][][];
    const axis = node.params['axis'] as 'y' | 'x';
    const segments = node.params['segments'] as number;
    const degrees = node.params['degrees'] as number;

    // Manifold.revolve always revolves around the Y axis (in 2D input space),
    // mapping Y→Z in the output. For axis='y' we pass the polygon as-is.
    // For axis='x' we revolve around Y to get a Y-axis torus, then post-rotate
    // the 3D solid 90° around Z so the rotation axis becomes X.
    // (Pre-rotating the polygon to avoid clipping is not necessary because the
    // profile — e.g., a circle offset on +X — already lies on the correct side.)
    const inputPolys = polygons;
    const importMs = performance.now() - importStart;

    const opStart = performance.now();
    const m = this.api.Manifold.revolve(
      inputPolys as unknown as Parameters<typeof this.api.Manifold.revolve>[0],
      segments,
      degrees,
    );
    // For axis='x': rotate the Y-axis torus 90° around Z → rotation axis becomes X.
    const result = axis === 'x' ? m.rotate([0, 0, 90]) : m;
    const opMs = performance.now() - opStart;

    const exportStart = performance.now();
    const mesh = this.toMesh(result);
    // Clean up WASM objects. When axis='x', m and result are different objects.
    if (m !== result) m.delete?.();
    result.delete?.();
    return {
      geometry: { kind: '3d', mesh },
      timings: { importMs, opMs, exportMs: performance.now() - exportStart },
    };
  }

  private evaluateExtrude(node: Node, childGeometries: readonly Geometry[]): KernelResult {
    const child = asCrossSection(childGeometries[0]!, node.id, 0);
    const importStart = performance.now();
    const cs = this.api.CrossSection.ofPolygons(
      child.polygons as unknown as [number, number][][],
    );
    const importMs = performance.now() - importStart;

    const opStart = performance.now();
    const height = node.params['height'] as number;
    const twist = node.params['twist'] as number;
    const scaleTop = node.params['scaleTop'] as [number, number];
    const segments = node.params['segments'] as number;
    // Instance method signature: extrude(height, nDivisions?, twistDegrees?, scaleTop?, centered?)
    const m = cs.extrude(height, segments, twist, scaleTop);
    const opMs = performance.now() - opStart;

    const exportStart = performance.now();
    const mesh = this.toMesh(m);
    cs.delete?.();
    m.delete?.();
    return {
      geometry: { kind: '3d', mesh },
      timings: { importMs, opMs, exportMs: performance.now() - exportStart },
    };
  }

  /**
   * Dispatch 2D boolean/hull operations for union, difference, intersection, and hull.
   * All children must be 2D geometry (kind === '2d').
   */
  private evaluate2dOp(node: Node, childGeometries: readonly Geometry[]): KernelResult {
    if (node.type === 'hull') {
      return this.evaluate2dHull(node, childGeometries);
    }
    const op = ((): ((
      a: ManifoldCrossSection,
      b: ManifoldCrossSection,
    ) => ManifoldCrossSection) => {
      switch (node.type) {
        case 'union':
          return (a, b) => a.add(b);
        case 'difference':
          return (a, b) => a.subtract(b);
        case 'intersection':
          return (a, b) => a.intersect(b);
        default:
          throw new Error(`manifold kernel: unexpected 2D op "${node.type}"`);
      }
    })();
    return this.evaluate2dBoolean(node, childGeometries, op);
  }

  /**
   * Reduce N 2D children with a binary CrossSection operation (union/difference/intersection).
   * Import, fold-left with op, export — timing broken out per phase.
   */
  private evaluate2dBoolean(
    node: Node,
    childGeometries: readonly Geometry[],
    op: (a: ManifoldCrossSection, b: ManifoldCrossSection) => ManifoldCrossSection,
  ): KernelResult {
    const importStart = performance.now();
    const sections = childGeometries.map((g, i) =>
      this.api.CrossSection.ofPolygons(
        asCrossSection(g, node.id, i).polygons as unknown as [number, number][][],
      ),
    );
    const importMs = performance.now() - importStart;

    const opStart = performance.now();
    let acc = sections[0]!;
    for (let i = 1; i < sections.length; i++) {
      const next = op(acc, sections[i]!);
      // acc is a new object after op; the old one is still owned by sections[] — don't delete it here.
      acc = next;
    }
    const opMs = performance.now() - opStart;

    const exportStart = performance.now();
    const polygons = acc.toPolygons() as ReadonlyArray<ReadonlyArray<[number, number]>>;
    for (const s of sections) s.delete?.();
    return {
      geometry: { kind: '2d', section: { polygons } },
      timings: { importMs, opMs, exportMs: performance.now() - exportStart },
    };
  }

  /**
   * 2D convex hull of N children.
   * CrossSection.hull() is unary — for N > 1 we union first then hull,
   * which is equivalent to hulling all contours together.
   */
  private evaluate2dHull(node: Node, childGeometries: readonly Geometry[]): KernelResult {
    const importStart = performance.now();
    const sections = childGeometries.map((g, i) =>
      this.api.CrossSection.ofPolygons(
        asCrossSection(g, node.id, i).polygons as unknown as [number, number][][],
      ),
    );
    const importMs = performance.now() - importStart;

    const opStart = performance.now();
    // Use the static CrossSection.hull(polygons[]) to hull all sections at once.
    const hulled = this.api.CrossSection.hull(sections);
    const opMs = performance.now() - opStart;

    const exportStart = performance.now();
    const polygons = hulled.toPolygons() as ReadonlyArray<ReadonlyArray<[number, number]>>;
    for (const s of sections) s.delete?.();
    hulled.delete?.();
    return {
      geometry: { kind: '2d', section: { polygons } },
      timings: { importMs, opMs, exportMs: performance.now() - exportStart },
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
      case 'intersection':
        return Manifold.intersection(childSolids as Solid[]);
      case 'hull':
        return Manifold.hull(childSolids as Solid[]);
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
