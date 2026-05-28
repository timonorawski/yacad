<script lang="ts">
  import { getAt, setParam } from '@yacad/mutations';
  import { getNodeType } from '@yacad/dag';
  import KernelInspector from './inspectors/KernelInspector.svelte';
  import LuaInspector from './inspectors/LuaInspector.svelte';
  import DecoderInspector from './inspectors/DecoderInspector.svelte';
  import InvalidatedInspector from './inspectors/InvalidatedInspector.svelte';
  import type { SessionState } from '../state/session.svelte';
  import type { SelectionState } from '../state/selection.svelte';

  interface Props {
    session: SessionState;
    selection: SelectionState;
  }

  let { session, selection }: Props = $props();

  const selectedNode = $derived.by(() => {
    if (!selection.selectedId) return undefined;
    try {
      return getAt(session.doc, selection.selectedId);
    } catch {
      return undefined;
    }
  });

  const selectedDef = $derived(selectedNode ? getNodeType(selectedNode.type) : undefined);

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
</script>

{#if session.invalidationError}
  <InvalidatedInspector error={session.invalidationError} />
{:else if !selectedNode}
  <p><em>Select a node from the tree to edit its parameters.</em></p>
{:else if selectedDef?.kind === 'kernel'}
  <KernelInspector node={selectedNode} onCommit={commitParam} />
{:else if selectedDef?.kind === 'expandable'}
  <LuaInspector
    node={selectedNode}
    definitionResolver={(h) => session.session.blobs.get(h)}
    onCommitValue={commitParam}
  />
{:else if selectedDef?.kind === 'decoder'}
  <DecoderInspector
    node={selectedNode}
    session={session.session}
    onCommitHash={(h) => commitParam('blobHash', h)}
  />
{:else}
  <p><em>no inspector for type "{selectedNode.type}"</em></p>
{/if}
