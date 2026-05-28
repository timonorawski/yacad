import type { DocLibrary } from '@yacad/doc-store';
import type { NodeDoc } from '@yacad/dag';
import type { Mesh } from '@yacad/geometry';
import { defaultHasher } from '@yacad/hash';
import { canonicalBytes } from '@yacad/canonical';
import { meshToBinaryStl } from '@yacad/export-stl';
import { hashStlBlob } from '@yacad/import-stl';
import { hashObjBlob } from '@yacad/import-obj';
import { SAMPLE_OBJ_BYTES } from './sample-obj';
import { GEAR_DEFINITION, ARRAY_ALONG_X_DEFINITION, FLOWER_DEFINITION } from '@yacad/e2e/fixtures';
import { seedHouseShowcase } from '@yacad/e2e/showcase/house';
import { seedCastleShowcase } from '@yacad/e2e/showcase/castle';
import { seedTreeShowcase } from '@yacad/e2e/showcase/tree';
import sceneBox from '../../../packages/e2e/scenes/primitives/box.json?raw';
import sceneSphere from '../../../packages/e2e/scenes/primitives/sphere.json?raw';
import sceneCylinder from '../../../packages/e2e/scenes/primitives/cylinder.json?raw';
import sceneTranslatedBox from '../../../packages/e2e/scenes/transforms/translated-box.json?raw';
import sceneRotatedCylinder from '../../../packages/e2e/scenes/transforms/rotated-cylinder.json?raw';
import sceneUnionStack from '../../../packages/e2e/scenes/booleans/union-stack.json?raw';
import sceneBoxMinusSphere from '../../../packages/e2e/scenes/booleans/box-minus-sphere.json?raw';
import sceneCoredBlock from '../../../packages/e2e/scenes/composite/cored-block.json?raw';
import sceneCircle from '../../../packages/e2e/scenes/2d/circle.json?raw';
import sceneSplineStar from '../../../packages/e2e/scenes/2d/spline-star.json?raw';
import sceneRoundedRect from '../../../packages/e2e/scenes/2d/rounded-rect.json?raw';
import sceneExtrudedGear from '../../../packages/e2e/scenes/composite/extruded-gear.json?raw';
import sceneRevolvedVase from '../../../packages/e2e/scenes/composite/revolved-vase.json?raw';
import sceneTangent from '../../../packages/e2e/scenes/edge-cases/tangent-sphere-box.json?raw';
import sceneSharedFace from '../../../packages/e2e/scenes/edge-cases/shared-face-cubes.json?raw';
import sceneInteriorVoid from '../../../packages/e2e/scenes/edge-cases/interior-void.json?raw';
import sceneTransforms2d from '../../../packages/e2e/scenes/2d/transforms-2d.json?raw';
import sceneSplineGasket from '../../../packages/e2e/scenes/2d/spline-gasket.json?raw';
import sceneRefinedSphere from '../../../packages/e2e/scenes/composite/refined-sphere.json?raw';
import sceneBoxIntCylinder from '../../../packages/e2e/scenes/booleans/box-int-cylinder.json?raw';
import sceneHullTet from '../../../packages/e2e/scenes/composite/hull-tetrahedral-spheres.json?raw';

// ─── v1 procedural generators (copied verbatim from apps/studio/src/App.svelte) ─

/** `depth` nested translates over a sphere — a long cache-invalidation chain. */
function transformChain(depth: number, radius: number): NodeDoc {
  let node: NodeDoc = { type: 'sphere', params: { radius, segments: 16 } };
  for (let i = 0; i < depth; i++) {
    node = { type: 'translate', params: { offset: [1, 0, 0] }, children: [node] };
  }
  return node;
}

/** union(difference(<inner>, sphere), translate(box)) nested `levels` deep. */
function boolNest(levels: number): NodeDoc {
  if (levels === 0) return { type: 'box', params: { size: [10, 10, 10], center: true } };
  return {
    type: 'union',
    children: [
      {
        type: 'difference',
        children: [boolNest(levels - 1), { type: 'sphere', params: { radius: 4, segments: 16 } }],
      },
      {
        type: 'translate',
        params: { offset: [6 * levels, 0, 0] },
        children: [{ type: 'box', params: { size: [6, 6, 6], center: true } }],
      },
    ],
  };
}

/** Tiny deterministic PRNG so wobble stays reproducible for the same seed. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TreeOpts {
  depth: number; // recursion levels above the leaf branches
  splits: number; // sub-branches per branch
  trunkLength: number;
  trunkRadius: number;
  lengthTaper: number; // child length = parent length × this
  radiusTaper: number; // child radius = parent radius × this
  branchAngle: number; // degrees from parent axis
  phyllotaxis: number; // degrees between successive children around parent axis
  leafScale: number; // leaf radius = branch length × this
  trunkSegments: number;
  leafSegments: number;
  /** ±degrees of deterministic per-branch perturbation; 0 ⇒ fully symmetric (max cache dedup). */
  wobble: number;
  seed: number;
}

/**
 * Generate a recursive branching tree as a DAG. Each branch is a cylinder
 * pointing +Z; sub-branches are rotated by `branchAngle` away from that axis
 * and spun around it by successive multiples of the golden angle
 * (`phyllotaxis`). Leaves are spheres at the branch tips.
 *
 * With `wobble: 0` every sub-branch at a given depth is structurally identical,
 * so content-addressing dedupes aggressively (a few dozen kernel calls cover
 * hundreds of node references). With `wobble > 0` each branch picks up a
 * deterministic perturbation from a seeded PRNG, breaking dedup — every branch
 * becomes a unique cache miss, hammering the kernel.
 */
function procTree(opts: TreeOpts): NodeDoc {
  const prng = mulberry32(opts.seed);
  const jitter = (range: number) => (opts.wobble ? (prng() * 2 - 1) * range : 0);

  function build(length: number, radius: number, depth: number, segments: number): NodeDoc {
    const trunk: NodeDoc = {
      type: 'cylinder',
      params: { height: length, radius, segments, center: false },
    };
    if (depth === 0) {
      const leaf: NodeDoc = {
        type: 'translate',
        params: { offset: [0, 0, length] },
        children: [
          {
            type: 'sphere',
            params: { radius: length * opts.leafScale, segments: opts.leafSegments },
          },
        ],
      };
      return { type: 'union', children: [trunk, leaf] };
    }

    const subLen = length * opts.lengthTaper;
    const subRad = radius * opts.radiusTaper;
    const subSeg = Math.max(6, Math.round(segments * 0.8));

    const children: NodeDoc[] = [trunk];
    for (let i = 0; i < opts.splits; i++) {
      const phi = i * opts.phyllotaxis + jitter(opts.wobble * 6);
      const ba = opts.branchAngle + jitter(opts.wobble);
      const sub = build(subLen, subRad, depth - 1, subSeg);
      children.push({
        type: 'translate',
        params: { offset: [0, 0, length] },
        children: [{ type: 'rotate', params: { angles: [0, ba, phi] }, children: [sub] }],
      });
    }
    return { type: 'union', children };
  }

  return build(opts.trunkLength, opts.trunkRadius, opts.depth, opts.trunkSegments);
}

const treeBaseOpts: TreeOpts = {
  depth: 3,
  splits: 3,
  trunkLength: 18,
  trunkRadius: 1.1,
  lengthTaper: 0.68,
  radiusTaper: 0.6,
  branchAngle: 28,
  phyllotaxis: 137.5,
  leafScale: 0.4,
  trunkSegments: 14,
  leafSegments: 12,
  wobble: 0,
  seed: 1,
};

// ─── Sample STL blob (a hand-rolled cube, copied from v1) ──────────────────────

const SAMPLE_STL_BYTES: Uint8Array = (() => {
  const cubeMesh: Mesh = {
    vertices: new Float32Array([
      -10, -10, -10 /* 0 */, 10, -10, -10 /* 1 */, -10, 10, -10 /* 2 */, 10, 10, -10 /* 3 */, -10,
      -10, 10 /* 4 */, 10, -10, 10 /* 5 */, -10, 10, 10 /* 6 */, 10, 10, 10 /* 7 */,
    ]),
    indices: new Uint32Array([
      0,
      2,
      3,
      0,
      3,
      1, // bottom (-z)
      4,
      5,
      7,
      4,
      7,
      6, // top    (+z)
      0,
      1,
      5,
      0,
      5,
      4, // front  (-y)
      2,
      6,
      7,
      2,
      7,
      3, // back   (+y)
      0,
      4,
      6,
      0,
      6,
      2, // left   (-x)
      1,
      3,
      7,
      1,
      7,
      5, // right  (+x)
    ]),
  };
  return meshToBinaryStl(cubeMesh);
})();

// ─── Seeder ─────────────────────────────────────────────────────────────────────

interface StaticScene {
  name: string;
  json: string;
}

const STATIC_SCENES: StaticScene[] = [
  { name: 'Box', json: sceneBox },
  { name: 'Sphere', json: sceneSphere },
  { name: 'Cylinder', json: sceneCylinder },
  { name: 'Translated box', json: sceneTranslatedBox },
  { name: 'Rotated cylinder', json: sceneRotatedCylinder },
  { name: 'Union stack', json: sceneUnionStack },
  { name: 'Box minus sphere', json: sceneBoxMinusSphere },
  { name: 'Cored block', json: sceneCoredBlock },
  { name: 'Circle (2D)', json: sceneCircle },
  { name: 'Spline star (2D)', json: sceneSplineStar },
  { name: 'Rounded rect (2D)', json: sceneRoundedRect },
  { name: '2D transforms demo', json: sceneTransforms2d },
  { name: 'Spline gasket plate (2D)', json: sceneSplineGasket },
  { name: 'Refine: sphere n=3', json: sceneRefinedSphere },
  { name: 'Intersection: box ∩ cylinder', json: sceneBoxIntCylinder },
  { name: 'Hull: tetrahedral spheres', json: sceneHullTet },
  { name: 'Extruded gear', json: sceneExtrudedGear },
  { name: 'Revolved vase', json: sceneRevolvedVase },
  { name: 'Tangent sphere/box', json: sceneTangent },
  { name: 'Shared face cubes', json: sceneSharedFace },
  { name: 'Interior void', json: sceneInteriorVoid },
];

interface LuaSceneSpec {
  name: string;
  defConstant: typeof GEAR_DEFINITION;
  buildDoc: (definitionHash: string) => NodeDoc;
}

/** Seed the library on first run. Idempotent — only runs when library.list() is empty. */
export async function seedSceneLibrary(library: DocLibrary): Promise<void> {
  if ((await library.list()).length > 0) return;

  for (const scene of STATIC_SCENES) {
    const doc = JSON.parse(scene.json) as NodeDoc;
    const session = await library.create(scene.name, doc);
    await session.close();
  }

  const luaScenes: LuaSceneSpec[] = [
    {
      name: 'Lua: parametric gear',
      defConstant: GEAR_DEFINITION,
      buildDoc: (hash) => ({
        type: 'lua',
        params: {
          definitionHash: hash,
          values: { teeth: 18, module: 1.0, pressureAngle: 20, thickness: 4, arbor: 2 },
        },
      }),
    },
    {
      name: 'Lua: array along X',
      defConstant: ARRAY_ALONG_X_DEFINITION,
      buildDoc: (hash) => ({
        type: 'lua',
        params: { definitionHash: hash, values: { count: 4 } },
        children: [{ type: 'sphere', params: { radius: 3 } }],
      }),
    },
    {
      name: 'Lua: 2D flower (extruded)',
      defConstant: FLOWER_DEFINITION,
      buildDoc: (hash) => ({
        type: 'extrude',
        params: { height: 4 },
        children: [{ type: 'lua', params: { definitionHash: hash, values: {} } }],
      }),
    },
  ];

  for (const luaScene of luaScenes) {
    const defBytes = canonicalBytes(luaScene.defConstant);
    const hash = await defaultHasher.hash(defBytes);
    // Skip validation: blobs are not yet in the resolver at create time.
    // addBlob() below persists them before the session is closed.
    const session = await library.create(luaScene.name, luaScene.buildDoc(hash), {
      skipValidation: true,
    });
    await session.addBlob(defBytes);
    await session.save();
    await session.close();
  }

  // Stress-test scenes — captured at fixed sizes from the procedural generators.
  const stressScenes: { name: string; doc: NodeDoc }[] = [
    { name: 'Stress: transform chain (×40)', doc: transformChain(40, 5) },
    { name: 'Stress: boolean nest (×5)', doc: boolNest(5) },
    {
      name: 'Stress: procedural tree',
      doc: procTree({ ...treeBaseOpts, wobble: 0 }),
    },
  ];
  for (const scene of stressScenes) {
    const session = await library.create(scene.name, scene.doc);
    await session.close();
  }

  // Mesh-import sample: a hand-rolled cube encoded as binary STL, imported
  // and remixed.
  const cubeBytes = SAMPLE_STL_BYTES;
  const cubeHash = await hashStlBlob(cubeBytes);

  const importSession = await library.create('Mesh import: STL cube', {
    type: 'import-stl',
    params: { blobHash: cubeHash },
  });
  await importSession.addBlob(cubeBytes);
  await importSession.save();
  await importSession.close();

  const remixSession = await library.create('Mesh remix: imported cube ∖ sphere', {
    type: 'difference',
    children: [
      { type: 'import-stl', params: { blobHash: cubeHash } },
      { type: 'sphere', params: { radius: 12, segments: 48 } },
    ],
  });
  await remixSession.addBlob(cubeBytes);
  await remixSession.save();
  await remixSession.close();

  // OBJ-import sample: a hand-rolled tetrahedron parallel to the STL cube.
  const tetraHash = await hashObjBlob(SAMPLE_OBJ_BYTES);

  const objSession = await library.create('Mesh import: OBJ tetrahedron', {
    type: 'import-obj',
    params: { blobHash: tetraHash },
  });
  await objSession.addBlob(SAMPLE_OBJ_BYTES);
  await objSession.save();
  await objSession.close();

  const objRemixSession = await library.create('Mesh remix: tetrahedron ∖ sphere', {
    type: 'difference',
    children: [
      { type: 'import-obj', params: { blobHash: tetraHash } },
      { type: 'sphere', params: { radius: 6, segments: 32 } },
    ],
  });
  await objRemixSession.addBlob(SAMPLE_OBJ_BYTES);
  await objRemixSession.save();
  await objRemixSession.close();

  // Phase 2.1 — headline showcases. Each is its own subpackage exporting a
  // seed function that knows how to construct its LuaDefinition, register
  // any bundled blob assets, and persist the scene under the supplied library.
  await seedHouseShowcase(library);
  await seedCastleShowcase(library);
  await seedTreeShowcase(library);
}
