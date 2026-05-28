import { describe, expect, it, afterAll } from 'vitest';
import { buildGraph, registerNodeType, unregisterNodeType } from '@yacad/dag';
import { defaultHasher } from '@yacad/hash';
import { hashLuaDefinition } from '@yacad/lua';
import { WasmoonLuaRuntime } from '@yacad/lua';
import { makeLuaNodeType } from '@yacad/lua';
import type { LuaDefinitionResolver } from '@yacad/lua';
import { CASTLE_DEFINITION } from './index';

describe('Showcase: parametric castle', () => {
  let runtime: WasmoonLuaRuntime | undefined;

  afterAll(() => {
    unregisterNodeType('lua');
    runtime?.dispose();
  });

  it('LuaDefinition has 12 params and output "3d"', () => {
    expect(CASTLE_DEFINITION.schema.output).toBe('3d');
    expect(CASTLE_DEFINITION.schema.inputs).toHaveLength(0);
    expect(Object.keys(CASTLE_DEFINITION.schema.params)).toHaveLength(12);
  });

  it('buildGraph resolves without throwing with a matching resolver', async () => {
    const hash = await hashLuaDefinition(CASTLE_DEFINITION, defaultHasher);

    const resolver: LuaDefinitionResolver = {
      get: (h) => (h === hash ? CASTLE_DEFINITION : undefined),
    };

    runtime = new WasmoonLuaRuntime();
    // Register the lua node type so buildGraph can resolve it.
    // Unregister first in case a prior test left it registered.
    try {
      unregisterNodeType('lua');
    } catch {
      // not registered — that is fine
    }
    registerNodeType(makeLuaNodeType(runtime, resolver));

    const doc = {
      type: 'lua',
      params: {
        definitionHash: hash,
        values: {
          courtyardSize: 20,
          wallHeight: 8,
          wallThickness: 2,
          towerRadius: 3,
          towerHeight: 12,
          towerSegments: 16,
          crenellationCount: 6,
          merlonWidth: 1.2,
          crenellationHeight: 1.5,
          crenellationDepth: 2,
          gateWidth: 3,
          gateHeight: 5,
        },
      },
    };

    await expect(buildGraph(doc, defaultHasher, '$', resolver)).resolves.not.toThrow();
  });
});
