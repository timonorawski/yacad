import { type Manifold as Solid, type ManifoldToplevel } from 'manifold-3d';
import type { Node, Vec3 } from '@yacad/dag';
import type { Mesh } from '@yacad/geometry';
import { KERNEL_NAME, KERNEL_VERSION } from './loader';

/**
 * Evaluates one DAG node to a mesh, given its children's already-evaluated
 * meshes. Deterministic given its inputs (CLAUDE.md #2): no clock, RNG, or I/O.
 */
export interface Kernel {
  readonly name: string;
  readonly version: string;
  evaluate(node: Node, childMeshes: readonly Mesh[]): Mesh;
}

/**
 * The primary kernel (CLAUDE.md #7), backed by Manifold WASM.
 *
 * Children arrive as meshes — the cached artifact type — so transforms and
 * booleans reconstruct Manifold solids from them via the Manifold constructor,
 * which re-welds coincident vertices into a watertight solid. WASM-backed
 * solids are explicitly freed once their mesh is extracted.
 */
export class ManifoldKernel implements Kernel {
  readonly name = KERNEL_NAME;
  readonly version = KERNEL_VERSION;

  constructor(private readonly api: ManifoldToplevel) {}

  evaluate(node: Node, childMeshes: readonly Mesh[]): Mesh {
    const solid = this.buildSolid(node, childMeshes);
    try {
      return this.toMesh(solid);
    } finally {
      solid.delete();
    }
  }

  private buildSolid(node: Node, childMeshes: readonly Mesh[]): Solid {
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
        return this.transform(childMeshes[0]!, (s) => s.translate(p.offset));
      }
      case 'rotate': {
        const p = node.params as { angles: Vec3 };
        return this.transform(childMeshes[0]!, (s) => s.rotate(p.angles));
      }
      case 'union':
        return this.combine(childMeshes, (solids) => Manifold.union(solids));
      case 'difference':
        return this.combine(childMeshes, (solids) => Manifold.difference(solids));
      default:
        throw new Error(`manifold kernel cannot evaluate node type "${node.type}"`);
    }
  }

  private transform(child: Mesh, op: (solid: Solid) => Solid): Solid {
    const solid = this.toSolid(child);
    try {
      return op(solid);
    } finally {
      solid.delete();
    }
  }

  private combine(childMeshes: readonly Mesh[], op: (solids: Solid[]) => Solid): Solid {
    const solids = childMeshes.map((m) => this.toSolid(m));
    try {
      return op(solids);
    } finally {
      for (const s of solids) s.delete();
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
