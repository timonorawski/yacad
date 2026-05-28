/**
 * Unit tests for shared LuaDefinition fixtures.
 *
 * Verifies that the canonical GEAR_DEFINITION exported from fixtures.ts is a
 * structurally valid LuaDefinition AND that buildGraph accepts a NodeDoc that
 * references it with default param values. No Manifold kernel evaluation —
 * just graph construction + Lua expansion.
 *
 * Mirrors the pattern in showcase/tree/index.test.ts.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  buildGraph,
  registerNodeType,
  unregisterNodeType,
  type DefinitionResolver,
} from '@yacad/dag';
import { canonicalBytes } from '@yacad/canonical';
import { defaultHasher } from '@yacad/hash';
import {
  hashLuaDefinition,
  makeLuaNodeType,
  WasmoonLuaRuntime,
  type LuaDefinition,
} from '@yacad/lua';
import { GEAR_DEFINITION } from './fixtures';

describe('GEAR_DEFINITION (involute spur gear)', () => {
  let gearHash: string;

  beforeAll(async () => {
    gearHash = await hashLuaDefinition(GEAR_DEFINITION, defaultHasher);
  });

  afterEach(() => {
    try {
      unregisterNodeType('lua');
    } catch {
      // already unregistered — fine
    }
  });

  it('declares the documented schema (teeth/module/pressureAngle/thickness/arbor/samplesPerFlank)', () => {
    expect(GEAR_DEFINITION.schema.output).toBe('3d');
    expect(GEAR_DEFINITION.schema.inputs).toHaveLength(0);
    const paramNames = Object.keys(GEAR_DEFINITION.schema.params).sort();
    expect(paramNames).toEqual(
      ['arbor', 'module', 'pressureAngle', 'samplesPerFlank', 'teeth', 'thickness'].sort(),
    );
    expect(GEAR_DEFINITION.schema.params['teeth']).toMatchObject({
      type: 'int',
      default: 18,
      min: 8,
      max: 96,
    });
    expect(GEAR_DEFINITION.schema.params['samplesPerFlank']).toMatchObject({
      type: 'int',
      default: 6,
      min: 3,
      max: 20,
    });
  });

  it('canonicalBytes(GEAR_DEFINITION) is stable across calls', async () => {
    const b1 = canonicalBytes(GEAR_DEFINITION);
    const b2 = canonicalBytes(GEAR_DEFINITION);
    expect(b1).toEqual(b2);
    const h1 = await defaultHasher.hash(b1);
    const h2 = await defaultHasher.hash(b2);
    expect(h1).toBe(h2);
  });

  it('buildGraph accepts a NodeDoc with default param values', async () => {
    const defMap = new Map<string, LuaDefinition>([[gearHash, GEAR_DEFINITION]]);
    const resolver: DefinitionResolver = { get: (h: string) => defMap.get(h) };

    unregisterNodeType('lua');
    const runtime = new WasmoonLuaRuntime();
    registerNodeType(makeLuaNodeType(runtime, { get: (h) => defMap.get(h) }));

    const doc = {
      type: 'lua',
      params: { definitionHash: gearHash, values: {} },
    };

    await expect(buildGraph(doc, defaultHasher, '$', resolver)).resolves.toBeDefined();
  });

  it('buildGraph accepts customized teeth/module/thickness with arbor=0', async () => {
    const defMap = new Map<string, LuaDefinition>([[gearHash, GEAR_DEFINITION]]);
    const resolver: DefinitionResolver = { get: (h: string) => defMap.get(h) };

    unregisterNodeType('lua');
    const runtime = new WasmoonLuaRuntime();
    registerNodeType(makeLuaNodeType(runtime, { get: (h) => defMap.get(h) }));

    const doc = {
      type: 'lua',
      params: {
        definitionHash: gearHash,
        values: {
          teeth: 24,
          module: 2.0,
          pressureAngle: 20,
          thickness: 6,
          arbor: 0,
          samplesPerFlank: 8,
        },
      },
    };

    await expect(buildGraph(doc, defaultHasher, '$', resolver)).resolves.toBeDefined();
  });
});
