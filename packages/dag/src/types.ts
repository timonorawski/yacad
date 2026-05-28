import type { Hash } from '@yacad/hash';

/**
 * Dual type system at node boundaries (CLAUDE.md #6). Only '3d' is exercised by
 * the POC node set, but '2d' exists so the typing machinery — and the errors it
 * catches at graph-construction time — are real from day one.
 */
export type GeometryType = '2d' | '3d';

/** Stable identity for a node within a document, used by authoring surfaces. */
export type NodeId = string;

/** A 3-component vector parameter (offset, size, angles). */
export type Vec3 = [number, number, number];

export type { Vec2 } from '@yacad/geometry';

/**
 * The authoring/document shape: plain JSON, no ids, no hashes. This is what the
 * JSON editor produces and what `buildGraph` consumes.
 */
export interface NodeDoc {
  type: string;
  params?: Record<string, unknown>;
  children?: NodeDoc[];
}

/**
 * A built, validated DAG node. `hash` is the semantic hash —
 * hash(type, canonical(normalized params), child hashes) — and is the cache
 * key for this node's geometry. `id` is authoring identity and is deliberately
 * NOT part of the hash.
 */
export interface Node {
  readonly id: NodeId;
  readonly type: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly children: readonly Node[];
  readonly outputType: GeometryType;
  readonly hash: Hash;
}

export class DagError extends Error {
  override readonly name = 'DagError';
  readonly path: string;

  constructor(message: string, path = '') {
    super(path ? `${message} (at ${path})` : message);
    this.path = path;
  }
}
