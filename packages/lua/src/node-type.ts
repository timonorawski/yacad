import {
  DagError,
  type ExpandableNodeType,
  type GeometryType,
  type InputRef,
} from '@yacad/dag';
import type { LuaRuntime } from './runtime';
import type { LuaDefinition } from './schema';
import { checkInputsAgainstSchema, normalizeValues } from './validate';

export interface LuaDefinitionResolver {
  get(hash: string): LuaDefinition | undefined;
}

export function makeLuaNodeType(
  runtime: LuaRuntime,
  resolver: LuaDefinitionResolver,
): ExpandableNodeType {
  return {
    kind: 'expandable',
    type: 'lua',
    resolveOutput(params): GeometryType {
      const def = lookupDef(params, resolver, '$');
      return def.schema.output;
    },
    checkChildren(children, params, _res, path) {
      const def = lookupDef(params, resolver, path);
      checkInputsAgainstSchema(def.schema, children, path);
    },
    normalizeParams(params, _res, path) {
      const record = asRecord(params, path);
      const hash = requireString(record['definitionHash'], 'definitionHash', path);
      const def = resolver.get(hash);
      if (!def) {
        throw new DagError(`lua definition "${hash}" not loaded`, path);
      }
      const values = normalizeValues(def.schema, record['values'], path);
      return { definitionHash: hash, values };
    },
    inputNames(params): readonly string[] {
      const def = lookupDef(params, resolver, '$');
      return def.schema.inputs.map((i) => i.name);
    },
    async expand(params, inputs) {
      const def = lookupDef(params, resolver, '$');
      return runtime.evaluate(
        def,
        inputs as readonly InputRef[],
        params['values'] as Record<string, unknown>,
      );
    },
  };
}

function lookupDef(
  params: Record<string, unknown>,
  resolver: LuaDefinitionResolver,
  path: string,
): LuaDefinition {
  const hash = params['definitionHash'];
  if (typeof hash !== 'string') {
    throw new DagError('lua node params.definitionHash must be a string', path);
  }
  const def = resolver.get(hash);
  if (!def) throw new DagError(`lua definition "${hash}" not loaded`, path);
  return def;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DagError('lua node params must be an object', path);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string, path: string): string {
  if (typeof value !== 'string') {
    throw new DagError(`"${name}" must be a string`, path);
  }
  return value;
}
