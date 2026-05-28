/**
 * Unit test for the parametric tree showcase.
 *
 * Verifies:
 * 1. Leaf glTF bytes can be built and are valid GLB.
 * 2. LuaDefinition is structurally sound.
 * 3. NodeDoc passes buildGraph schema validation with a mock resolver.
 *
 * No geometry evaluation (no Manifold kernel spin-up) — just graph construction.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildGraph,
  getNodeType,
  registerNodeType,
  unregisterNodeType,
  type DefinitionResolver,
} from '@yacad/dag';
import { canonicalBytes } from '@yacad/canonical';
import { defaultHasher } from '@yacad/hash';
import { IMPORT_GLTF_NODE_TYPE, IMPORT_GLTF_TYPE } from '@yacad/import-gltf';
import {
  hashLuaDefinition,
  makeLuaNodeType,
  WasmoonLuaRuntime,
  type LuaDefinition,
} from '@yacad/lua';
import { buildLeafGlb, TREE_DEFINITION } from './index';

describe('tree showcase', () => {
  let leafGltfBytes: Uint8Array;
  let leafHash: string;
  let treeDef: LuaDefinition;
  let luaDefHash: string;

  beforeAll(async () => {
    // Register the import-gltf decoder node type (idempotent guard).
    if (!getNodeType(IMPORT_GLTF_TYPE)) {
      registerNodeType(IMPORT_GLTF_NODE_TYPE);
    }

    // Build leaf glTF
    leafGltfBytes = await buildLeafGlb();
    leafHash = await defaultHasher.hash(leafGltfBytes);

    // Build the LuaDefinition with the concrete leafHash
    treeDef = {
      ...TREE_DEFINITION,
      schema: {
        ...TREE_DEFINITION.schema,
        params: {
          ...TREE_DEFINITION.schema.params,
          leafHash: { type: 'string', default: leafHash },
        },
      },
    };

    luaDefHash = await hashLuaDefinition(treeDef, defaultHasher);
  });

  it('builds a non-empty leaf GLB', () => {
    // GLB magic bytes: 0x46546C67 (little-endian "glTF")
    expect(leafGltfBytes.length).toBeGreaterThan(100);
    const view = new DataView(leafGltfBytes.buffer, leafGltfBytes.byteOffset);
    expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF" magic
  });

  it('produces a stable leaf hash', async () => {
    // Two independent builds of the leaf must hash identically (determinism).
    const bytes2 = await buildLeafGlb();
    const hash2 = await defaultHasher.hash(bytes2);
    expect(hash2).toBe(leafHash);
  });

  it('LuaDefinition has 12 params', () => {
    expect(Object.keys(treeDef.schema.params)).toHaveLength(12);
  });

  it('LuaDefinition output is 3d', () => {
    expect(treeDef.schema.output).toBe('3d');
  });

  it('LuaDefinition has no declared inputs', () => {
    expect(treeDef.schema.inputs).toHaveLength(0);
  });

  it('buildGraph validates the NodeDoc without throwing', async () => {
    // Build a combined resolver: LuaDefinition + leaf glTF blob + the Lua
    // sub-DAG's import-gltf blobs.
    const defMap = new Map<string, LuaDefinition>([[luaDefHash, treeDef]]);
    const blobMap = new Map<string, Uint8Array>([[leafHash, leafGltfBytes]]);

    const resolver: DefinitionResolver = {
      get: (h: string) => defMap.get(h) ?? blobMap.get(h),
    };

    // Register LuaNode type with a fresh runtime for this test.
    // Unregister first in case a previous test already registered it.
    unregisterNodeType('lua');
    const runtime = new WasmoonLuaRuntime();
    registerNodeType(makeLuaNodeType(runtime, { get: (h) => defMap.get(h) }));

    const doc = {
      type: 'lua',
      params: {
        definitionHash: luaDefHash,
        values: {
          leafHash,
          depth: 4,
          splits: 3,
          trunkLength: 18,
          trunkRadius: 1.1,
          lengthTaper: 0.68,
          radiusTaper: 0.6,
          branchAngle: 28,
          phyllotaxis: 137.5,
          leafScale: 0.35,
          wobble: 0,
          seed: 1,
        },
      },
    };

    await expect(buildGraph(doc, defaultHasher, '$', resolver)).resolves.toBeDefined();

    // Clean up: restore no lua node type registration so other tests start fresh.
    unregisterNodeType('lua');
  });

  it('canonicalBytes(treeDef) is stable across calls', async () => {
    const b1 = canonicalBytes(treeDef);
    const b2 = canonicalBytes(treeDef);
    expect(b1).toEqual(b2);
    const h1 = await defaultHasher.hash(b1);
    const h2 = await defaultHasher.hash(b2);
    expect(h1).toBe(h2);
  });
});
