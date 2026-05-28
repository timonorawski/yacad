import { DagError } from './types';
import type { Vec3 } from './types';
import type { Vec2 } from '@yacad/geometry';

/** Narrow an unknown params payload to a plain record. */
export function asRecord(params: unknown, path: string): Record<string, unknown> {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new DagError('params must be an object', path);
  }
  return params as Record<string, unknown>;
}

export function num(p: Record<string, unknown>, key: string, path: string): number {
  const v = p[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new DagError(`"${key}" must be a finite number`, path);
  }
  return v;
}

export function posNum(p: Record<string, unknown>, key: string, path: string): number {
  const v = num(p, key, path);
  if (v <= 0) throw new DagError(`"${key}" must be greater than 0`, path);
  return v;
}

export function vec3(p: Record<string, unknown>, key: string, path: string): Vec3 {
  const v = p[key];
  if (!Array.isArray(v) || v.length !== 3) {
    throw new DagError(`"${key}" must be a 3-element array`, path);
  }
  for (let i = 0; i < 3; i++) {
    const n = v[i];
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new DagError(`"${key}[${i}]" must be a finite number`, path);
    }
  }
  return [v[0] as number, v[1] as number, v[2] as number];
}

export function posVec3(p: Record<string, unknown>, key: string, path: string): Vec3 {
  const v = vec3(p, key, path);
  for (let i = 0; i < 3; i++) {
    if (v[i]! <= 0) throw new DagError(`"${key}[${i}]" must be greater than 0`, path);
  }
  return v;
}

export function vec2(p: Record<string, unknown>, key: string, path: string): Vec2 {
  const v = p[key];
  if (!Array.isArray(v) || v.length !== 2) {
    throw new DagError(`"${key}" must be a 2-element array`, path);
  }
  for (let i = 0; i < 2; i++) {
    const n = v[i];
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new DagError(`"${key}[${i}]" must be a finite number`, path);
    }
  }
  return [v[0] as number, v[1] as number];
}

export function posVec2(p: Record<string, unknown>, key: string, path: string): Vec2 {
  const v = vec2(p, key, path);
  for (let i = 0; i < 2; i++) {
    if (v[i]! <= 0) throw new DagError(`"${key}[${i}]" must be greater than 0`, path);
  }
  return v;
}

export function optBool(
  p: Record<string, unknown>,
  key: string,
  path: string,
  fallback: boolean,
): boolean {
  const v = p[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') throw new DagError(`"${key}" must be a boolean`, path);
  return v;
}

/** Optional integer segment count for circular primitives (minimum 3). */
export function optSegments(
  p: Record<string, unknown>,
  key: string,
  path: string,
  fallback: number,
): number {
  const v = p[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 3) {
    throw new DagError(`"${key}" must be an integer >= 3`, path);
  }
  return v;
}

export function vec2Array(
  p: Record<string, unknown>,
  key: string,
  path: string,
  minLen: number,
): Vec2[] {
  const v = p[key];
  if (!Array.isArray(v)) {
    throw new DagError(`"${key}" must be an array`, path);
  }
  if (v.length < minLen) {
    throw new DagError(`"${key}" must have at least ${minLen} entries`, path);
  }
  return v.map((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new DagError(`"${key}[${i}]" must be a 2-element array`, path);
    }
    for (let j = 0; j < 2; j++) {
      const n = entry[j];
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        throw new DagError(`"${key}[${i}][${j}]" must be a finite number`, path);
      }
    }
    return [entry[0] as number, entry[1] as number] as Vec2;
  });
}
