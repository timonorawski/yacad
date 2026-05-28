import type { NodeDoc } from '@yacad/dag';
import type { DocSession } from '@yacad/doc-store';
import type { LuaDefinition } from '@yacad/lua';
import type { WorkerClient } from '@yacad/worker';

const DEC = new TextDecoder();

/**
 * Re-route every Lua-definition blob carried by the session into the worker's
 * Lua-definitions map (via `putLuaDefinition`). The session's generic blob
 * upload path uses `putMeshBlob`, which lands bytes in the worker's mesh-blob
 * map — invisible to the Lua node's resolver. This helper walks the doc, finds
 * every `lua` node's `definitionHash`, parses the matching blob bytes, and
 * uploads via the correct path. Idempotent: `hasLuaDefinition` short-circuits
 * already-loaded definitions.
 *
 * Architectural note: a proper fix is for `@yacad/doc-store` to distinguish
 * blob kinds (mesh vs Lua-definition) and route uploads accordingly on
 * `library.open`. That's a larger refactor — this is the studio-side
 * workaround until that lands.
 */
export async function syncLuaDefinitionsToWorker(
  session: DocSession,
  client: WorkerClient,
): Promise<void> {
  const luaHashes = collectLuaDefinitionHashes(session.doc);
  for (const hash of luaHashes) {
    if (await client.hasLuaDefinition(hash)) continue;
    const bytes = session.blobs.get(hash);
    if (!bytes) {
      // Blob is not in the session — could not have been seeded by us, or
      // the doc references a definition that was never persisted. Surface
      // a console.warn for debuggability; the Lua node will still throw at
      // eval time, which is the right place for the user-visible error.
      console.warn(`syncLuaDefinitionsToWorker: blob for ${hash.slice(0, 12)}… not in session`);
      continue;
    }
    let def: LuaDefinition;
    try {
      def = JSON.parse(DEC.decode(bytes)) as LuaDefinition;
    } catch (err) {
      console.warn(
        `syncLuaDefinitionsToWorker: blob ${hash.slice(0, 12)}… is not valid JSON, skipping`,
        err,
      );
      continue;
    }
    await client.putLuaDefinition(hash, def);
  }
}

/**
 * Parse a LuaDefinition blob from its canonical-JSON byte form. Returns
 * `undefined` on null bytes or parse failure — the caller decides how to
 * surface the missing-definition case to the user.
 */
export function decodeLuaDefinitionBytes(bytes: Uint8Array | undefined): LuaDefinition | undefined {
  if (!bytes) return undefined;
  try {
    return JSON.parse(DEC.decode(bytes)) as LuaDefinition;
  } catch {
    return undefined;
  }
}

/** Walk the NodeDoc tree and collect every `definitionHash` from `lua` nodes. */
function collectLuaDefinitionHashes(doc: NodeDoc): readonly string[] {
  const hashes = new Set<string>();
  const visit = (node: NodeDoc): void => {
    if (node.type === 'lua') {
      const hash = (node.params ?? {})['definitionHash'];
      if (typeof hash === 'string' && hash.length > 0) hashes.add(hash);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(doc);
  return [...hashes];
}
