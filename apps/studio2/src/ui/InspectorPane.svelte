<script lang="ts">
  import { getAt, setParam, setParams } from '@yacad/mutations';
  import { getNodeType, type NodeDoc } from '@yacad/dag';
  import { decodeLuaDefinitionBytes } from '../lua-sync';
  import KernelInspector from './inspectors/KernelInspector.svelte';
  import LuaInspector from './inspectors/LuaInspector.svelte';
  import DecoderInspector from './inspectors/DecoderInspector.svelte';
  import InvalidatedInspector from './inspectors/InvalidatedInspector.svelte';
  import type { SessionState } from '../state/session.svelte';
  import type { SelectionState } from '../state/selection.svelte';

  interface Props {
    session: SessionState;
    selection: SelectionState;
    onEditLua: () => void;
    viewerMode: boolean;
    onFocusNode?: ((nodeId: string) => void) | undefined;
    focusedNodeId?: string | null | undefined;
    derivedNodeDoc?: NodeDoc | undefined;
  }

  let { session, selection, onEditLua, viewerMode, onFocusNode, focusedNodeId, derivedNodeDoc }: Props = $props();

  const selectedNode = $derived.by(() => {
    if (!selection.selectedId) return undefined;
    // Derived nodes (from expanded sub-DAGs) aren't in the authored doc.
    // Their NodeDoc is reported by TreeNode via the derivedNodeDoc prop.
    if (selection.selectedId.includes('/__expanded/')) {
      return derivedNodeDoc;
    }
    try {
      return getAt(session.doc, selection.selectedId);
    } catch {
      return undefined;
    }
  });

  const selectedDef = $derived(selectedNode ? getNodeType(selectedNode.type) : undefined);

  const isDerived = $derived(selection?.selectedId?.includes('/__expanded/') ?? false);

  async function commitParam(name: string, value: unknown) {
    if (!selection.selectedId) return;
    try {
      await session.session.mutate((prev) => setParam(prev, selection.selectedId!, name, value));
    } catch (err) {
      // The form-field components surface their own validation errors.
      // Mutation rejection here is fine to surface in console for now.
      console.error('mutate rejected:', err);
    }
  }

  async function commitParams(patch: Record<string, unknown>) {
    if (!selection.selectedId) return;
    try {
      await session.session.mutate((prev) => setParams(prev, selection.selectedId!, patch));
    } catch (err) {
      console.error('mutate rejected:', err);
    }
  }
</script>

{#if session.invalidationError}
  <InvalidatedInspector error={session.invalidationError} />
{:else if !selectedNode}
  <p><em>Select a node from the tree to edit its parameters.</em></p>
{:else}
  <div class="inspector-header">
    {#if isDerived}
      <span class="derived-badge">Generated node — edit Lua source to change</span>
    {/if}
    {#if onFocusNode && selection.selectedId && focusedNodeId !== selection.selectedId}
      <button
        class="inspector-focus-btn"
        title="Show this node's geometry in isolation"
        onclick={() => onFocusNode(selection.selectedId!)}
      >&#128269; Focus</button>
    {/if}
  </div>
  {#if selectedDef?.kind === 'kernel'}
    <KernelInspector
      node={selectedNode}
      onCommit={commitParam}
      onCommitMany={commitParams}
      viewerMode={viewerMode || isDerived}
    />
  {:else if selectedDef?.kind === 'expandable'}
    <LuaInspector
      node={selectedNode}
      definitionResolver={(h) => decodeLuaDefinitionBytes(session.session.blobs.get(h))}
      onCommitValue={commitParam}
      onEditCode={onEditLua}
      viewerMode={viewerMode || isDerived}
    />
  {:else if selectedDef?.kind === 'decoder'}
    <DecoderInspector
      node={selectedNode}
      session={session.session}
      onCommitHash={(h) => commitParam('blobHash', h)}
      viewerMode={viewerMode || isDerived}
    />
  {:else}
    <p><em>no inspector for type "{selectedNode.type}"</em></p>
  {/if}
{/if}
