<script lang="ts">
  import { onMount } from 'svelte';
  import { IndexedDbVfs } from '@yacad/vfs';
  import { DocLibrary } from '@yacad/doc-store';
  import { WorkerClient } from '@yacad/worker';
  import wasmUrl from 'manifold-3d/manifold.wasm?url';
  import luaWasmUrl from 'wasmoon/dist/glue.wasm?url';
  import EvalWorker from './worker?worker';
  import { SessionState } from './state/session.svelte';
  import { SelectionState } from './state/selection.svelte';
  import { seedSceneLibrary } from './seed-scenes';
  import DocPicker from './ui/DocPicker.svelte';
  import TreePane from './ui/TreePane.svelte';
  import InspectorPane from './ui/InspectorPane.svelte';
  import ViewportPane from './ui/ViewportPane.svelte';

  let library: DocLibrary;
  let client = $state<WorkerClient | undefined>(undefined);
  let session = $state<SessionState | undefined>(undefined);
  let selection = $state<SelectionState | undefined>(undefined);
  let docs = $state<{ id: string; name: string }[]>([]);

  async function refreshDocs() {
    if (!library) return;
    const list = await library.list();
    docs = list.map((m) => ({ id: m.id, name: m.name }));
  }

  async function openDoc(id: string) {
    if (session) {
      await session.session.close();
      session.dispose();
    }
    const opened = await library.open(id);
    session = new SessionState(opened);
    selection = new SelectionState();
  }

  async function createDoc() {
    const fresh = await library.create('Untitled');
    await refreshDocs();
    await openDoc(fresh.id);
  }

  onMount(() => {
    const worker = new EvalWorker();
    const newClient = new WorkerClient(worker, { wasmUrl, luaWasmUrl });
    client = newClient;
    const vfs = new IndexedDbVfs();
    library = new DocLibrary(vfs, newClient);
    void (async () => {
      await refreshDocs();
      if (docs.length === 0) {
        await seedSceneLibrary(library);
        await refreshDocs();
      }
      if (docs.length > 0) {
        await openDoc(docs[0]!.id);
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
    <DocPicker {docs} currentId={session?.session.id ?? null} {openDoc} {createDoc} />
  </header>
  <aside class="tree-pane">
    {#if session && selection}
      <TreePane {session} {selection} />
    {:else}
      <em>loading…</em>
    {/if}
  </aside>
  <main class="viewport-pane">
    {#if session && client}
      <ViewportPane {session} {client} />
    {/if}
  </main>
  <aside class="inspector-pane">
    {#if session && selection}
      <InspectorPane {session} {selection} />
    {:else}
      <em>loading…</em>
    {/if}
  </aside>
</div>
