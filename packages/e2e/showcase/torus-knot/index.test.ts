/**
 * Unit test for the torus knot showcase.
 *
 * Verifies the LuaDefinition is structurally sound and that buildGraph
 * accepts a NodeDoc referencing it. No kernel evaluation — that path is
 * covered by the warp kernel tests in @yacad/kernel-manifold.
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
import { TORUS_KNOT_DEFINITION } from './index';

describe('torus knot showcase', () => {
  let defHash: string;

  beforeAll(async () => {
    defHash = await hashLuaDefinition(TORUS_KNOT_DEFINITION, defaultHasher);
  });

  afterEach(() => {
    try {
      unregisterNodeType('lua');
    } catch {
      // already unregistered — fine
    }
  });

  it('declares the documented schema', () => {
    expect(TORUS_KNOT_DEFINITION.schema.output).toBe('3d');
    expect(TORUS_KNOT_DEFINITION.schema.inputs).toHaveLength(0);
    const paramNames = Object.keys(TORUS_KNOT_DEFINITION.schema.params).sort();
    expect(paramNames).toEqual(
      ['circularSegments', 'majorRadius', 'minorRadius', 'p', 'q', 'threadRadius'].sort(),
    );
    expect(TORUS_KNOT_DEFINITION.schema.params['p']).toMatchObject({
      type: 'int',
      default: 1,
      min: 1,
      max: 8,
    });
    expect(TORUS_KNOT_DEFINITION.schema.params['q']).toMatchObject({
      type: 'int',
      default: 3,
      min: 1,
      max: 8,
    });
  });

  it('canonicalBytes is stable across calls', async () => {
    const a = canonicalBytes(TORUS_KNOT_DEFINITION);
    const b = canonicalBytes(TORUS_KNOT_DEFINITION);
    expect(a).toEqual(b);
  });

  it('buildGraph accepts a NodeDoc with default values', async () => {
    const defMap = new Map<string, LuaDefinition>([[defHash, TORUS_KNOT_DEFINITION]]);
    const resolver: DefinitionResolver = { get: (h: string) => defMap.get(h) };

    unregisterNodeType('lua');
    const runtime = new WasmoonLuaRuntime();
    registerNodeType(makeLuaNodeType(runtime, { get: (h) => defMap.get(h) }));

    const doc = {
      type: 'lua',
      params: { definitionHash: defHash, values: {} },
    };
    await expect(buildGraph(doc, defaultHasher, '$', resolver)).resolves.toBeDefined();
  });

  it('buildGraph accepts customized p/q values', async () => {
    const defMap = new Map<string, LuaDefinition>([[defHash, TORUS_KNOT_DEFINITION]]);
    const resolver: DefinitionResolver = { get: (h: string) => defMap.get(h) };

    unregisterNodeType('lua');
    const runtime = new WasmoonLuaRuntime();
    registerNodeType(makeLuaNodeType(runtime, { get: (h) => defMap.get(h) }));

    const doc = {
      type: 'lua',
      params: {
        definitionHash: defHash,
        values: {
          p: 2,
          q: 5,
          majorRadius: 30,
          minorRadius: 8,
          threadRadius: 2,
          circularSegments: 32,
        },
      },
    };
    await expect(buildGraph(doc, defaultHasher, '$', resolver)).resolves.toBeDefined();
  });
});
