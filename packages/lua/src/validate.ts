import { DagError, type Node } from '@yacad/dag';
import type { LuaParamDecl, LuaSchema } from './schema';

/** Normalize user-supplied values against the schema. Mirrors validate.ts in
 *  @yacad/dag in shape: returns a record suitable for canonical hashing. */
export function normalizeValues(
  schema: LuaSchema,
  values: unknown,
  path: string,
): Record<string, unknown> {
  if (
    values !== undefined &&
    (typeof values !== 'object' || values === null || Array.isArray(values))
  ) {
    throw new DagError('values must be an object', path);
  }
  const supplied = (values ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, decl] of Object.entries(schema.params)) {
    out[name] = normalizeOne(name, decl, supplied[name], path);
  }
  return out;
}

function normalizeOne(name: string, decl: LuaParamDecl, raw: unknown, path: string): unknown {
  if (raw === undefined) {
    if (decl.default === undefined) {
      throw new DagError(`param "${name}" is required (no default)`, path);
    }
    return decl.default;
  }
  switch (decl.type) {
    case 'int': {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        throw new DagError(`param "${name}" must be an integer`, path);
      }
      if (decl.min !== undefined && raw < decl.min) {
        throw new DagError(`param "${name}" must be >= ${decl.min}`, path);
      }
      if (decl.max !== undefined && raw > decl.max) {
        throw new DagError(`param "${name}" must be <= ${decl.max}`, path);
      }
      return raw;
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new DagError(`param "${name}" must be a finite number`, path);
      }
      if (decl.min !== undefined && raw < decl.min) {
        throw new DagError(`param "${name}" must be >= ${decl.min}`, path);
      }
      if (decl.max !== undefined && raw > decl.max) {
        throw new DagError(`param "${name}" must be <= ${decl.max}`, path);
      }
      return raw;
    }
    case 'boolean': {
      if (typeof raw !== 'boolean') {
        throw new DagError(`param "${name}" must be a boolean`, path);
      }
      return raw;
    }
    case 'string': {
      if (typeof raw !== 'string') {
        throw new DagError(`param "${name}" must be a string`, path);
      }
      return raw;
    }
    case 'vec3': {
      if (
        !Array.isArray(raw) ||
        raw.length !== 3 ||
        !raw.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) {
        throw new DagError(`param "${name}" must be a 3-element finite-number array`, path);
      }
      return [raw[0], raw[1], raw[2]];
    }
    default:
      throw new DagError(`unknown param type "${(decl as { type: string }).type}"`, path);
  }
}

/** Check positional children against the schema's declared inputs.
 *  Required inputs are identified by scanning declared inputs in order — does
 *  NOT assume required-before-optional declaration order. */
export function checkInputsAgainstSchema(
  schema: LuaSchema,
  children: readonly Node[],
  path: string,
): void {
  if (children.length > schema.inputs.length) {
    throw new DagError(
      `too many children: expected at most ${schema.inputs.length}, got ${children.length}`,
      path,
    );
  }
  // Validate types of supplied children first.
  for (let i = 0; i < children.length; i++) {
    const decl = schema.inputs[i]!;
    const actual = children[i]!.outputType;
    if (actual !== decl.type) {
      throw new DagError(
        `input "${decl.name}" expected ${decl.type} but got ${actual}`,
        `${path}/${i}`,
      );
    }
  }
  // Then walk the tail for any required-but-missing inputs.
  for (let i = children.length; i < schema.inputs.length; i++) {
    const decl = schema.inputs[i]!;
    if (!decl.optional) {
      throw new DagError(`required input "${decl.name}" missing`, path);
    }
  }
}
