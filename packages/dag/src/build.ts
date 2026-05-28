import { canonicalBytes } from '@yacad/canonical';
import { defaultHasher, type Hash, type Hasher } from '@yacad/hash';
import { getNodeType, NOOP_RESOLVER, type DefinitionResolver } from './registry';
import { DagError, type Node, type NodeId } from './types';

/**
 * Build a validated DAG from a document, computing every node's semantic hash.
 *
 * Children are built first so their hashes feed the parent's hash — this is the
 * Merkle property: a parameter change rehashes that node and its ancestors but
 * leaves siblings untouched, which is what lets the engine recompute only the
 * affected subtree.
 *
 * `id` is a path-derived authoring identity ('$' for the root, '$/0' for its
 * first child) and is intentionally excluded from the hash.
 *
 * `resolver` is forwarded to expandable node types so they can look up their
 * stored definitions (e.g., LuaDefinition) during param normalisation, child
 * checking, and output-type resolution. Pass `undefined` to use a no-op
 * resolver (expandable nodes that require a real resolver will throw at that
 * point, not here).
 */
export async function buildGraph(
  doc: unknown,
  hasher: Hasher = defaultHasher,
  id: NodeId = '$',
  resolver: DefinitionResolver = NOOP_RESOLVER,
): Promise<Node> {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new DagError('node must be an object', id);
  }
  const record = doc as Record<string, unknown>;

  const { type } = record;
  if (typeof type !== 'string') {
    throw new DagError('node "type" must be a string', id);
  }
  if (type.startsWith('__')) {
    throw new DagError(
      `node type "${type}" uses reserved "__" prefix (engine-internal types only)`,
      id,
    );
  }

  const def = getNodeType(type);
  if (!def) {
    throw new DagError(`unknown node type "${type}"`, id);
  }

  const childDocs = record['children'] ?? [];
  if (!Array.isArray(childDocs)) {
    throw new DagError('"children" must be an array', id);
  }

  const children: Node[] = [];
  for (let i = 0; i < childDocs.length; i++) {
    children.push(await buildGraph(childDocs[i], hasher, `${id}/${i}`, resolver));
  }

  if (def.kind === 'kernel') {
    def.checkChildren(children, id);
    const params = def.normalizeParams(record['params'] ?? {}, id);
    const outputType = typeof def.output === 'function' ? def.output(children) : def.output;
    const hash = await hashNode(type, params, children, hasher);
    return { id, type, params, children, outputType, hash };
  } else {
    // Expandable node: validate and normalise via the definition, then hash.
    def.checkChildren(children, (record['params'] as Record<string, unknown>) ?? {}, resolver, id);
    const params = def.normalizeParams(record['params'] ?? {}, resolver, id);
    const outputType = def.resolveOutput(params, resolver);
    const hash = await hashNode(type, params, children, hasher);
    return { id, type, params, children, outputType, hash };
  }
}

/** Parse a JSON document string and build the graph. */
export async function buildFromJson(json: string, hasher: Hasher = defaultHasher): Promise<Node> {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch (err) {
    throw new DagError(`invalid JSON: ${(err as Error).message}`);
  }
  return buildGraph(doc, hasher);
}

function hashNode(
  type: string,
  params: Record<string, unknown>,
  children: readonly Node[],
  hasher: Hasher,
): Promise<Hash> {
  // Structured preimage: type + canonical params + ordered child hashes.
  // canonicalize() guarantees byte-stability across equivalent param objects.
  const preimage = { t: type, p: params, c: children.map((child) => child.hash) };
  return hasher.hash(canonicalBytes(preimage));
}
