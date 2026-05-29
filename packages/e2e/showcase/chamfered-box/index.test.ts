/**
 * Unit test for the chamfered box showcase.
 *
 * Verifies the LuaDefinition is structurally sound and that buildGraph accepts
 * a NodeDoc referencing it. The boolean-decomposition geometry itself is
 * covered by full pipeline evaluation in the studio's e2e suite (the scene
 * appears in the document picker and renders without errors).
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
import { CHAMFERED_BOX_DEFINITION } from './index';

describe('chamfered box showcase', () => {
  let defHash: string;

  beforeAll(async () => {
    defHash = await hashLuaDefinition(CHAMFERED_BOX_DEFINITION, defaultHasher);
  });

  afterEach(() => {
    try {
      unregisterNodeType('lua');
    } catch {
      // already unregistered — fine
    }
  });

  it('declares the documented schema', () => {
    expect(CHAMFERED_BOX_DEFINITION.schema.output).toBe('3d');
    expect(CHAMFERED_BOX_DEFINITION.schema.inputs).toHaveLength(0);
    const paramNames = Object.keys(CHAMFERED_BOX_DEFINITION.schema.params).sort();
    expect(paramNames).toEqual(['chamfer', 'depth', 'height', 'width'].sort());
    expect(CHAMFERED_BOX_DEFINITION.schema.params['chamfer']).toMatchObject({
      type: 'number',
      default: 5,
    });
  });

  it('canonicalBytes is stable across calls', () => {
    const a = canonicalBytes(CHAMFERED_BOX_DEFINITION);
    const b = canonicalBytes(CHAMFERED_BOX_DEFINITION);
    expect(a).toEqual(b);
  });

  it('passes static validation (every geo.* call shape matches the registry)', () => {
    expect(() => validateLuaSource(CHAMFERED_BOX_DEFINITION)).not.toThrow();
  });

  it('buildGraph accepts a NodeDoc with default values', async () => {
    const defMap = new Map<string, LuaDefinition>([[defHash, CHAMFERED_BOX_DEFINITION]]);
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

  it('buildGraph accepts custom dimensions', async () => {
    const defMap = new Map<string, LuaDefinition>([[defHash, CHAMFERED_BOX_DEFINITION]]);
    const resolver: DefinitionResolver = { get: (h: string) => defMap.get(h) };

    unregisterNodeType('lua');
    const runtime = new WasmoonLuaRuntime();
    registerNodeType(makeLuaNodeType(runtime, { get: (h) => defMap.get(h) }));

    const doc = {
      type: 'lua',
      params: {
        definitionHash: defHash,
        values: { width: 80, depth: 60, height: 40, chamfer: 3 },
      },
    };
    await expect(buildGraph(doc, defaultHasher, '$', resolver)).resolves.toBeDefined();
  });
});
