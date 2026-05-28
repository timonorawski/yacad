import type { NodeDoc } from '@yacad/dag';

/**
 * Path utilities for navigating a NodeDoc tree by the same string ids the
 * engine uses (`$` for root, `$/0` for first child, `$/0/1` for nested).
 * Operations return new trees — never mutate in place.
 */

/** Parse a path string into an array of child indices. `$` → []. */
export function parsePath(path: string): readonly number[] {
  if (path === '$') return [];
  if (!path.startsWith('$/')) {
    throw new Error(`invalid path "${path}": must start with "$" or "$/"`);
  }
  const parts = path.slice(2).split('/');
  const indices: number[] = [];
  for (const part of parts) {
    if (!/^[0-9]+$/.test(part)) {
      throw new Error(`invalid path "${path}": segment "${part}" must be a non-negative integer`);
    }
    indices.push(parseInt(part, 10));
  }
  return indices;
}

/** Return the node at `path`, throwing if any step is out of range. */
export function getAt(doc: NodeDoc, path: string): NodeDoc {
  let current: NodeDoc = doc;
  for (const idx of parsePath(path)) {
    const children = current.children ?? [];
    const next = children[idx];
    if (!next) {
      throw new Error(`path "${path}" out of range at index ${idx}`);
    }
    current = next;
  }
  return current;
}

/**
 * Return a new tree where the node at `path` is replaced by `replacement`.
 * `$` replaces the entire tree. Ancestors are reconstructed shallowly along
 * the path; siblings are reused by reference (structural sharing).
 */
export function replaceWithin(doc: NodeDoc, path: string, replacement: NodeDoc): NodeDoc {
  const indices = parsePath(path);
  if (indices.length === 0) return replacement;
  return rebuild(doc, indices, 0, replacement);
}

function rebuild(
  node: NodeDoc,
  indices: readonly number[],
  depth: number,
  replacement: NodeDoc,
): NodeDoc {
  const idx = indices[depth]!;
  const children = node.children ?? [];
  if (idx >= children.length) {
    throw new Error(
      `path out of range at depth ${depth}: index ${idx}, children ${children.length}`,
    );
  }
  const child = children[idx]!;
  const newChild =
    depth === indices.length - 1 ? replacement : rebuild(child, indices, depth + 1, replacement);
  const newChildren = children.slice();
  newChildren[idx] = newChild;
  return { ...node, children: newChildren };
}
