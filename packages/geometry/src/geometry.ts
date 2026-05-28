import type { Mesh } from './mesh';
import type { CrossSection } from './cross-section';

/**
 * The unified output of evaluating any DAG node, discriminated by `kind`.
 * Kernel handlers return this; the engine routes via `kind` to the right
 * artifact kind for caching.
 */
export type Geometry =
  | { readonly kind: '3d'; readonly mesh: Mesh }
  | { readonly kind: '2d'; readonly section: CrossSection };

export function isMesh(g: Geometry): g is { kind: '3d'; mesh: Mesh } {
  return g.kind === '3d';
}

export function isCrossSection(g: Geometry): g is { kind: '2d'; section: CrossSection } {
  return g.kind === '2d';
}
