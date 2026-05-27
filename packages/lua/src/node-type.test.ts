import { describe, expect, it } from 'vitest';
import { defaultHasher } from '@yacad/hash';
import { hashLuaDefinition } from './canonical';
import { WasmoonLuaRuntime } from './wasmoon-runtime';
import { makeLuaNodeType, type LuaDefinitionResolver } from './node-type';
import type { LuaDefinition } from './schema';

const trivial: LuaDefinition = {
  schema: { inputs: [], params: { sx: { type: 'number', default: 1 } }, output: '3d' },
  code: 'return geo.box({size = {params.sx, 1, 1}})',
};

function resolverFor(defs: Record<string, LuaDefinition>): LuaDefinitionResolver {
  return { get: (hash) => defs[hash] };
}

describe('makeLuaNodeType', () => {
  it('returns an ExpandableNodeType with kind="expandable" and type="lua"', () => {
    const runtime = new WasmoonLuaRuntime();
    const def = makeLuaNodeType(runtime, resolverFor({}));
    expect(def.kind).toBe('expandable');
    expect(def.type).toBe('lua');
    runtime.dispose();
  });

  it('resolveOutput reads schema.output from the resolved definition', async () => {
    const hash = await hashLuaDefinition(trivial, defaultHasher);
    const runtime = new WasmoonLuaRuntime();
    const def = makeLuaNodeType(runtime, resolverFor({ [hash]: trivial }));
    expect(
      def.resolveOutput({ definitionHash: hash, values: {} }, resolverFor({ [hash]: trivial })),
    ).toBe('3d');
    runtime.dispose();
  });

  it('normalizeParams normalizes values + carries the hash through', async () => {
    const hash = await hashLuaDefinition(trivial, defaultHasher);
    const runtime = new WasmoonLuaRuntime();
    const resolver = resolverFor({ [hash]: trivial });
    const def = makeLuaNodeType(runtime, resolver);
    const out = def.normalizeParams({ definitionHash: hash, values: { sx: 2 } }, resolver, '$');
    expect(out).toEqual({ definitionHash: hash, values: { sx: 2 } });
  });

  it('rejects unresolved definition hashes at normalizeParams', async () => {
    const runtime = new WasmoonLuaRuntime();
    const def = makeLuaNodeType(runtime, resolverFor({}));
    expect(() =>
      def.normalizeParams({ definitionHash: 'nope', values: {} }, resolverFor({}), '$'),
    ).toThrow(/not loaded|not resolvable|unknown/i);
    runtime.dispose();
  });

  it('expand() runs Lua and returns the emitted NodeDoc', async () => {
    const hash = await hashLuaDefinition(trivial, defaultHasher);
    const runtime = new WasmoonLuaRuntime();
    const def = makeLuaNodeType(runtime, resolverFor({ [hash]: trivial }));
    const doc = await def.expand({ definitionHash: hash, values: { sx: 5 } }, []);
    expect(doc).toEqual({ type: 'box', params: { size: [5, 1, 1] }, children: [] });
    runtime.dispose();
  });

  it('inputNames returns names keyed by declared schema input names', async () => {
    const defWithInputs: LuaDefinition = {
      schema: {
        inputs: [
          { name: 'base', type: '3d' },
          { name: 'cutter', type: '3d' },
        ],
        params: {},
        output: '3d',
      },
      code: 'return geo.difference({inputs.base, inputs.cutter})',
    };
    const hash = await hashLuaDefinition(defWithInputs, defaultHasher);
    const runtime = new WasmoonLuaRuntime();
    const def = makeLuaNodeType(runtime, resolverFor({ [hash]: defWithInputs }));
    const names = def.inputNames(
      { definitionHash: hash, values: {} },
      resolverFor({ [hash]: defWithInputs }),
    );
    expect(names).toEqual(['base', 'cutter']);
    runtime.dispose();
  });
});
