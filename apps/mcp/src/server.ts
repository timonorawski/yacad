#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setupRuntime } from './library-setup';
import type { Ctx } from './context';
import { TOOLS } from './tools';

interface Flags {
  port: number;
  host: string;
  libraryDir: string;
  noViewer: boolean;
}

function parseFlags(): Flags {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '5179' },
      host: { type: 'string', default: '127.0.0.1' },
      'library-dir': { type: 'string', default: './.yacad-mcp/vfs' },
      'no-viewer': { type: 'boolean', default: false },
    },
    strict: false,
  });
  return {
    port: Number(values['port']),
    host: String(values['host']),
    libraryDir: resolve(String(values['library-dir'])),
    noViewer: Boolean(values['no-viewer']),
  };
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const rt = await setupRuntime(flags.libraryDir);
  const ctx: Ctx = {
    ...rt,
    sessions: new Map(),
    currentDocId: undefined,
    vfsServer: undefined,
    viewer: undefined,
  };

  // HTTP+WS is set up by Task 16. For Task 15 we just leave a stub:
  if (!flags.noViewer) {
    process.stderr.write(`[yacad-mcp] viewer wiring not yet implemented; running headless\n`);
  } else {
    process.stderr.write(`[yacad-mcp] running headless (--no-viewer)\n`);
  }

  const server = new Server(
    { name: 'yacad', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: false, error: { code: 'unknown-tool', message: name } }),
          },
        ],
        isError: true,
      };
    }
    const result = await tool.handler(ctx, args ?? {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: !result.ok,
    };
  });

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`[yacad-mcp] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
