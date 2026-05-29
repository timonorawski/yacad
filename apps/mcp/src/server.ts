#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setupRuntime } from './library-setup';
import type { Ctx } from './context';
import { TOOLS } from './tools';
import { startHttpServer } from './http-server';
import { subscribeSession, broadcastCurrentDocChanged } from './broadcaster';
import { openViewerUrl } from './open-viewer';

export interface Flags {
  port: number | 'auto';
  host: string;
  libraryDir: string;
  noViewer: boolean;
  openViewer: boolean;
}

function parsePort(raw: string): number | 'auto' {
  if (raw === 'auto') return 'auto';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`--port must be an integer between 0 and 65535, or "auto"; got "${raw}"`);
  }
  return port;
}

function hasPortArg(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--port' || arg.startsWith('--port='));
}

function hasArg(args: readonly string[], name: string): boolean {
  return args.some((arg) => arg === name);
}

export function defaultRunArgs(args: readonly string[]): string[] {
  const out = [...args];
  if (!hasPortArg(out)) out.unshift('--port', 'auto');
  if (!hasArg(out, '--open-viewer') && !hasArg(out, '--no-viewer')) out.push('--open-viewer');
  return out;
}

export function parseFlags(args = process.argv.slice(2)): Flags {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: 'string', default: '5179' },
      host: { type: 'string', default: '127.0.0.1' },
      'library-dir': { type: 'string', default: './.yacad-mcp/vfs' },
      'no-viewer': { type: 'boolean', default: false },
      'open-viewer': { type: 'boolean', default: false },
    },
    strict: false,
  });
  return {
    port: parsePort(String(values['port'])),
    host: String(values['host']),
    libraryDir: resolve(String(values['library-dir'])),
    noViewer: Boolean(values['no-viewer']),
    openViewer: Boolean(values['open-viewer']),
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

  if (!flags.noViewer) {
    const handle = await startHttpServer({
      port: flags.port,
      host: flags.host,
      libraryDir: flags.libraryDir,
    });
    ctx.vfsServer = handle.vfsServer;
    ctx.viewer = handle.viewer;
    process.stderr.write(`[yacad-mcp] viewer at ${handle.viewer.url()}\n`);
    if (flags.openViewer) {
      const opened = await openViewerUrl(handle.viewer.url());
      if (!opened) {
        process.stderr.write(`[yacad-mcp] warning: could not open browser automatically\n`);
      }
    }
    if (handle.viewer.currentToken()) {
      process.stderr.write(
        `[yacad-mcp] token mode: access token = ${handle.viewer.currentToken()}\n`,
      );
    }
  } else {
    process.stderr.write(`[yacad-mcp] running headless (--no-viewer)\n`);
  }

  const server = new Server({ name: 'yacad', version: '0.0.0' }, { capabilities: { tools: {} } });

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

    // Side-effect: keep all open sessions subscribed so mutation events flow.
    if (ctx.vfsServer) {
      for (const session of ctx.sessions.values()) {
        subscribeSession(session, ctx.vfsServer);
      }
      // current-doc-changed for tools that affect focus.
      if (['createDoc', 'openDoc', 'setCurrentDoc'].includes(name)) {
        broadcastCurrentDocChanged(ctx);
      }
      // library-changed when the doc set itself changes.
      if (['createDoc', 'deleteDoc'].includes(name)) {
        const metas = await ctx.library.list();
        ctx.vfsServer.broadcast('library-changed', {
          docs: metas.map((m) => ({ id: m.id, name: m.name })),
        });
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: !result.ok,
    };
  });

  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`[yacad-mcp] fatal: ${(err as Error).stack ?? err}\n`);
    process.exit(1);
  });
}
