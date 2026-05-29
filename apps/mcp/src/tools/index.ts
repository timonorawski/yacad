import type { Ctx } from '../context';
import * as library from './library-tools';
import * as read from './read-tools';
import * as mutate from './mutate-tools';
import * as lua from './lua-tools';
import * as exp from './export-tools';
import * as cache from './cache-tools';
import * as server from './server-tools';
import * as docs from './doc-tools';
import type { ToolResult } from './library-tools';

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: object; // JSON Schema
  readonly handler: (ctx: Ctx, args: Record<string, unknown>) => Promise<ToolResult<unknown>>;
}

/**
 * Single source of truth: every tool's name, description, JSON Schema, and
 * handler in one array. The MCP server dispatches by name; the schema is
 * shipped in the `tools/list` response so clients (Claude) can validate args.
 */
export const TOOLS: readonly ToolDef[] = [
  // library (5)
  {
    name: 'listDocs',
    description: 'List all documents in the library.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (ctx) => library.listDocs(ctx, {}),
  },
  {
    name: 'createDoc',
    description: 'Create a new document; sets it as the current focus.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, initialDoc: { type: 'object' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => library.createDoc(ctx, args as { name: string; initialDoc?: unknown }),
  },
  {
    name: 'openDoc',
    description: 'Open a document by id and set it as the current focus.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => library.openDoc(ctx, args as { id: string }),
  },
  {
    name: 'deleteDoc',
    description: 'Delete a document by id.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => library.deleteDoc(ctx, args as { id: string }),
  },
  {
    name: 'setCurrentDoc',
    description: 'Switch viewer focus to an already-open session.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => library.setCurrentDoc(ctx, args as { id: string }),
  },

  // read (3)
  {
    name: 'getDoc',
    description: 'Return the current document tree as JSON.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (ctx) => read.getDoc(ctx, {}),
  },
  {
    name: 'getNodeAt',
    description: 'Return a node summary at a path (e.g. "$", "$/0", "$/1/2").',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => read.getNodeAt(ctx, args as { path: string }),
  },
  {
    name: 'evaluate',
    description: 'Evaluate the current document; returns bbox, triangle count, cache stats.',
    inputSchema: {
      type: 'object',
      properties: { tier: { type: 'string' }, includePerNode: { type: 'boolean' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => read.evaluate(ctx, args as { tier?: string; includePerNode?: boolean }),
  },

  // mutate (8)
  {
    name: 'addChild',
    description: 'Add a child node under parentPath.',
    inputSchema: {
      type: 'object',
      required: ['parentPath', 'nodeDoc'],
      properties: {
        parentPath: { type: 'string' },
        nodeDoc: { type: 'object' },
        insertAt: { type: 'integer' },
      },
      additionalProperties: false,
    },
    handler: (ctx, args) =>
      mutate.addChild(ctx, args as { parentPath: string; nodeDoc: unknown; insertAt?: number }),
  },
  {
    name: 'wrapWith',
    description: 'Wrap the node at path inside a new parent of the given type.',
    inputSchema: {
      type: 'object',
      required: ['path', 'type'],
      properties: {
        path: { type: 'string' },
        type: { type: 'string' },
        params: { type: 'object' },
      },
      additionalProperties: false,
    },
    handler: (ctx, args) =>
      mutate.wrapWith(
        ctx,
        args as { path: string; type: string; params?: Record<string, unknown> },
      ),
  },
  {
    name: 'unwrap',
    description: 'Replace the node at path with its sole child (errors if not exactly one child).',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => mutate.unwrap(ctx, args as { path: string }),
  },
  {
    name: 'removeAt',
    description: 'Remove the node at path.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => mutate.removeAt(ctx, args as { path: string }),
  },
  {
    name: 'moveChild',
    description: 'Move a node to another parent at a given index.',
    inputSchema: {
      type: 'object',
      required: ['srcPath', 'destParentPath', 'destIndex'],
      properties: {
        srcPath: { type: 'string' },
        destParentPath: { type: 'string' },
        destIndex: { type: 'integer' },
      },
      additionalProperties: false,
    },
    handler: (ctx, args) =>
      mutate.moveChild(ctx, args as { srcPath: string; destParentPath: string; destIndex: number }),
  },
  {
    name: 'replaceAt',
    description: 'Replace the node at path with newDoc.',
    inputSchema: {
      type: 'object',
      required: ['path', 'newDoc'],
      properties: { path: { type: 'string' }, newDoc: { type: 'object' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => mutate.replaceAt(ctx, args as { path: string; newDoc: unknown }),
  },
  {
    name: 'setParam',
    description: 'Set a single param on the node at path.',
    inputSchema: {
      type: 'object',
      required: ['path', 'key', 'value'],
      properties: { path: { type: 'string' }, key: { type: 'string' }, value: {} },
      additionalProperties: false,
    },
    handler: (ctx, args) =>
      mutate.setParam(ctx, args as { path: string; key: string; value: unknown }),
  },
  {
    name: 'setParams',
    description: 'Atomically update many params; null values delete the key.',
    inputSchema: {
      type: 'object',
      required: ['path', 'patch'],
      properties: { path: { type: 'string' }, patch: { type: 'object' } },
      additionalProperties: false,
    },
    handler: (ctx, args) =>
      mutate.setParams(ctx, args as { path: string; patch: Record<string, unknown> }),
  },

  // lua (2)
  {
    name: 'addLuaDefinition',
    description:
      'Validate, register, and return the hash of a LuaDefinition. Requires a current doc — the bytes are persisted into its blob set so they ship with the document. Call createDoc or openDoc first.',
    inputSchema: {
      type: 'object',
      required: ['schema', 'code'],
      properties: { schema: { type: 'object' }, code: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => lua.addLuaDefinition(ctx, args as { schema: never; code: string }),
  },
  {
    name: 'validateLuaCode',
    description: 'Dry-run validation; never registers.',
    inputSchema: {
      type: 'object',
      required: ['schema', 'code'],
      properties: { schema: { type: 'object' }, code: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => lua.validateLuaCode(ctx, args as { schema: never; code: string }),
  },

  // export (4)
  {
    name: 'exportStl',
    description: 'Export a 3D node as binary STL (base64).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => exp.exportStl(ctx, args as { path?: string }),
  },
  {
    name: 'exportSvg',
    description: 'Export a 2D node as SVG (base64).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => exp.exportSvg(ctx, args as { path?: string }),
  },
  {
    name: 'exportDxf',
    description: 'Export a 2D node as DXF (base64).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => exp.exportDxf(ctx, args as { path?: string }),
  },
  {
    name: 'exportPng',
    description: 'Export a 2D node as PNG (base64).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        opts: {
          type: 'object',
          properties: {
            width: { type: 'integer' },
            height: { type: 'integer' },
            background: { type: 'string' },
          },
        },
      },
      additionalProperties: false,
    },
    handler: (ctx, args) =>
      exp.exportPng(
        ctx,
        args as {
          path?: string;
          opts?: { width: number; height: number; background?: string };
        },
      ),
  },

  // cache (1)
  {
    name: 'clearCache',
    description: 'Drop the engine cache; next evaluate is all misses.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (ctx) => cache.clearCache(ctx, {}),
  },

  // server (2)
  {
    name: 'getViewerUrl',
    description:
      'Return the current viewer URL (with token when applicable). Tell the user to open it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (ctx) => server.getViewerUrl(ctx, {}),
  },
  {
    name: 'rotateAccessToken',
    description:
      'Generate a fresh access token and drop all connected viewers (they will reconnect with the new URL). Errors on localhost-only servers.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (ctx) => server.rotateAccessToken(ctx, {}),
  },

  // docs (5)
  {
    name: 'listNodeTypes',
    description:
      'List all registered node types with their kind (kernel/expandable/decoder), output type, and brief summary.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (ctx) => docs.listNodeTypes(ctx, {}),
  },
  {
    name: 'getNodeTypeDoc',
    description:
      'Get full documentation for a specific node type: summary, paramSchema (name, type, required, default, min, max, enum, doc string), output type, child requirements, and Lua example.',
    inputSchema: {
      type: 'object',
      required: ['type'],
      properties: { type: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (ctx, args) => docs.getNodeTypeDoc(ctx, args as { type: string }),
  },
  {
    name: 'getLanguageReference',
    description:
      'Return the full DAG language reference documentation (all node types, document shape, dual type system, validation rules, and examples).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (ctx) => docs.getLanguageReference(ctx, {}),
  },
  {
    name: 'getLuaApiReference',
    description:
      'Return documentation about the Lua sandbox API surface: available globals (geo.*, params, inputs, math.*, string.*, table.*), all geo.* functions, and LuaDefinition param types.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (ctx) => docs.getLuaApiReference(ctx, {}),
  },
  {
    name: 'getExamples',
    description:
      'Return example LuaDefinitions and DAG patterns from the showcase collection (house, castle, tree, torus-knot, chamfered-box, filleted-slab).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (ctx) => docs.getExamples(ctx, {}),
  },
];
