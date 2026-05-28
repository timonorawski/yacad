import { buildGraph, type DefinitionResolver, type Node, type NodeDoc } from '@yacad/dag';
import type { Hash } from '@yacad/hash';

/**
 * Map from authoring path ("$", "$/0", "$/1/2", …) to the output type the
 * node produces. Powers tree-row decorations (e.g., the export gadget) that
 * need to know what a node yields without re-running the worker per row.
 *
 * Computed by walking the validated graph emitted by `buildGraph`. Returns an
 * empty map if validation throws (a partial map is misleading — callers gate
 * on absence). The resolver wraps the session's blob map so Lua nodes can
 * resolve their declared output type.
 */
export async function computeOutputTypes(
  doc: NodeDoc,
  blobs: ReadonlyMap<Hash, Uint8Array>,
): Promise<Map<string, '2d' | '3d'>> {
  const resolver: DefinitionResolver = { get: (hash) => blobs.get(hash) };
  const out = new Map<string, '2d' | '3d'>();
  try {
    const root = await buildGraph(doc, undefined, '$', resolver);
    visit(root, out);
  } catch {
    // Validation failed — session is in an invalidated state. Callers see an
    // empty map and can hide the gadget rather than render stale info.
  }
  return out;
}

function visit(node: Node, out: Map<string, '2d' | '3d'>): void {
  out.set(node.id, node.outputType);
  for (const child of node.children) visit(child, out);
}
