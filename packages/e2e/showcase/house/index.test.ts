import { describe, expect, it } from 'vitest';
import { buildGraph } from '@yacad/dag';
import { defaultHasher } from '@yacad/hash';
import { canonicalBytes } from '@yacad/canonical';
import { makeLuaNodeType, WasmoonLuaRuntime, type LuaDefinition } from '@yacad/lua';
import { registerNodeType, unregisterNodeType } from '@yacad/dag';
import { HOUSE_DEFINITION } from './index';

/**
 * Unit tests for the parametric house showcase.
 *
 * These tests operate at the main-thread stub level: they verify that the
 * LuaDefinition is structurally valid and that buildGraph can resolve the
 * schema without throwing. They do NOT evaluate the Lua code or invoke the
 * geometry kernel — that is covered by the E2E pipeline tests.
 */

describe('House showcase — LuaDefinition structure', () => {
  it('has output type "3d"', () => {
    expect(HOUSE_DEFINITION.schema.output).toBe('3d');
  });

  it('has no inputs (standalone node)', () => {
    expect(HOUSE_DEFINITION.schema.inputs).toHaveLength(0);
  });

  it('declares 13 params', () => {
    const paramNames = Object.keys(HOUSE_DEFINITION.schema.params);
    expect(paramNames).toHaveLength(13);
  });

  it('all expected params are present with correct types', () => {
    const p = HOUSE_DEFINITION.schema.params;
    expect(p['width']?.type).toBe('number');
    expect(p['depth']?.type).toBe('number');
    expect(p['floors']?.type).toBe('int');
    expect(p['floorHeight']?.type).toBe('number');
    expect(p['wallThickness']?.type).toBe('number');
    expect(p['windowsPerSide']?.type).toBe('int');
    expect(p['windowWidth']?.type).toBe('number');
    expect(p['windowHeight']?.type).toBe('number');
    expect(p['doorWidth']?.type).toBe('number');
    expect(p['doorHeight']?.type).toBe('number');
    expect(p['roofPitch']?.type).toBe('number');
    expect(p['roofOverhang']?.type).toBe('number');
    expect(p['segments']?.type).toBe('int');
  });

  it('has sensible defaults (small 2-floor house)', () => {
    const p = HOUSE_DEFINITION.schema.params;
    expect(p['width']?.default).toBe(12);
    expect(p['depth']?.default).toBe(8);
    expect(p['floors']?.default).toBe(2);
    expect(p['floorHeight']?.default).toBe(3);
    expect(p['roofPitch']?.default).toBe(35);
  });

  it('code is a non-empty string', () => {
    expect(typeof HOUSE_DEFINITION.code).toBe('string');
    expect(HOUSE_DEFINITION.code.trim().length).toBeGreaterThan(100);
  });
});

describe('House showcase — NodeDoc round-trip via buildGraph', () => {
  it('buildGraph resolves schema, validates params, and does not throw', async () => {
    // Hash the definition so we can build a resolver.
    const defBytes = canonicalBytes(HOUSE_DEFINITION);
    const hash = await defaultHasher.hash(defBytes);

    // Stub resolver that returns HOUSE_DEFINITION for its hash.
    const resolver = {
      get: (h: string): LuaDefinition | undefined => (h === hash ? HOUSE_DEFINITION : undefined),
    };

    // Register the lua node type (uses a real WasmoonLuaRuntime for the type
    // object, but expand() is never called in buildGraph — only normalizeParams
    // and checkChildren run here, both of which are synchronous schema checks).
    const runtime = new WasmoonLuaRuntime();
    unregisterNodeType('lua');
    registerNodeType(makeLuaNodeType(runtime, resolver));

    const doc = {
      type: 'lua',
      params: {
        definitionHash: hash,
        values: {
          width: 12,
          depth: 8,
          floors: 2,
          floorHeight: 3,
          wallThickness: 0.3,
          windowsPerSide: 3,
          windowWidth: 1.0,
          windowHeight: 1.2,
          doorWidth: 1.2,
          doorHeight: 2.2,
          roofPitch: 35,
          roofOverhang: 0.4,
          segments: 1,
        },
      },
    };

    const node = await buildGraph(doc, defaultHasher, '$', resolver);

    expect(node.type).toBe('lua');
    expect(node.outputType).toBe('3d');
    expect(node.params).toMatchObject({ definitionHash: hash });

    runtime.dispose();
  });

  it('buildGraph validates floors=1 variant without error', async () => {
    const defBytes = canonicalBytes(HOUSE_DEFINITION);
    const hash = await defaultHasher.hash(defBytes);

    const resolver = {
      get: (h: string): LuaDefinition | undefined => (h === hash ? HOUSE_DEFINITION : undefined),
    };

    const runtime = new WasmoonLuaRuntime();
    unregisterNodeType('lua');
    registerNodeType(makeLuaNodeType(runtime, resolver));

    const doc = {
      type: 'lua',
      params: {
        definitionHash: hash,
        values: { floors: 1 },
      },
    };

    const node = await buildGraph(doc, defaultHasher, '$', resolver);
    expect(node.outputType).toBe('3d');

    runtime.dispose();
  });

  it('buildGraph validates windowsPerSide=5 variant without error', async () => {
    const defBytes = canonicalBytes(HOUSE_DEFINITION);
    const hash = await defaultHasher.hash(defBytes);

    const resolver = {
      get: (h: string): LuaDefinition | undefined => (h === hash ? HOUSE_DEFINITION : undefined),
    };

    const runtime = new WasmoonLuaRuntime();
    unregisterNodeType('lua');
    registerNodeType(makeLuaNodeType(runtime, resolver));

    const doc = {
      type: 'lua',
      params: {
        definitionHash: hash,
        values: { windowsPerSide: 5 },
      },
    };

    const node = await buildGraph(doc, defaultHasher, '$', resolver);
    expect(node.outputType).toBe('3d');

    runtime.dispose();
  });
});
