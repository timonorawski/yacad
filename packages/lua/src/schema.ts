import { DagError, type GeometryType } from '@yacad/dag';

export type LuaParamType = 'int' | 'number' | 'boolean' | 'string' | 'vec3';

export interface LuaInputDecl {
  readonly name: string;
  readonly type: GeometryType;
  readonly optional?: boolean;
}

export interface LuaParamDecl {
  readonly type: LuaParamType;
  readonly default?: unknown;
  readonly min?: number;
  readonly max?: number;
}

export interface LuaSchema {
  readonly inputs: readonly LuaInputDecl[];
  readonly params: Readonly<Record<string, LuaParamDecl>>;
  readonly output: GeometryType;
}

export interface LuaDefinition {
  readonly schema: LuaSchema;
  readonly code: string;
}

const VALID_GEOMETRY: ReadonlySet<GeometryType> = new Set(['2d', '3d']);
const VALID_PARAM_TYPES: ReadonlySet<LuaParamType> = new Set([
  'int',
  'number',
  'boolean',
  'string',
  'vec3',
]);

/** Throws DagError if the schema is structurally invalid. */
export function assertValidSchema(schema: LuaSchema, path: string): void {
  if (!VALID_GEOMETRY.has(schema.output)) {
    throw new DagError(`schema.output must be "2d" or "3d", got "${schema.output}"`, path);
  }
  const seen = new Set<string>();
  for (const input of schema.inputs) {
    if (seen.has(input.name)) {
      throw new DagError(`duplicate input name "${input.name}"`, path);
    }
    seen.add(input.name);
    if (!VALID_GEOMETRY.has(input.type)) {
      throw new DagError(`input "${input.name}" has invalid type "${input.type}"`, path);
    }
  }
  for (const [name, decl] of Object.entries(schema.params)) {
    if (!VALID_PARAM_TYPES.has(decl.type)) {
      throw new DagError(`param "${name}" has invalid param type "${decl.type}"`, path);
    }
  }
}
