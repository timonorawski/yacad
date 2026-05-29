/**
 * Unit test for the filleted slab showcase.
 *
 * Verifies the LuaDefinition is structurally sound and that buildGraph accepts
 * a NodeDoc referencing it. The warp's rolling-ball geometry is exercised
 * end-to-end by the studio's e2e suite (the scene appears in the document
 * picker and renders without errors).
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
  validateLuaSource,
  WasmoonLuaRuntime,
  type LuaDefinition,
} from '@yacad/lua';
import { FILLETED_SLAB_DEFINITION } from './index';

describe('filleted slab showcase', () => {
  let defHash: string;

  beforeAll(async () => {
    defHash = await hashLuaDefinition(FILLETED_SLAB_DEFINITION, defaultHasher);
  });

  afterEach(() => {
    try {
      unregisterNodeType('lua');
    } catch {
      // already unregistered — fine
    }
  });

  it('declares the documented schema', () => {
    expect(FILLETED_SLAB_DEFINITION.schema.output).toBe('3d');
    expect(FILLETED_SLAB_DEFINITION.schema.inputs).toHaveLength(0);
    const paramNames = Object.keys(FILLETED_SLAB_DEFINITION.schema.params).sort();
    expect(paramNames).toEqual(
      ['cornerRadius', 'depth', 'edgeRadius', 'height', 'width'].sort(),
    );
    expect(FILLETED_SLAB_DEFINITION.schema.params['edgeRadius']).toMatchObject({
      type: 'number',
      default: 3,
    });
  });

  it('canonicalBytes is stable across calls', () => {
    const a = canonicalBytes(FILLETED_SLAB_DEFINITION);
    const b = canonicalBytes(FILLETED_SLAB_DEFINITION);
    expect(a).toEqual(b);
  });

  it('passes static validation (every geo.* call shape matches the registry)', () => {
    expect(() => validateLuaSource(FILLETED_SLAB_DEFINITION)).not.toThrow();
  });

  it('buildGraph accepts a NodeDoc with default values', async () => {
    const defMap = new Map<string, LuaDefinition>([[defHash, FILLETED_SLAB_DEFINITION]]);
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

  it('buildGraph accepts edgeRadius=0 (Stage B skipped)', async () => {
    const defMap = new Map<string, LuaDefinition>([[defHash, FILLETED_SLAB_DEFINITION]]);
    const resolver: DefinitionResolver = { get: (h: string) => defMap.get(h) };

    unregisterNodeType('lua');
    const runtime = new WasmoonLuaRuntime();
    registerNodeType(makeLuaNodeType(runtime, { get: (h) => defMap.get(h) }));

    const doc = {
      type: 'lua',
      params: {
        definitionHash: defHash,
        values: { width: 50, depth: 50, height: 10, cornerRadius: 5, edgeRadius: 0 },
      },
    };
    await expect(buildGraph(doc, defaultHasher, '$', resolver)).resolves.toBeDefined();
  });
});
