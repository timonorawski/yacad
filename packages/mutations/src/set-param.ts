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
