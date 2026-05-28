<script lang="ts">
  import { onMount } from 'svelte';
  import { marked } from 'marked';
  import { meshToBinaryStl } from '@yacad/export-stl';
  import type { Mesh } from '@yacad/geometry';
  import { defaultHasher } from '@yacad/hash';
  import { hashStlBlob } from '@yacad/import-stl';
  import { hashLuaDefinition, KERNEL_TYPE_DOCS } from '@yacad/lua';
  import { listNodeTypes } from '@yacad/dag';
  import {
    GEAR_DEFINITION,
    ARRAY_ALONG_X_DEFINITION,
    FLOWER_DEFINITION,
  } from '@yacad/e2e/fixtures';
  import { Viewport, geometryToObject3D } from '@yacad/render';
  import { loadManifold } from '@yacad/kernel-manifold';
  import { WorkerClient, type EvaluateOutcome } from '@yacad/worker';
  import type { NodeDoc } from '@yacad/dag';
  import wasmUrl from 'manifold-3d/manifold.wasm?url';
  import luaWasmUrl from 'wasmoon/dist/glue.wasm?url';
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
  import languageReferenceMd from '../../../docs/language-reference.md?raw';
  import EvalWorker from './worker?worker';

  const DEFAULT_DOC = JSON.stringify(
    {
      type: 'difference',
      children: [
        { type: 'box', params: { size: [30, 30, 30], center: true } },
        { type: 'sphere', params: { radius: 19, segments: 48 } },
      ],
    },
    null,
    2,
  );

  let canvas: HTMLCanvasElement;
  let text = $state(DEFAULT_DOC);
  let status = $state<'idle' | 'evaluating' | 'error'>('idle');
  let error = $state('');
  let stats = $state<EvaluateOutcome['stats'] | null>(null);
  let perf = $state<EvaluateOutcome['perf'] | null>(null);
  let perNode = $state<EvaluateOutcome['perNode']>([]);
  let roundTripMs = $state<number | null>(null);
  let renderMs = $state<number | null>(null);
  let docsOpen = $state(false);
  let docsTab = $state<'language' | 'luaApi'>('language');
  let selectedScene = $state('default');

  let client: WorkerClient;
  let viewport: Viewport;
  let lastMesh = $state<Mesh | undefined>(undefined);
  // Lazily loaded on first 2D geometry render; cached thereafter.
  let manifoldApi: Awaited<ReturnType<typeof loadManifold>> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  // Status-flip timer: defer 'evaluating' until ~50ms in so warm-cache hits
  // don't trigger a Svelte DOM update during the await window (which otherwise
  // blocks the main thread and shows up as worker→main transport latency).
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  const STATUS_DEFER_MS = 50;
  let evalSeq = 0;

  // Lua definition hashes — populated once on mount (async hash of canonical form).
  let gearHash = $state('');
  let arrayAlongXHash = $state('');
  let flowerHash = $state('');
  // Tracks which definition hashes have already been pushed to the worker.
  const pushedDefinitions = new Set<string>();

  /** Push a Lua definition to the worker exactly once per hash. */
  async function ensureLuaDefinition(
    hash: string,
    def: typeof GEAR_DEFINITION | typeof ARRAY_ALONG_X_DEFINITION | typeof FLOWER_DEFINITION,
  ): Promise<void> {
    if (!hash || pushedDefinitions.has(hash)) return;
    pushedDefinitions.add(hash);
    await client.putLuaDefinition(hash, def);
  }

  // Mesh-blob hashes for sample import-stl scenes — populated on mount.
  let sampleStlHash = $state('');
  const pushedMeshBlobs = new Set<string>();

  /** Push a mesh blob to the worker exactly once per hash. */
  async function ensureMeshBlob(hash: string, bytes: Uint8Array): Promise<void> {
    if (!hash || pushedMeshBlobs.has(hash)) return;
    pushedMeshBlobs.add(hash);
    await client.putMeshBlob(hash, bytes);
  }

  // Stress-test scene generators — too verbose or too parametric to keep as
  // static files, so they're built on demand for the picker. They mirror the
  // graphs exercised by the e2e torture suite (packages/e2e/src/torture.test.ts).
  const pretty = (doc: NodeDoc) => JSON.stringify(doc, null, 2);

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

  /** A union of `n` overlapping boxes marching along +X. */
  function wideUnion(n: number): NodeDoc {
    const children: NodeDoc[] = [];
    for (let i = 0; i < n; i++) {
      children.push({
        type: 'translate',
        params: { offset: [i * 5, 0, 0] },
        children: [{ type: 'box', params: { size: [8, 8, 8], center: true } }],
      });
    }
    return { type: 'union', children };
  }

  const hiResSphereMinusBox: NodeDoc = {
    type: 'difference',
    children: [
      { type: 'sphere', params: { radius: 20, segments: 256 } },
      { type: 'box', params: { size: [20, 20, 40], center: true } },
    ],
  };

  // Sample binary STL: a unit cube of side 20, centered, encoded via the same
  // @yacad/export-stl encoder we ship — so users can see the export → import
  // round-trip work in the studio. Generated at module load.
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

  const luaScenes = $derived([
    {
      id: 'lua-gear',
      label: 'Lua: gear (teeth=8, radius=5)',
      text: pretty({
        type: 'lua',
        params: { definitionHash: gearHash, values: { teeth: 8, radius: 5.0 } },
      } as NodeDoc),
      defHash: gearHash,
      def: GEAR_DEFINITION,
    },
    {
      id: 'lua-gear-customized',
      label: 'Lua: gear customized (teeth=12, radius=3)',
      text: pretty({
        type: 'lua',
        params: { definitionHash: gearHash, values: { teeth: 12, radius: 3.0 } },
      } as NodeDoc),
      defHash: gearHash,
      def: GEAR_DEFINITION,
    },
    {
      id: 'lua-array-of-spheres',
      label: 'Lua: array of spheres (count=4, spacing=3)',
      text: pretty({
        type: 'lua',
        params: { definitionHash: arrayAlongXHash, values: { count: 4, spacing: 3.0 } },
        children: [{ type: 'sphere', params: { radius: 1, segments: 32 } }],
      } as NodeDoc),
      defHash: arrayAlongXHash,
      def: ARRAY_ALONG_X_DEFINITION,
    },
    {
      id: 'lua-flower-extruded',
      label: 'Lua → 2D → extrude (flower)',
      text: pretty({
        type: 'extrude',
        params: { height: 3 },
        children: [{ type: 'lua', params: { definitionHash: flowerHash, values: {} } }],
      } as NodeDoc),
      defHash: flowerHash,
      def: FLOWER_DEFINITION,
    },
  ]);

  // Mesh-import scenes: blob-leaf nodes whose bytes the studio uploads via
  // client.putMeshBlob before evaluation (the worker holds the blob registry).
  const meshImportScenes = $derived([
    {
      id: 'import-stl-cube',
      label: 'Import: cube (binary STL)',
      text: pretty({
        type: 'import-stl',
        params: { blobHash: sampleStlHash },
      } as NodeDoc),
      blobHash: sampleStlHash,
      blobBytes: SAMPLE_STL_BYTES,
    },
    {
      id: 'import-stl-cube-minus-sphere',
      label: 'Import: cube STL − sphere (remix)',
      text: pretty({
        type: 'difference',
        children: [
          { type: 'import-stl', params: { blobHash: sampleStlHash } },
          { type: 'sphere', params: { radius: 7, segments: 48 } },
        ],
      } as NodeDoc),
      blobHash: sampleStlHash,
      blobBytes: SAMPLE_STL_BYTES,
    },
  ]);

  const sceneLibrary = [
    { id: 'default', label: 'Default: box - sphere', text: DEFAULT_DOC },
    { id: 'box', label: 'Primitive: box', text: sceneBox },
    { id: 'sphere', label: 'Primitive: sphere', text: sceneSphere },
    { id: 'cylinder', label: 'Primitive: cylinder', text: sceneCylinder },
    { id: 'translated-box', label: 'Transform: translated box', text: sceneTranslatedBox },
    { id: 'rotated-cylinder', label: 'Transform: rotated cylinder', text: sceneRotatedCylinder },
    { id: 'union-stack', label: 'Boolean: union stack', text: sceneUnionStack },
    { id: 'box-minus-sphere', label: 'Boolean: box minus sphere', text: sceneBoxMinusSphere },
    { id: 'cored-block', label: 'Composite: cored block', text: sceneCoredBlock },
    { id: '2d-circle', label: '2D: circle (r=10)', text: sceneCircle },
    { id: '2d-spline-star', label: '2D: spline star', text: sceneSplineStar },
    { id: '2d-rounded-rect', label: '2D: rounded rectangle', text: sceneRoundedRect },
    { id: '3d-extruded-gear', label: '3D: extruded gear (declarative)', text: sceneExtrudedGear },
    {
      id: '3d-revolved-vase',
      label: '3D: revolved vase (spline profile)',
      text: sceneRevolvedVase,
    },
    {
      id: 'composite-section-extrude',
      label: '3D: section + extrude',
      text: pretty({
        type: 'extrude',
        params: { height: 2 },
        children: [
          {
            type: 'section',
            params: { origin: [0, 0, 0], normal: [0, 0, 1] },
            children: [
              {
                type: 'difference',
                children: [
                  { type: 'box', params: { size: [10, 10, 10], center: true } },
                  { type: 'sphere', params: { radius: 4, segments: 32 } },
                ],
              },
            ],
          },
        ],
      }),
    },
    {
      id: 'composite-diagonal-section',
      label: '2D: hexagonal body-diagonal section',
      text: pretty({
        type: 'section',
        params: { origin: [0, 0, 0], normal: [1, 1, 1] },
        children: [{ type: 'box', params: { size: [4, 4, 4], center: true } }],
      }),
    },
    { id: 'edge-tangent', label: 'Edge case: tangent sphere/box', text: sceneTangent },
    { id: 'edge-shared-face', label: 'Edge case: shared-face cubes', text: sceneSharedFace },
    { id: 'edge-interior-void', label: 'Edge case: interior void', text: sceneInteriorVoid },
    { id: 'stress-wide-union', label: 'Stress: wide union (50)', text: pretty(wideUnion(50)) },
    { id: 'stress-bool-nest', label: 'Stress: boolean nest (×5)', text: pretty(boolNest(5)) },
    {
      id: 'stress-chain',
      label: 'Stress: transform chain (×40)',
      text: pretty(transformChain(40, 5)),
    },
    {
      id: 'stress-hi-res',
      label: 'Stress: hi-res sphere − box',
      text: pretty(hiResSphereMinusBox),
    },
    {
      id: 'stress-tree-symmetric',
      label: 'Stress: tree (symmetric, cache-friendly)',
      text: pretty(procTree({ ...treeBaseOpts, wobble: 0 })),
    },
    {
      id: 'stress-tree-realworld',
      label: 'Stress: tree (real-world, every branch unique)',
      text: pretty(procTree({ ...treeBaseOpts, wobble: 1, seed: 42 })),
    },
  ];

  const languageReferenceHtml = marked.parse(languageReferenceMd) as string;

  // Build Lua API docs from the descriptor map, filtered to currently-registered kernel types.
  const registeredKernelTypes = new Set(
    listNodeTypes()
      .filter((t) => !t.type.startsWith('__'))
      .map((t) => t.type),
  );

  function buildLuaApiMd(): string {
    const lines: string[] = [];

    lines.push(`## Lua environment`);
    lines.push('');
    lines.push('- `params.<name>` — values declared in the LuaDefinition schema');
    lines.push('- `inputs.<name>` — child input refs (sentinel resolved by engine)');
    lines.push('- `inputs.<name>.outputType()` — synchronous geometry-type query');
    lines.push('- `geo.*` — kernel-backed node constructors (see below)');
    lines.push('- `math`, `string`, `table` — pure stdlib subsets');
    lines.push('- `os`, `io`, `package`, `require`, `print`, `load` — **NOT exposed**');
    lines.push(
      '- `math.random` — seeded deterministically from `definitionHash + canonical(values)`',
    );
    lines.push('');

    lines.push('## Return value');
    lines.push('');
    lines.push(
      'A NodeDoc table — `geo.*` calls compose into one. The trailing return value of the script is the emitted sub-DAG.',
    );
    lines.push('');

    lines.push('## `geo.*` API');
    lines.push('');

    for (const doc of KERNEL_TYPE_DOCS) {
      if (!registeredKernelTypes.has(doc.type)) continue;

      const childrenArg = doc.params.length === 0 ? 'children?' : 'params, children?';
      lines.push(`### \`geo.${doc.type}(${childrenArg}) → ${doc.outputDoc}\``);
      lines.push('');
      lines.push(doc.summary);
      lines.push('');

      if (doc.params.length > 0) {
        lines.push('**Parameters:**');
        lines.push('');
        for (const p of doc.params) {
          const req = p.required ? '' : ` *(default: \`${JSON.stringify(p.default)}\`)*`;
          lines.push(`- \`${p.name}\` (\`${p.type}\`)${req}: ${p.doc}`);
        }
        lines.push('');
      }

      lines.push('**Example:**');
      lines.push('');
      lines.push('```lua');
      lines.push(doc.example);
      lines.push('```');
      lines.push('');
    }

    lines.push('## `geo.node(type, params?, children?)`');
    lines.push('');
    lines.push(
      'Primitive constructor — drop down to this for types not yet wrapped, or for dynamic dispatch. Rejects reserved `__`-prefixed types and expandable types like `lua` itself.',
    );
    lines.push('');

    return lines.join('\n');
  }

  const luaApiHtml = marked.parse(buildLuaApiMd()) as string;

  const hitRate = $derived(
    stats && stats.nodes > 0 ? Math.round((stats.hits / stats.nodes) * 100) : 0,
  );

  const missRate = $derived(
    stats && stats.nodes > 0 ? Math.round((stats.misses / stats.nodes) * 100) : 0,
  );

  const expensiveNodes = $derived([...perNode].sort((a, b) => b.totalMs - a.totalMs));

  const meshSummary = $derived(
    lastMesh
      ? {
          vertices: lastMesh.vertices.length / 3,
          triangles: lastMesh.indices.length / 3,
        }
      : null,
  );

  onMount(() => {
    const worker = new EvalWorker();
    client = new WorkerClient(worker, { wasmUrl, luaWasmUrl });
    viewport = new Viewport(canvas);

    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      viewport.resize(rect.width, rect.height);
    });
    ro.observe(canvas);

    // Pre-compute Lua definition hashes so scene text is ready when the user
    // opens the dropdown. Hashing is async but fast (SubtleCrypto SHA-256).
    void hashLuaDefinition(GEAR_DEFINITION, defaultHasher).then((h) => {
      gearHash = h;
    });
    void hashLuaDefinition(ARRAY_ALONG_X_DEFINITION, defaultHasher).then((h) => {
      arrayAlongXHash = h;
    });
    // Pre-compute the sample STL blob's hash so its picker entry text resolves.
    void hashStlBlob(SAMPLE_STL_BYTES).then((h) => {
      sampleStlHash = h;
    });
    void hashLuaDefinition(FLOWER_DEFINITION, defaultHasher).then((h) => {
      flowerHash = h;
    });

    void evaluate();

    return () => {
      ro.disconnect();
      viewport.dispose();
      worker.terminate();
      clearTimeout(debounce);
      clearTimeout(statusTimer);
    };
  });

  function scheduleEvaluate(): void {
    clearTimeout(debounce);
    debounce = setTimeout(() => void evaluate(), 150);
  }

  function onEditorInput(): void {
    selectedScene = 'custom';
    scheduleEvaluate();
  }

  function formatJson(): void {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
      status = 'idle';
      error = '';
    } catch (e) {
      status = 'error';
      error = `Invalid JSON: ${(e as Error).message}`;
    }
  }

  async function pickScene(id: string): Promise<void> {
    const staticScene = sceneLibrary.find((entry) => entry.id === id);
    const luaScene = luaScenes.find((entry) => entry.id === id);
    const meshScene = meshImportScenes.find((entry) => entry.id === id);
    const scene = staticScene ?? luaScene ?? meshScene;
    if (!scene) return;
    selectedScene = scene.id;
    text = JSON.stringify(JSON.parse(scene.text), null, 2);
    // For Lua scenes, push the definition to the worker before evaluating.
    if (luaScene) {
      await ensureLuaDefinition(luaScene.defHash, luaScene.def);
    }
    // For mesh-import scenes, push the blob to the worker before evaluating.
    if (meshScene) {
      await ensureMeshBlob(meshScene.blobHash, meshScene.blobBytes);
    }
    void evaluate();
  }

  async function evaluate(): Promise<void> {
    // Any previously-scheduled status-flip timer from a still-in-flight eval
    // would otherwise race this one and clobber the status we set below.
    clearTimeout(statusTimer);

    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      status = 'error';
      error = `Invalid JSON: ${(e as Error).message}`;
      return;
    }

    error = '';
    // Defer the "Evaluating…" indicator: only flip status if the eval is still
    // pending after STATUS_DEFER_MS. Warm-cache hits resolve well below that
    // bar so the DOM never churns during the await — see the perf finding
    // surfaced via the transport-out metric.
    statusTimer = setTimeout(() => {
      status = 'evaluating';
    }, STATUS_DEFER_MS);
    const seq = ++evalSeq;
    const requestStart = performance.now();
    try {
      const outcome = await client.evaluate(doc, 'final');
      if (seq !== evalSeq) return; // a newer edit superseded this one
      clearTimeout(statusTimer);
      // Time the main-thread post-response work: BufferGeometry build,
      // vertex-normal compute, scene swap, and Svelte state assignments.
      // (Browser repaint happens later, on the next rAF — outside this number.)
      const renderStart = performance.now();
      if (outcome.geometry.kind === '2d') {
        manifoldApi ??= await loadManifold({ locateFile: () => wasmUrl });
        viewport.setGeometry(outcome.geometry, manifoldApi);
        lastMesh = undefined;
      } else {
        const mesh = outcome.geometry.mesh;
        lastMesh = mesh;
        viewport.setMesh(mesh);
      }
      stats = outcome.stats;
      perf = outcome.perf;
      perNode = outcome.perNode;
      renderMs = performance.now() - renderStart;
      roundTripMs = performance.now() - requestStart;
      status = 'idle';
    } catch (e) {
      if (seq !== evalSeq) return;
      clearTimeout(statusTimer);
      status = 'error';
      error = (e as Error).message;
    }
  }

  function exportStl(): void {
    if (!lastMesh) return;
    const blob = new Blob([meshToBinaryStl(lastMesh)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'model.stl';
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="app">
  <header>
    <h1>yacad studio</h1>
    <span class="tagline">parametric DAG · content-addressed cache · Manifold kernel</span>
    <button class="ghost" onclick={() => (docsOpen = !docsOpen)}>
      {docsOpen ? 'Hide' : 'Show'} Language Reference
    </button>
  </header>

  <div class="sidebar">
    <div class="editor-controls">
      <label>
        <span>Sample scene</span>
        <select
          value={selectedScene}
          onchange={(event) => pickScene((event.currentTarget as HTMLSelectElement).value)}
        >
          <option value="custom">Custom (current editor)</option>
          {#each sceneLibrary as scene}
            <option value={scene.id}>{scene.label}</option>
          {/each}
          {#each luaScenes as scene}
            <option value={scene.id}>{scene.label}</option>
          {/each}
          {#each meshImportScenes as scene}
            <option value={scene.id}>{scene.label}</option>
          {/each}
        </select>
      </label>
      <button class="ghost" onclick={formatJson}>Format JSON</button>
    </div>

    <textarea bind:value={text} oninput={onEditorInput} spellcheck="false"></textarea>

    <div class="panel">
      <div class="toolbar">
        <button class="ghost" onclick={() => void evaluate()}>Evaluate</button>
        <button onclick={exportStl} disabled={!lastMesh}>Export STL</button>
        <span class="status" class:error={status === 'error'}>
          {#if status === 'evaluating'}Evaluating…{:else if status === 'error'}{error}{:else}Ready{/if}
        </span>
      </div>

      {#if stats}
        <div class="stats">
          <span>nodes <b>{stats.nodes}</b></span>
          <span>hits <b>{stats.hits}</b></span>
          <span>misses <b>{stats.misses}</b></span>
          <span>hit-rate <b>{hitRate}%</b></span>
          <span>miss-rate <b>{missRate}%</b></span>
        </div>

        {#if meshSummary}
          <div class="metrics-grid">
            <span>mesh vertices <b>{meshSummary.vertices}</b></span>
            <span>mesh triangles <b>{meshSummary.triangles}</b></span>
            <span>main round-trip <b>{roundTripMs ? roundTripMs.toFixed(2) : '-'} ms</b></span>
            <span>transport in <b>{perf ? perf.transportInMs.toFixed(2) : '-'} ms</b></span>
            <span>worker total <b>{perf ? perf.workerTotalMs.toFixed(2) : '-'} ms</b></span>
            <span>transport out <b>{perf ? perf.transportOutMs.toFixed(2) : '-'} ms</b></span>
            <span>main render <b>{renderMs ? renderMs.toFixed(2) : '-'} ms</b></span>
            <span>buildGraph <b>{perf ? perf.buildGraphMs.toFixed(2) : '-'} ms</b></span>
            <span>engine total <b>{perf ? perf.engineMs.toFixed(2) : '-'} ms</b></span>
            <span>engine lookup <b>{stats.lookupMs.toFixed(2)} ms</b></span>
            <span>kernel import <b>{stats.importMs.toFixed(2)} ms</b></span>
            <span>kernel op <b>{stats.opMs.toFixed(2)} ms</b></span>
            <span>kernel export <b>{stats.exportMs.toFixed(2)} ms</b></span>
            <span>engine cache write <b>{stats.storeMs.toFixed(2)} ms</b></span>
            <span>engine wall <b>{stats.totalMs.toFixed(2)} ms</b></span>
          </div>
        {/if}

        <div class="node-table-wrap">
          <table class="node-table">
            <thead>
              <tr>
                <th>node</th>
                <th>cache</th>
                <th>total ms</th>
                <th>import ms</th>
                <th>op ms</th>
                <th>export ms</th>
              </tr>
            </thead>
            <tbody>
              {#each expensiveNodes as node (node.id)}
                <tr>
                  <td>{node.id}</td>
                  <td>
                    <span class="tag" class:hit={node.hit} class:miss={!node.hit}>
                      {node.hit ? 'cached' : 'computed'}
                    </span>
                  </td>
                  <td>{node.totalMs.toFixed(2)}</td>
                  <td>{node.importMs.toFixed(2)}</td>
                  <td>{node.opMs.toFixed(2)}</td>
                  <td>{node.exportMs.toFixed(2)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>

  <div class="viewport">
    <canvas bind:this={canvas}></canvas>
  </div>

  <aside class="docs" class:open={docsOpen}>
    <div class="docs-header">
      <div class="docs-tabs">
        <button
          class="tab-btn"
          class:active={docsTab === 'language'}
          onclick={() => (docsTab = 'language')}
        >
          Language Reference
        </button>
        <button
          class="tab-btn"
          class:active={docsTab === 'luaApi'}
          onclick={() => (docsTab = 'luaApi')}
        >
          Lua API
        </button>
      </div>
      <button class="ghost" onclick={() => (docsOpen = false)}>Close</button>
    </div>
    <div class="docs-content">
      {#if docsTab === 'language'}
        {@html languageReferenceHtml}
      {:else}
        {@html luaApiHtml}
      {/if}
    </div>
  </aside>
</div>
