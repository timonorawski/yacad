/**
 * Documentation and introspection tools — stateless read-only tools that
 * surface the node-type registry, Lua API surface, language reference, and
 * showcase examples so an agent can discover what the system offers without
 * consulting external docs.
 */
import {
  getKernelTypeDoc,
  getNodeType,
  listNodeTypes as dagListNodeTypes,
  type ParamDoc,
} from '@yacad/dag';
import { SANDBOX_GLOBALS } from '@yacad/lua';
import { KERNEL_TYPE_DOCS } from '@yacad/lua';
import type { ToolResult } from './library-tools';

function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}
function err(code: string, message: string): ToolResult<never> {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// listNodeTypes
// ---------------------------------------------------------------------------

interface NodeTypeSummary {
  type: string;
  kind: 'kernel' | 'expandable' | 'decoder';
  output: '2d' | '3d' | 'dynamic' | 'per-schema';
  summary: string;
}

export async function listNodeTypes(
  _ctx: unknown,
  _args: Record<string, never>,
): Promise<ToolResult<readonly NodeTypeSummary[]>> {
  const entries = dagListNodeTypes();
  const result: NodeTypeSummary[] = entries.map((entry) => {
    const def = getNodeType(entry.type);
    if (!def) {
      return {
        type: entry.type,
        kind: 'kernel' as const,
        output: (entry.output === '?' ? 'dynamic' : entry.output) as NodeTypeSummary['output'],
        summary: '',
      };
    }

    let output: NodeTypeSummary['output'];
    if (def.kind === 'kernel') {
      output = typeof def.output === 'function' ? 'dynamic' : def.output;
    } else if (def.kind === 'decoder') {
      output = def.output;
    } else {
      output = 'per-schema';
    }

    let summary = '';
    if (def.kind === 'kernel') {
      const doc = getKernelTypeDoc(def.type);
      if (doc) summary = doc.summary;
    } else if (def.kind === 'expandable') {
      summary = 'Expandable (Lua) node — params and output defined by the LuaDefinition schema.';
    } else if (def.kind === 'decoder') {
      summary = `Decoder node that imports external ${def.type.replace('import-', '').toUpperCase()} blobs as 3D mesh.`;
    }

    return {
      type: def.type,
      kind: def.kind,
      output,
      summary,
    };
  });
  return ok(result);
}

// ---------------------------------------------------------------------------
// getNodeTypeDoc
// ---------------------------------------------------------------------------

interface NodeTypeDocResult {
  type: string;
  kind: 'kernel' | 'expandable' | 'decoder';
  output: string;
  summary: string;
  paramSchema: readonly ParamDoc[];
  childRequirements: string;
  luaExample?: string;
}

export async function getNodeTypeDoc(
  _ctx: unknown,
  args: { type: string },
): Promise<ToolResult<NodeTypeDocResult>> {
  const def = getNodeType(args.type);
  if (!def) {
    return err('unknown-type', `No node type "${args.type}" is registered.`);
  }

  if (def.kind === 'kernel') {
    const doc = getKernelTypeDoc(args.type);
    const kernelDoc = KERNEL_TYPE_DOCS.find((d) => d.type === args.type);

    let output: string;
    if (typeof def.output === 'function') {
      output = 'dynamic — matches the output type of children (all must be the same dimension)';
    } else {
      output = def.output;
    }

    // Derive child requirements from the type name pattern
    let childRequirements = 'unknown';
    const summary = doc?.summary ?? '';
    if (summary.includes('no children') || summary.includes('takes no children')) {
      childRequirements = '0 children (leaf primitive)';
    } else if (
      ['box', 'sphere', 'cylinder', 'circle', 'rectangle', 'polygon', 'spline'].includes(args.type)
    ) {
      childRequirements = '0 children (leaf primitive)';
    } else if (['translate', 'rotate', 'warp', 'refine'].includes(args.type)) {
      childRequirements = 'exactly 1 child (3D)';
    } else if (['translate_2d', 'rotate_2d', 'offset_2d'].includes(args.type)) {
      childRequirements = 'exactly 1 child (2D)';
    } else if (['extrude', 'revolve'].includes(args.type)) {
      childRequirements = 'exactly 1 child (2D) — bridges 2D to 3D';
    } else if (args.type === 'section') {
      childRequirements = 'exactly 1 child (3D) — bridges 3D to 2D';
    } else if (['union', 'difference', 'hull'].includes(args.type)) {
      childRequirements = '>=1 children, all same dimension (all-2D or all-3D)';
    } else if (args.type === 'intersection') {
      childRequirements = '>=2 children, all same dimension (all-2D or all-3D)';
    }

    return ok({
      type: args.type,
      kind: 'kernel',
      output,
      summary: doc?.summary ?? '',
      paramSchema: doc?.paramSchema ?? [],
      childRequirements,
      ...(kernelDoc?.example ? { luaExample: kernelDoc.example } : {}),
    });
  }

  if (def.kind === 'decoder') {
    const format = def.type.replace('import-', '').toUpperCase();
    return ok({
      type: def.type,
      kind: 'decoder',
      output: def.output,
      summary: `Imports an external ${format} blob as a 3D mesh. The blob is content-addressed by its SHA-256 hash.`,
      paramSchema: [
        {
          name: 'blobHash',
          type: 'string',
          required: true,
          doc: `SHA-256 hex hash of the ${format} binary blob. Push the blob via addBlob before evaluation.`,
        },
      ],
      childRequirements: '0 children (decoder leaf)',
    });
  }

  // expandable (lua)
  return ok({
    type: def.type,
    kind: 'expandable',
    output: 'Determined by the LuaDefinition schema.output ("2d" or "3d")',
    summary:
      'Lua code node. Runs sandboxed Lua that emits a sub-DAG of primitives. ' +
      'Params come from the LuaDefinition schema; children are positional inputs declared in schema.inputs.',
    paramSchema: [
      {
        name: 'definitionHash',
        type: 'string',
        required: true,
        doc: 'SHA-256 hash of the canonical LuaDefinition blob. Register via addLuaDefinition first.',
      },
      {
        name: 'values',
        type: 'record',
        required: true,
        doc: 'Parameter values matching the LuaDefinition schema.params declarations.',
      },
    ],
    childRequirements:
      'Determined by the LuaDefinition schema.inputs array. Each input declares a name and expected output type (2d or 3d). Children are matched by position.',
  });
}

// ---------------------------------------------------------------------------
// getLanguageReference
// ---------------------------------------------------------------------------

// The language reference is embedded at build time. This is a ~584 line markdown
// document. We read it from the filesystem at module load in Node, which is fine
// for the MCP server (always Node, never browser).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let _languageRef: string | undefined;

function loadLanguageReference(): string {
  if (_languageRef !== undefined) return _languageRef;
  try {
    // Walk up from this file to the repo root to find docs/language-reference.md.
    // In the bundled output this path may differ, so we also try a few locations.
    const thisDir =
      typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(thisDir, '../../../../docs/language-reference.md'),
      resolve(thisDir, '../../../../../docs/language-reference.md'),
      resolve(thisDir, '../../../../../../docs/language-reference.md'),
      resolve(process.cwd(), 'docs/language-reference.md'),
    ];
    for (const p of candidates) {
      try {
        _languageRef = readFileSync(p, 'utf-8');
        return _languageRef;
      } catch {
        // try next
      }
    }
    _languageRef = '(language-reference.md not found — run from the repository root)';
    return _languageRef;
  } catch {
    _languageRef = '(failed to load language-reference.md)';
    return _languageRef;
  }
}

export async function getLanguageReference(
  _ctx: unknown,
  _args: Record<string, never>,
): Promise<ToolResult<{ content: string }>> {
  return ok({ content: loadLanguageReference() });
}

// ---------------------------------------------------------------------------
// getLuaApiReference
// ---------------------------------------------------------------------------

interface LuaApiReference {
  sandboxGlobals: {
    topLevel: string[];
    libraryMembers: Record<string, string[]>;
  };
  geoApiFunctions: {
    name: string;
    luaKey: string;
    kind: 'kernel' | 'decoder';
    output: string;
    summary: string;
  }[];
  luaDefinitionParamTypes: string[];
  notes: string;
}

export async function getLuaApiReference(
  _ctx: unknown,
  _args: Record<string, never>,
): Promise<ToolResult<LuaApiReference>> {
  // Sandbox globals from the single source of truth
  const topLevel = [...SANDBOX_GLOBALS.topLevel].sort();
  const libraryMembers: Record<string, string[]> = {};
  for (const [lib, members] of SANDBOX_GLOBALS.libraryMembers) {
    libraryMembers[lib] = [...members].sort();
  }

  // geo.* functions: every kernel + decoder type (not expandable)
  const geoFunctions: LuaApiReference['geoApiFunctions'] = [];
  for (const entry of dagListNodeTypes()) {
    if (entry.type.startsWith('__')) continue;
    const def = getNodeType(entry.type);
    if (!def) continue;
    if (def.kind === 'expandable') continue;

    const luaKey = entry.type.replace(/-/g, '_');
    let output: string;
    let summary = '';

    if (def.kind === 'kernel') {
      output = typeof def.output === 'function' ? 'dynamic' : def.output;
      const doc = getKernelTypeDoc(entry.type);
      if (doc) summary = doc.summary;
    } else {
      output = def.output;
      summary = `Decoder: imports ${entry.type.replace('import-', '').toUpperCase()} blob as 3D mesh.`;
    }

    geoFunctions.push({
      name: entry.type,
      luaKey,
      kind: def.kind as 'kernel' | 'decoder',
      output,
      summary,
    });
  }

  return ok({
    sandboxGlobals: { topLevel, libraryMembers },
    geoApiFunctions: geoFunctions,
    luaDefinitionParamTypes: ['int', 'number', 'boolean', 'string', 'vec3'],
    notes: [
      'The Lua sandbox runs Lua 5.4 via Wasmoon. Only pure stdlib chunks are loaded: Base (subset), Math, String, Table.',
      'Dangerous globals (os, io, require, load, print, collectgarbage, etc.) are stripped.',
      'math.random is available (seeded deterministically from definitionHash + values); math.randomseed is stripped.',
      'geo.* functions correspond 1:1 with registered kernel + decoder node types. Each takes (params_table, children_array) and returns a NodeDoc table.',
      'geo.node(type, params, children) is the generic constructor — useful when the type is a variable.',
      'Hyphenated types (import-stl, import-obj, import-gltf) are exposed with underscores: geo.import_stl, geo.import_obj, geo.import_gltf.',
      'params is a table of the current instance values (from the LuaDefinition schema.params).',
      'inputs is a table keyed by input name (from schema.inputs); each value is a NodeDoc representing the child.',
      'The code must return a single NodeDoc (the root of the emitted sub-DAG).',
    ].join('\n'),
  });
}

// ---------------------------------------------------------------------------
// getExamples
// ---------------------------------------------------------------------------

interface ShowcaseExample {
  name: string;
  description: string;
  paramCount: number;
  params: Record<string, { type: string; default: unknown }>;
  codeSnippet: string;
}

/**
 * Returns showcase examples. We embed the essential data from the showcase
 * index.ts files rather than importing them (some have heavy deps like
 * @gltf-transform). The READMEs are read from the filesystem.
 */
export async function getExamples(
  _ctx: unknown,
  _args: Record<string, never>,
): Promise<ToolResult<readonly ShowcaseExample[]>> {
  const examples: ShowcaseExample[] = [
    {
      name: 'house',
      description:
        'Parametric house: rectangular footprint, hollow walls with window and door cutouts, gable roof. ' +
        'Demonstrates batching all cutters into a single geo.difference for Manifold performance.',
      paramCount: 13,
      params: {
        width: { type: 'number', default: 12 },
        depth: { type: 'number', default: 8 },
        floors: { type: 'int', default: 2 },
        floorHeight: { type: 'number', default: 3 },
        wallThickness: { type: 'number', default: 0.3 },
        windowsPerSide: { type: 'int', default: 3 },
        windowWidth: { type: 'number', default: 1.0 },
        windowHeight: { type: 'number', default: 1.2 },
        doorWidth: { type: 'number', default: 1.2 },
        doorHeight: { type: 'number', default: 2.2 },
        roofPitch: { type: 'number', default: 35 },
        roofOverhang: { type: 'number', default: 0.4 },
        segments: { type: 'int', default: 1 },
      },
      codeSnippet: [
        '-- Parametric house pattern:',
        'local outer = geo.box({ size = {W, D, H} })',
        'local inner = geo.translate({ offset = {wt, wt, wt} }, { geo.box({ size = {inner_w, inner_d, H} }) })',
        '-- Collect all cutters (inner void + door + windows)',
        'local shell = geo.difference({}, {outer, inner, door, unpack(window_cutters)})',
        '-- Gable roof via polygon + extrude + rotate',
        'local gable_2d = geo.polygon({ points = gable_pts })',
        'local roof = geo.rotate({ angles = {90, 0, 0} }, { geo.extrude({ height = roof_depth }, { gable_2d }) })',
        'return geo.union({}, {shell, roof})',
      ].join('\n'),
    },
    {
      name: 'castle',
      description:
        'Parametric castle: four corner towers, four curtain walls, battlemented parapets, and a gate. ' +
        'Demonstrates Lua loops for repeating decorative geometry (crenellations).',
      paramCount: 12,
      params: {
        courtyardSize: { type: 'number', default: 20 },
        wallHeight: { type: 'number', default: 8 },
        wallThickness: { type: 'number', default: 2 },
        towerRadius: { type: 'number', default: 3 },
        towerHeight: { type: 'number', default: 12 },
        towerSegments: { type: 'int', default: 16 },
        crenellationCount: { type: 'int', default: 6 },
        merlonWidth: { type: 'number', default: 1.2 },
        crenellationHeight: { type: 'number', default: 1.5 },
        crenellationDepth: { type: 'number', default: 2 },
        gateWidth: { type: 'number', default: 3 },
        gateHeight: { type: 'number', default: 5 },
      },
      codeSnippet: [
        '-- Castle pattern: walls + towers + battlements',
        'local south_wall = geo.difference({}, { south_wall_solid, gate_cutter })',
        '-- Corner towers at each corner',
        'for _, c in ipairs(corner_coords) do',
        '  towers[#towers + 1] = geo.translate({ offset = {c[1], c[2], 0} },',
        '    { geo.cylinder({ radius = tr, height = th, segments = seg }) })',
        'end',
        '-- Merlons along each wall',
        'for i = 1, cc do',
        '  merlons[#merlons + 1] = geo.translate({ offset = {cx - mw/2, -half, wh} },',
        '    { geo.box({ size = {mw, cd, ch} }) })',
        'end',
        'return geo.union({}, all_parts)',
      ].join('\n'),
    },
    {
      name: 'tree',
      description:
        'Recursive branching tree with imported glTF leaves. Demonstrates Lua-driven procedural ' +
        'geometry composed with an imported mesh asset. With wobble=0, content-addressing deduplicates ' +
        'aggressively (81 leaf tips = 4 cache misses at default depth/splits).',
      paramCount: 12,
      params: {
        depth: { type: 'int', default: 4 },
        splits: { type: 'int', default: 3 },
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
      codeSnippet: [
        '-- Recursive tree pattern:',
        'local function build(length, radius, depth)',
        '  local trunk = geo.cylinder({ height = length, radius = radius, segments = segs })',
        '  if depth == 0 then',
        '    local leaf = geo.translate({ offset = {0, 0, length} }, { make_leaf() })',
        '    return geo.union({}, { trunk, leaf })',
        '  end',
        '  local parts = { trunk }',
        '  for i = 1, params.splits do',
        '    local sub = build(sub_len, sub_rad, depth - 1)',
        '    parts[#parts + 1] = geo.translate({ offset = {0, 0, length} },',
        '      { geo.rotate({ angles = {0, ba, phi} }, { sub }) })',
        '  end',
        '  return geo.union({}, parts)',
        'end',
        'return build(params.trunkLength, params.trunkRadius, params.depth)',
      ].join('\n'),
    },
    {
      name: 'torus-knot',
      description:
        'Parametric (p,q) torus knot using the warp transform. A 2D circle is revolved into a torus, ' +
        'then a Lua vertex deformation wraps it into a knot. Demonstrates warp with params.values ' +
        'for cache-correct parametric vertex deformations.',
      paramCount: 6,
      params: {
        p: { type: 'int', default: 1 },
        q: { type: 'int', default: 3 },
        majorRadius: { type: 'number', default: 25 },
        minorRadius: { type: 'number', default: 10 },
        threadRadius: { type: 'number', default: 3.75 },
        circularSegments: { type: 'int', default: 24 },
      },
      codeSnippet: [
        '-- Torus-knot pattern: revolve + warp',
        'local profile = geo.translate_2d({ offset = {offset, 0} }, { geo.circle({ radius = 1, segments = cs }) })',
        "local torus = geo.revolve({ axis = 'z', segments = m }, { profile })",
        'return geo.warp({ code = warp_code, values = {',
        '  pk = pk, qk = qk, majorRadius = params.majorRadius,',
        '  minorRadius = params.minorRadius, threadRadius = params.threadRadius,',
        '  offset = offset',
        '} }, { torus })',
      ].join('\n'),
    },
    {
      name: 'chamfered-box',
      description:
        'Chamfered cuboid via boolean decomposition: difference(box, union(12 wedges)). ' +
        'Demonstrates that chamfers on known-edge bodies reduce to existing Manifold ops ' +
        'with no BREP kernel required.',
      paramCount: 4,
      params: {
        width: { type: 'number', default: 50 },
        depth: { type: 'number', default: 50 },
        height: { type: 'number', default: 50 },
        chamfer: { type: 'number', default: 5 },
      },
      codeSnippet: [
        '-- Chamfer pattern: subtract wedge prisms from each edge',
        'local function wedge(triPoints, edgeLen, rx, ry, rz)',
        '  local tri = geo.polygon({ points = triPoints })',
        '  local prism = geo.extrude({ height = edgeLen }, { tri })',
        '  local centered = geo.translate({ offset = {0, 0, -edgeLen/2} }, { prism })',
        '  return geo.rotate({ angles = {rx, ry, rz} }, { centered })',
        'end',
        '-- Build 12 wedges (4 vertical + 4 X-aligned + 4 Y-aligned)',
        'return geo.difference({}, { body, geo.union({}, cuts) })',
      ].join('\n'),
    },
    {
      name: 'filleted-slab',
      description:
        'Fully-filleted slab: XY corner fillets via offset_2d round-trip, Z edge fillets via warp. ' +
        'Demonstrates offset_2d(-r) then offset_2d(+r) for corner rounding, and warp for ' +
        'rolling-ball edge fillets.',
      paramCount: 5,
      params: {
        width: { type: 'number', default: 60 },
        depth: { type: 'number', default: 40 },
        height: { type: 'number', default: 20 },
        cornerRadius: { type: 'number', default: 8 },
        edgeRadius: { type: 'number', default: 3 },
      },
      codeSnippet: [
        '-- Fillet pattern: offset_2d round-trip + warp',
        'local rect = geo.rectangle({ size = {params.width, params.depth} })',
        "local shrunk = geo.offset_2d({ delta = -params.cornerRadius, joinType = 'round' }, { rect })",
        "local rounded = geo.offset_2d({ delta = params.cornerRadius, joinType = 'round' }, { shrunk })",
        'local slab = geo.extrude({ height = params.height }, { rounded })',
        'if params.edgeRadius <= 0 then return slab end',
        '-- Rolling-ball warp for Z edge fillets',
        'return geo.warp({ code = warp_code, values = { edgeRadius = ..., ... } }, { slab })',
      ].join('\n'),
    },
  ];

  return ok(examples);
}
