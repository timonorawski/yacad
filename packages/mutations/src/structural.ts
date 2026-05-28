import type { NodeDoc } from '@yacad/dag';
import { getAt, parsePath, replaceWithin } from './paths';

export function addChild(
  doc: NodeDoc,
  parentPath: string,
  child: NodeDoc,
  index?: number,
): NodeDoc {
  const parent = getAt(doc, parentPath);
  const children = parent.children ?? [];
  const insertAt = index ?? children.length;
  if (insertAt < 0 || insertAt > children.length) {
    throw new Error(
      `addChild index ${insertAt} out of range (parent has ${children.length} children)`,
    );
  }
  const newChildren = [...children.slice(0, insertAt), child, ...children.slice(insertAt)];
  return replaceWithin(doc, parentPath, { ...parent, children: newChildren });
}

export function removeAt(doc: NodeDoc, path: string): NodeDoc {
  const indices = parsePath(path);
  if (indices.length === 0) {
    throw new Error('cannot remove root node');
  }
  const parentIndices = indices.slice(0, -1);
  const childIndex = indices[indices.length - 1]!;
  const parentPath = parentIndices.length === 0 ? '$' : '$/' + parentIndices.join('/');
  const parent = getAt(doc, parentPath);
  const children = parent.children ?? [];
  if (childIndex < 0 || childIndex >= children.length) {
    throw new Error(`removeAt index ${childIndex} out of range`);
  }
  const newChildren = [...children.slice(0, childIndex), ...children.slice(childIndex + 1)];
  return replaceWithin(doc, parentPath, { ...parent, children: newChildren });
}

export function replaceAt(doc: NodeDoc, path: string, replacement: NodeDoc): NodeDoc {
  return replaceWithin(doc, path, replacement);
}

export function wrapWith(
  doc: NodeDoc,
  path: string,
  wrapperType: string,
  wrapperParams: Record<string, unknown> = {},
): NodeDoc {
  const target = getAt(doc, path);
  const wrapped: NodeDoc = {
    type: wrapperType,
    params: wrapperParams,
    children: [target],
  };
  return replaceWithin(doc, path, wrapped);
}

/**
 * Replace the node at `path` with its sole child. Inverse of `wrapWith`.
 * Throws if the node doesn't have exactly one child.
 *
 *   unwrap({ translate, [box] }, '$') → box
 *   unwrap(tree, '$/0') replaces the first child of root with its grandchild.
 */
export function unwrap(doc: NodeDoc, path: string): NodeDoc {
  const node = getAt(doc, path);
  const children = node.children ?? [];
  if (children.length !== 1) {
    throw new Error(
      `unwrap requires exactly 1 child at ${path} (found ${children.length})`,
    );
  }
  return replaceWithin(doc, path, children[0]!);
}

export function moveChild(doc: NodeDoc, fromPath: string, toPath: string): NodeDoc {
  if (fromPath === toPath) {
    throw new Error('moveChild source and destination are the same');
  }
  const node = getAt(doc, fromPath);
  const removed = removeAt(doc, fromPath);
  // Interpret `toPath` as the target index within its parent after removal.
  const toIndices = parsePath(toPath);
  if (toIndices.length === 0) {
    throw new Error('moveChild destination cannot be the root');
  }
  const destParentIndices = toIndices.slice(0, -1);
  const destChildIndex = toIndices[toIndices.length - 1]!;
  const destParentPath = destParentIndices.length === 0 ? '$' : '$/' + destParentIndices.join('/');
  return addChild(removed, destParentPath, node, destChildIndex);
}
