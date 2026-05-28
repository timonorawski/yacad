/**
 * Showcase: parametric tree with glTF leaves.
 *
 * Demonstrates Lua-driven procedural geometry composed with an imported mesh
 * asset (the leaf glTF). The Lua script grows a recursive branching tree of
 * cylinders; `geo.import_gltf` attaches a leaf mesh at every branch tip.
 */
import { Accessor, Document, WebIO } from '@gltf-transform/core';
import { canonicalBytes } from '@yacad/canonical';
import type { NodeDoc } from '@yacad/dag';
import type { DocLibrary } from '@yacad/doc-store';
import { defaultHasher } from '@yacad/hash';
import type { LuaDefinition } from '@yacad/lua';

// ---------------------------------------------------------------------------
// Leaf glTF builder
// ---------------------------------------------------------------------------

/**
 * Build a minimal leaf-shaped binary glTF (GLB) blob.
 *
 * The leaf is a flat oval shape with a pointed tip, triangulated as a
 * double-sided mesh (two caps sharing the same outline). No material — yacad's
 * import-gltf decoder strips materials anyway.
 *
 * Dimensions: ~4 mm long × ~2 mm wide (authored at target size; `leafScale`
 * in the Lua params controls the overall leaf appearance by setting the offset
 * radius around each tip branch, not by scaling the geometry itself).
 */
export async function buildLeafGlb(): Promise<Uint8Array> {
  // 10-point tapered oval profile in XY: pointed at +X, rounded at -X.
  // Outline winds counter-clockwise when viewed from +Z.
  const halfLen = 2.0; // mm from centre to pointed tip
  const halfWid = 0.9; // mm half-width at widest point (at 40% from base)

  // Profile points: index 0 = pointed tip, rest spread around to base.
  const profile: [number, number][] = [
    [halfLen, 0], // tip (pointed)
    [halfLen * 0.6, halfWid * 0.85],
    [halfLen * 0.1, halfWid],
    [-halfLen * 0.35, halfWid * 0.9],
    [-halfLen * 0.75, halfWid * 0.55],
    [-halfLen, 0], // base (round)
    [-halfLen * 0.75, -halfWid * 0.55],
    [-halfLen * 0.35, -halfWid * 0.9],
    [halfLen * 0.1, -halfWid],
    [halfLen * 0.6, -halfWid * 0.85],
  ];
  const n = profile.length; // 10

  // Front (+Z) and back (-Z) caps share the outline; slightly offset for
  // double-sidedness. We don't need real thickness — just non-zero so
  // Manifold doesn't reject a zero-volume import.
  const zFront = 0.05;
  const zBack = -0.05;

  // Vertices: front ring (0..n-1) then back ring (n..2n-1).
  // Each ring ends with the same points as profile, plus z offset.
  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const [x, y] = profile[i]!;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = zFront;
    positions[(n + i) * 3] = x;
    positions[(n + i) * 3 + 1] = y;
    positions[(n + i) * 3 + 2] = zBack;
  }

  // Fan triangulation of front cap (CCW from +Z) and back cap (CW from +Z
  // = CCW from -Z) around a virtual centre vertex. Use a real centre vertex
  // at index 2*n (front centre) and 2*n+1 (back centre).
  const cx = profile.reduce((s, [x]) => s + x, 0) / n;
  const cy = profile.reduce((s, [, y]) => s + y, 0) / n;

  const allPositions = new Float32Array(positions.length + 2 * 3);
  allPositions.set(positions);
  allPositions[n * 2 * 3] = cx;
  allPositions[n * 2 * 3 + 1] = cy;
  allPositions[n * 2 * 3 + 2] = zFront; // front centre
  allPositions[(n * 2 + 1) * 3] = cx;
  allPositions[(n * 2 + 1) * 3 + 1] = cy;
  allPositions[(n * 2 + 1) * 3 + 2] = zBack; // back centre

  const frontCenter = n * 2;
  const backCenter = n * 2 + 1;

  // Front cap: CCW fan
  const frontTris: number[] = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    frontTris.push(frontCenter, i, next);
  }

  // Back cap: CW fan (flip winding for outward normal from -Z side)
  const backTris: number[] = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    backTris.push(backCenter, n + next, n + i);
  }

  // Side strip connecting front ring to back ring (forms the thin rim)
  const sideTris: number[] = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    // Two triangles per edge: front[i]→back[i]→front[next], back[i]→back[next]→front[next]
    sideTris.push(i, n + i, next);
    sideTris.push(n + i, n + next, next);
  }

  const allIndices = new Uint32Array([...frontTris, ...backTris, ...sideTris]);

  const doc = new Document();
  const buf = doc.createBuffer();

  const posAcc = doc
    .createAccessor()
    .setArray(allPositions)
    .setType(Accessor.Type.VEC3 as 'VEC3')
    .setBuffer(buf);
  const idxAcc = doc
    .createAccessor()
    .setArray(allIndices)
    .setType(Accessor.Type.SCALAR as 'SCALAR')
    .setBuffer(buf);

  const prim = doc.createPrimitive().setAttribute('POSITION', posAcc).setIndices(idxAcc).setMode(4); // TRIANGLES

  const mesh = doc.createMesh('leaf').addPrimitive(prim);
  const node = doc.createNode('leaf').setMesh(mesh);
  const scene = doc.createScene('default').addChild(node);
  doc.getRoot().setDefaultScene(scene);

  return new WebIO().writeBinary(doc);
}

// ---------------------------------------------------------------------------
// Tree LuaDefinition
// ---------------------------------------------------------------------------

/**
 * The tree LuaDefinition. Recursive branching tree:
 * - Each branch is a `geo.cylinder` pointing +Z.
 * - Sub-branches are translated to the tip, then rotated (`branchAngle` from Z,
 *   successive multiples of `phyllotaxis` around Z).
 * - At depth 0, a `geo.import_gltf` leaf is placed at each tip.
 * - `wobble > 0` perturbs each branch deterministically via a mulberry32 PRNG.
 *
 * With `wobble: 0` every branch at a given depth is structurally identical,
 * so content-addressing deduplicates aggressively (81 leaf tips = 4 cache misses
 * at default depth/splits).
 */
export const TREE_DEFINITION: LuaDefinition = {
  schema: {
    inputs: [],
    params: {
      depth: { type: 'int', default: 4, min: 1, max: 6 },
      splits: { type: 'int', default: 3, min: 1, max: 5 },
      trunkLength: { type: 'number', default: 18 },
      trunkRadius: { type: 'number', default: 1.1 },
      lengthTaper: { type: 'number', default: 0.68 },
      radiusTaper: { type: 'number', default: 0.6 },
      branchAngle: { type: 'number', default: 28 },
      phyllotaxis: { type: 'number', default: 137.5 },
      leafScale: { type: 'number', default: 0.35 },
      wobble: { type: 'number', default: 0 },
      seed: { type: 'int', default: 1 },
      leafHash: { type: 'string', default: '' },
    },
    output: '3d',
  },
  code: [
    '-- Mulberry32 PRNG — deterministic, no external state.',
    '-- Returns a function that produces values in [0, 1).',
    'local function mulberry32(seed)',
    '  local s = seed & 0xFFFFFFFF',
    '  return function()',
    '    s = (s + 0x6D2B79F5) & 0xFFFFFFFF',
    '    local t = s',
    '    t = (t ~ (t >> 15)) & 0xFFFFFFFF',
    '    t = (t * (t | 1)) & 0xFFFFFFFF',
    '    t = (t ~ (t + (t * ((t ~ (t >> 7)) & 0xFFFFFFFF)) & 0xFFFFFFFF)) & 0xFFFFFFFF',
    '    t = (t ~ (t >> 14)) & 0xFFFFFFFF',
    '    return t / 4294967296',
    '  end',
    'end',
    '',
    'local prng = mulberry32(params.seed)',
    '',
    'local function jitter(range)',
    '  if params.wobble == 0 then return 0 end',
    '  return (prng() * 2 - 1) * range * params.wobble',
    'end',
    '',
    '-- Leaf: an imported glTF mesh placed at the origin.',
    '-- All tips share the same blobHash so one cache entry covers all leaves.',
    'local function make_leaf()',
    '  return geo.import_gltf({ blobHash = params.leafHash })',
    'end',
    '',
    '-- Recursive branch builder.',
    '-- Each branch is a cylinder (height=length, centered at base).',
    '-- At depth 0: cylinder + a leaf at the tip.',
    '-- At depth>0: cylinder + splits sub-branches, each rotated to spread.',
    'local function build(length, radius, depth)',
    '  local segs = math.max(6, math.floor(6 + depth * 4))',
    '  local trunk = geo.cylinder({ height = length, radius = radius, segments = segs, center = false })',
    '',
    '  if depth == 0 then',
    '    -- Leaf: translate to tip, then place the imported mesh.',
    '    -- Offset slightly away from the trunk tip to avoid Z-fighting.',
    '    local leaf = geo.translate(',
    '      { offset = { jitter(length * 0.05), jitter(length * 0.05), length } },',
    '      { make_leaf() }',
    '    )',
    '    return geo.union({}, { trunk, leaf })',
    '  end',
    '',
    '  local sub_len = length * params.lengthTaper',
    '  local sub_rad = radius * params.radiusTaper',
    '  local parts = { trunk }',
    '',
    '  for i = 1, params.splits do',
    '    local phi = (i - 1) * params.phyllotaxis + jitter(15)',
    '    local ba  = params.branchAngle + jitter(8)',
    '    local sub = build(sub_len, sub_rad, depth - 1)',
    '    parts[#parts + 1] = geo.translate(',
    '      { offset = { 0, 0, length } },',
    '      { geo.rotate({ angles = { 0, ba, phi } }, { sub }) }',
    '    )',
    '  end',
    '',
    '  return geo.union({}, parts)',
    'end',
    '',
    'return build(params.trunkLength, params.trunkRadius, params.depth)',
  ].join('\n'),
};

// ---------------------------------------------------------------------------
// seedTreeShowcase
// ---------------------------------------------------------------------------

/**
 * Seed the showcase tree into a DocLibrary.
 *
 * 1. Builds the leaf glTF bytes programmatically.
 * 2. Computes the leaf hash (SHA-256 via defaultHasher).
 * 3. Serialises and hashes the LuaDefinition.
 * 4. Creates the scene doc referencing both hashes.
 * 5. Persists via the standard create → addBlob → save → close pattern.
 */
export async function seedTreeShowcase(library: DocLibrary): Promise<void> {
  // 1. Build the leaf glTF
  const leafGltfBytes = await buildLeafGlb();
  const leafHash = await defaultHasher.hash(leafGltfBytes);

  // 2. Build the LuaDefinition with leafHash baked into the default param
  //    value (this makes the hash stable: changing the leaf blob changes the
  //    LuaDefinition hash too, invalidating the whole tree cache correctly).
  const treeDef: LuaDefinition = {
    ...TREE_DEFINITION,
    schema: {
      ...TREE_DEFINITION.schema,
      params: {
        ...TREE_DEFINITION.schema.params,
        leafHash: { type: 'string', default: leafHash },
      },
    },
  };

  const luaDefBytes = canonicalBytes(treeDef);
  const luaDefHash = await defaultHasher.hash(luaDefBytes);

  // 3. Build the NodeDoc
  const doc: NodeDoc = {
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

  // 4. Create the session (skipValidation because blobs aren't available yet)
  const session = await library.create('Showcase: parametric tree (glTF leaves)', doc, {
    skipValidation: true,
  });

  // 5. Register both blobs so the worker can resolve them
  await session.addBlob(luaDefBytes);
  await session.addBlob(leafGltfBytes);
  await session.save();
  await session.close();
}
