<script lang="ts">
  import { onMount } from 'svelte';
  import type { Vfs } from '@yacad/vfs';
  import { RemoteVfs } from '@yacad/remote-vfs';
  import { DocLibrary } from '@yacad/doc-store';
  import { WorkerClient } from '@yacad/worker';
  import type { EvaluateOutcome } from '@yacad/worker';
  import wasmUrl from 'manifold-3d/manifold.wasm?url';
  import luaWasmUrl from 'wasmoon/dist/glue.wasm?url';
  import EvalWorker from './worker?worker';
  import { SessionState } from './state/session.svelte';
  import { SelectionState } from './state/selection.svelte';
  import { seedSceneLibrary } from './seed-scenes';
  import { syncLuaDefinitionsToWorker, decodeLuaDefinitionBytes } from './lua-sync';
  import {
    archiveLibrary,
    bundleSession,
    downloadJson,
    importPayload,
    parseImportPayload,
    uploadJson,
  } from './doc-io';
  import { getAt, setParam } from '@yacad/mutations';
  import { computeOutputTypes } from './output-types';
  import { runExport, type ExportFormat } from './exports';
  import DocPicker from './ui/DocPicker.svelte';
  import HeaderMenu from './ui/HeaderMenu.svelte';
  import DocsDrawer from './ui/DocsDrawer.svelte';
  import LuaEditor from './ui/LuaEditor.svelte';
  import TreePane from './ui/TreePane.svelte';
  import InspectorPane from './ui/InspectorPane.svelte';
  import ViewportPane from './ui/ViewportPane.svelte';
  import PerformancePanel from './ui/PerformancePanel.svelte';

  interface Props {
    vfs: Vfs;
    viewerMode: boolean;
  }
  let { vfs, viewerMode }: Props = $props();

  let userLibrary: DocLibrary;
  let sampleLibrary: DocLibrary;
  let client = $state<WorkerClient | undefined>(undefined);
  let session = $state<SessionState | undefined>(undefined);
  let selection = $state<SelectionState | undefined>(undefined);
  let userDocs = $state<{ id: string; name: string }[]>([]);
  let sampleDocs = $state<{ id: string; name: string }[]>([]);
  let docsOpen = $state(false);
  let docsTab = $state<'language' | 'luaApi' | 'architecture' | 'features'>('language');
  let evalOutcome = $state<EvaluateOutcome | undefined>(undefined);
  let luaEditorOpen = $state(false);
  let editingLuaNodeId = $state<string | null>(null);
  let outputTypes = $state<Map<string, '2d' | '3d'>>(new Map());

  // Focused-node inspection state (shared across viewport, tree, inspector).
  let focusedNodeId = $state<string | null>(null);
  let focusedHash = $state<string | null>(null);

  function focusNode(nodeId: string) {
    if (!evalOutcome?.perNode) return;
    const entry = evalOutcome.perNode.find((n) => n.id === nodeId);
    if (!entry?.hash) return;
    focusedNodeId = nodeId;
    focusedHash = entry.hash;
  }

  function unfocus() {
    focusedNodeId = null;
    focusedHash = null;
  }

  // Exit focus mode when selection changes to a different node.
  $effect(() => {
    const sel = selection?.selectedId;
    if (focusedNodeId && sel !== focusedNodeId) {
      unfocus();
    }
  });

  // Sheet visibility state — desktop defaults open, mobile defaults closed.
  const DESKTOP_BREAKPOINT = 900;
  let treeOpen = $state(
    typeof window !== 'undefined' ? window.innerWidth >= DESKTOP_BREAKPOINT : true,
  );
  let inspectorOpen = $state(
    typeof window !== 'undefined' ? window.innerWidth >= DESKTOP_BREAKPOINT : true,
  );

  // Keep an outputType-per-path map in sync with the current session. Walks
  // the validated graph; on invalidated docs the map empties and tree-row
  // gadgets vanish until the document is fixed.
  $effect(() => {
    if (!session) {
      outputTypes = new Map();
      return;
    }
    const doc = session.doc;
    const blobs = session.session.blobs;
    let cancelled = false;
    void computeOutputTypes(doc, blobs).then((map) => {
      if (!cancelled) outputTypes = map;
    });
    return () => {
      cancelled = true;
    };
  });

  async function exportNode(path: string, format: ExportFormat): Promise<void> {
    if (!session || !client) return;
    try {
      const safeName = session.name || 'document';
      const base =
        path === '$' ? safeName : `${safeName}${path.replace(/\$/g, '').replace(/\//g, '-')}`;
      // $state.snapshot strips the Svelte proxy wrapper — postMessage needs
      // plain structured-cloneable objects.
      await runExport(client, $state.snapshot(session.doc), path, format, base);
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`);
    }
  }

  async function refreshDocs() {
    if (!userLibrary || !sampleLibrary) return;
    const [users, samples] = await Promise.all([userLibrary.list(), sampleLibrary.list()]);
    userDocs = users.map((m) => ({ id: m.id, name: m.name }));
    sampleDocs = samples.map((m) => ({ id: m.id, name: m.name }));
  }

  async function openDoc(id: string, source: 'user' | 'sample') {
    if (session) {
      // close() may flush a dirty session via vfs.write; in viewer mode the
      // RemoteVfs is read-only so the write rejects. Swallow — the dispose
      // below still cleans the in-memory state, and the source of truth lives
      // on the MCP server anyway.
      await session.session.close().catch(() => undefined);
      session.dispose();
    }
    const lib = source === 'sample' ? sampleLibrary : userLibrary;
    const opened = await lib.open(id);
    if (client) {
      await syncLuaDefinitionsToWorker(opened, client);
    }
    session = new SessionState(opened);
    selection = new SelectionState();
    evalOutcome = undefined;
  }

  async function createDoc() {
    const fresh = await userLibrary.create('Untitled');
    await refreshDocs();
    await openDoc(fresh.id, 'user');
  }

  async function refreshSamples() {
    // Wipe all existing samples, then re-seed.
    if (session) {
      await session.session.close();
      session.dispose();
      session = undefined;
      selection = undefined;
    }
    const metas = await sampleLibrary.list();
    for (const meta of metas) {
      await sampleLibrary.delete(meta.id);
    }
    await seedSceneLibrary(sampleLibrary);
    await refreshDocs();
    if (sampleDocs.length > 0) {
      await openDoc(sampleDocs[0]!.id, 'sample');
    }
  }

  async function downloadCurrent() {
    if (!session) return;
    const bundle = bundleSession(session.session);
    const safe = bundle.meta.name.replace(/[^a-z0-9._-]+/gi, '_');
    downloadJson(bundle, `${safe}.yacad.json`);
  }

  async function downloadAll() {
    if (!userLibrary) return;
    const archive = await archiveLibrary(userLibrary);
    downloadJson(archive, `yacad-docs-${new Date().toISOString().slice(0, 10)}.yacad-archive.json`);
  }

  async function clearCache() {
    if (!client) return;
    await client.clearCache();
    // The store is empty now but the on-screen geometry hasn't changed —
    // nudge the viewport to re-evaluate so the user sees every node as a
    // miss in the perf panel.
    if (session) {
      const ev = new Event('yacad:cache-cleared');
      window.dispatchEvent(ev);
    }
  }

  async function importDoc() {
    const text = await uploadJson();
    if (!text) return;
    let payload;
    try {
      payload = parseImportPayload(text);
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
      return;
    }
    try {
      const result = await importPayload(userLibrary, payload);
      await refreshDocs();
      if (result.newIds.length > 0) {
        await openDoc(result.newIds[0]!, 'user');
      }
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    }
  }

  const editingLuaDefinition = $derived.by(() => {
    if (!editingLuaNodeId || !session) return undefined;
    let node;
    try {
      node = getAt(session.doc, editingLuaNodeId);
    } catch {
      return undefined;
    }
    if (node.type !== 'lua') return undefined;
    const hash = (node.params ?? {})['definitionHash'];
    if (typeof hash !== 'string') return undefined;
    return decodeLuaDefinitionBytes(session.session.blobs.get(hash));
  });

  function openLuaEditor() {
    if (!selection?.selectedId) return;
    editingLuaNodeId = selection.selectedId;
    luaEditorOpen = true;
  }

  async function saveLuaDefinition(
    newHash: string,
    newBytes: Uint8Array,
    newDef: { schema: unknown; code: string },
  ): Promise<void> {
    if (!session || !editingLuaNodeId || !client) return;
    await session.session.addBlob(newBytes);
    await client.putLuaDefinition(newHash, newDef as Parameters<typeof client.putLuaDefinition>[1]);
    await session.session.mutate((prev) =>
      setParam(prev, editingLuaNodeId!, 'definitionHash', newHash),
    );
  }

  onMount(() => {
    const worker = new EvalWorker();
    const newClient = new WorkerClient(worker, { wasmUrl, luaWasmUrl });
    client = newClient;
    userLibrary = new DocLibrary(vfs, newClient);
    sampleLibrary = new DocLibrary(vfs, newClient, { prefix: '/samples/' });
    void (async () => {
      if (!viewerMode && (await sampleLibrary.list()).length === 0) {
        await seedSceneLibrary(sampleLibrary);
      }
      await refreshDocs();
      if (sampleDocs.length > 0) {
        await openDoc(sampleDocs[0]!.id, 'sample');
      } else if (userDocs.length > 0) {
        await openDoc(userDocs[0]!.id, 'user');
      } else {
        await createDoc();
      }
    })();

    // In viewer mode, subscribe to live doc updates pushed over WS so the
    // tree, inspector, doc list, and blob set all track the MCP server.
    // Each handler is best-effort: WS broadcasts arrive asynchronously and a
    // throw would become an unhandled rejection that silently breaks future
    // delivery, so we wrap every observer in catch + console.error.
    const unsubs: Array<() => void> = [];
    if (viewerMode && vfs instanceof RemoteVfs) {
      // current-doc-changed: server moved focus to a different doc.
      unsubs.push(
        vfs.on('current-doc-changed', (payload) => {
          const p = payload as { id: string };
          if (session && session.session.id === p.id) return;
          void openDoc(p.id, 'user').catch((err: unknown) => {
            console.error('viewer: current-doc-changed handler failed', err);
          });
        }),
      );

      // doc-changed: tree mutation on the currently-open doc. Apply directly
      // so Svelte re-renders without replacing the session (preserves the
      // user's selection). Autosave will reject with viewer-read-only —
      // intentionally swallowed.
      unsubs.push(
        vfs.on('doc-changed', (payload) => {
          const p = payload as { id: string; doc: import('@yacad/dag').NodeDoc };
          if (session && session.session.id === p.id) {
            void session.session.mutate(() => p.doc).catch(() => undefined);
          }
        }),
      );

      // blob-added: a new blob (Lua def, mesh import) was added to a session.
      // Push it into the open session's blob set so the validator and the
      // inspector pick it up. Same write-rejection ignored.
      unsubs.push(
        vfs.on('blob-added', (payload) => {
          const p = payload as { id: string; hash: string; base64: string };
          if (!session || session.session.id !== p.id) return;
          if (session.session.blobs.has(p.hash)) return;
          const bytes = Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0));
          void session.session.addBlob(bytes).catch(() => undefined);
        }),
      );

      // meta-changed: doc name etc. updated. Refresh the visible lists.
      unsubs.push(
        vfs.on('meta-changed', () => {
          void refreshDocs().catch((err: unknown) => {
            console.error('viewer: meta-changed refreshDocs failed', err);
          });
        }),
      );

      // library-changed: docs created/deleted on the server. Keep the
      // viewer's lists in sync so the picker (if shown) matches reality.
      unsubs.push(
        vfs.on('library-changed', () => {
          void refreshDocs().catch((err: unknown) => {
            console.error('viewer: library-changed refreshDocs failed', err);
          });
        }),
      );
    }

    return () => {
      for (const u of unsubs) u();
      worker.terminate();
      session?.session.close().catch(() => undefined);
      session?.dispose();
    };
  });
</script>

<div class="studio-shell">
  <header class="topbar">
    {#if !viewerMode}
      <DocPicker
        {userDocs}
        {sampleDocs}
        currentId={session?.session.id ?? null}
        {openDoc}
        {createDoc}
      />
    {/if}
    <HeaderMenu
      {viewerMode}
      {docsOpen}
      onToggleDocs={() => (docsOpen = !docsOpen)}
      onRefreshSamples={refreshSamples}
      onDownloadCurrent={downloadCurrent}
      onDownloadAll={downloadAll}
      onImport={importDoc}
      onClearCache={clearCache}
    />
  </header>
  <div class="workspace">
    <main class="viewport-pane">
      {#if session && client}
        <ViewportPane
          {session}
          {client}
          onEvaluated={(o) => (evalOutcome = o)}
          selectedId={selection?.selectedId ?? null}
          perNode={evalOutcome?.perNode}
          {focusedHash}
          onUnfocus={unfocus}
        />
      {/if}
      <button
        class="sheet-toggle left"
        class:active={treeOpen}
        onclick={() => (treeOpen = !treeOpen)}
        aria-label={treeOpen ? 'Hide tree panel' : 'Show tree panel'}
        title={treeOpen ? 'Hide tree' : 'Show tree'}>&#9776;</button
      >
      <button
        class="sheet-toggle right"
        class:active={inspectorOpen}
        onclick={() => (inspectorOpen = !inspectorOpen)}
        aria-label={inspectorOpen ? 'Hide inspector panel' : 'Show inspector panel'}
        title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}>&#9881;</button
      >
    </main>
    <aside class="tree-pane sheet" class:open={treeOpen}>
      {#if session && selection}
        <TreePane
          {session}
          {selection}
          {outputTypes}
          onExport={exportNode}
          {viewerMode}
          {client}
          perNode={evalOutcome?.perNode}
          onFocusNode={focusNode}
        />
        <PerformancePanel outcome={evalOutcome} />
      {:else}
        <em>loading…</em>
      {/if}
    </aside>
    <aside class="inspector-pane sheet" class:open={inspectorOpen}>
      {#if session && selection}
        <InspectorPane
          {session}
          {selection}
          onEditLua={openLuaEditor}
          {viewerMode}
          onFocusNode={focusNode}
          focusedNodeId={focusedNodeId}
        />
      {:else}
        <em>loading…</em>
      {/if}
    </aside>
  </div>
  <DocsDrawer
    open={docsOpen}
    tab={docsTab}
    onTabChange={(t) => (docsTab = t)}
    onClose={() => (docsOpen = false)}
  />
  {#if luaEditorOpen && editingLuaDefinition}
    <LuaEditor
      definition={editingLuaDefinition}
      onClose={() => (luaEditorOpen = false)}
      onSave={saveLuaDefinition}
      onOpenApiRef={() => {
        docsTab = 'luaApi';
        docsOpen = true;
      }}
    />
  {/if}
</div>
