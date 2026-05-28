<script lang="ts">
  import { onMount } from 'svelte';
  import { IndexedDbVfs } from '@yacad/vfs';
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
  import { getAt, setParam } from '@yacad/mutations';
  import DocPicker from './ui/DocPicker.svelte';
  import HeaderMenu from './ui/HeaderMenu.svelte';
  import DocsDrawer from './ui/DocsDrawer.svelte';
  import LuaEditor from './ui/LuaEditor.svelte';
  import TreePane from './ui/TreePane.svelte';
  import InspectorPane from './ui/InspectorPane.svelte';
  import ViewportPane from './ui/ViewportPane.svelte';
  import PerformancePanel from './ui/PerformancePanel.svelte';

  let userLibrary: DocLibrary;
  let sampleLibrary: DocLibrary;
  let client = $state<WorkerClient | undefined>(undefined);
  let session = $state<SessionState | undefined>(undefined);
  let selection = $state<SelectionState | undefined>(undefined);
  let userDocs = $state<{ id: string; name: string }[]>([]);
  let sampleDocs = $state<{ id: string; name: string }[]>([]);
  let docsOpen = $state(false);
  let docsTab = $state<'language' | 'luaApi'>('language');
  let evalOutcome = $state<EvaluateOutcome | undefined>(undefined);
  let luaEditorOpen = $state(false);
  let editingLuaNodeId = $state<string | null>(null);

  async function refreshDocs() {
    if (!userLibrary || !sampleLibrary) return;
    const [users, samples] = await Promise.all([userLibrary.list(), sampleLibrary.list()]);
    userDocs = users.map((m) => ({ id: m.id, name: m.name }));
    sampleDocs = samples.map((m) => ({ id: m.id, name: m.name }));
  }

  async function openDoc(id: string, source: 'user' | 'sample') {
    if (session) {
      await session.session.close();
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
    const vfs = new IndexedDbVfs();
    userLibrary = new DocLibrary(vfs, newClient);
    sampleLibrary = new DocLibrary(vfs, newClient, { prefix: '/samples/' });
    void (async () => {
      if ((await sampleLibrary.list()).length === 0) {
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

    return () => {
      worker.terminate();
      session?.session.close();
      session?.dispose();
    };
  });
</script>

<div class="studio-shell">
  <header class="topbar">
    <DocPicker
      {userDocs}
      {sampleDocs}
      currentId={session?.session.id ?? null}
      {openDoc}
      {createDoc}
    />
    <HeaderMenu
      {docsOpen}
      onToggleDocs={() => (docsOpen = !docsOpen)}
      onRefreshSamples={refreshSamples}
    />
  </header>
  <aside class="tree-pane">
    {#if session && selection}
      <PerformancePanel outcome={evalOutcome} />
      <TreePane {session} {selection} />
    {:else}
      <em>loading…</em>
    {/if}
  </aside>
  <main class="viewport-pane">
    {#if session && client}
      <ViewportPane {session} {client} onEvaluated={(o) => (evalOutcome = o)} />
    {/if}
  </main>
  <aside class="inspector-pane">
    {#if session && selection}
      <InspectorPane {session} {selection} onEditLua={openLuaEditor} />
    {:else}
      <em>loading…</em>
    {/if}
  </aside>
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
