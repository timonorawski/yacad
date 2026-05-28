import type { NodeDoc } from '@yacad/dag';
import { getAt, replaceWithin } from './paths';

/**
 * Returns a new tree where the node at `path` has `params[key] = value`.
 * Other params on the node are preserved. The original tree is not mutated.
 */
export function setParam(doc: NodeDoc, path: string, key: string, value: unknown): NodeDoc {
  const target = getAt(doc, path);
  const newParams = { ...(target.params ?? {}), [key]: value };
  const newNode: NodeDoc = { ...target, params: newParams };
  return replaceWithin(doc, path, newNode);
}

/**
 * Atomic multi-key update: each entry in `patch` is applied to the node's
 * params; values of `undefined` delete the corresponding key. Other params
 * are preserved. Useful for swapping between mutually-exclusive params (set
 * one, clear the other) in a single mutation.
 */
export function setParams(doc: NodeDoc, path: string, patch: Record<string, unknown>): NodeDoc {
  const target = getAt(doc, path);
  const newParams: Record<string, unknown> = { ...(target.params ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete newParams[key];
    } else {
      newParams[key] = value;
    }
  }
  const newNode: NodeDoc = { ...target, params: newParams };
  return replaceWithin(doc, path, newNode);
}
