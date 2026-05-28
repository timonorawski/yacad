<script lang="ts">
  import { getAt, addChild, removeAt, wrapWith } from '@yacad/mutations';
  import { getNodeType, type GeometryType } from '@yacad/dag';
  import type { SessionState } from '../state/session.svelte';
  import type { SelectionState } from '../state/selection.svelte';

  interface Props {
    session: SessionState;
    selection: SelectionState;
  }

  let { session, selection }: Props = $props();

  // Sensible wrapper defaults per type — what the user gets if they wrap with
  // translate/rotate/etc. Tooling-side curation; can be expanded.
  const WRAPPERS_3D: { type: string; params: Record<string, unknown> }[] = [
    { type: 'translate', params: { offset: [0, 0, 0] } },
    { type: 'rotate', params: { angles: [0, 0, 0] } },
  ];
  const WRAPPERS_2D: { type: string; params: Record<string, unknown> }[] = [
    { type: 'translate_2d', params: { offset: [0, 0] } },
    { type: 'rotate_2d', params: { angle: 0 } },
    { type: 'extrude', params: { height: 10 } },
  ];

  const selectedNode = $derived.by(() => {
    if (!selection.selectedId) return undefined;
    try {
      return getAt(session.doc, selection.selectedId);
    } catch {
      return undefined;
    }
  });

  const outputType = $derived.by<GeometryType | undefined>(() => {
    if (!selectedNode) return undefined;
    const def = getNodeType(selectedNode.type);
    if (!def) return undefined;
    if (def.kind === 'kernel') {
      if (typeof def.output === 'function') {
        try {
          return def.output([]);
        } catch {
          return undefined;
        }
      }
      return def.output;
    }
    // Expandable/decoder — best-effort.
    return undefined;
  });

  const wrappers = $derived(outputType === '2d' ? WRAPPERS_2D : WRAPPERS_3D);

  async function wrapWithType(type: string, params: Record<string, unknown>) {
    if (!selection.selectedId) return;
    try {
      await session.session.mutate((prev) => wrapWith(prev, selection.selectedId!, type, params));
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteSelected() {
    if (!selection.selectedId || selection.selectedId === '$') return;
    try {
      await session.session.mutate((prev) => removeAt(prev, selection.selectedId!));
      selection.clear();
    } catch (err) {
      console.error(err);
    }
  }

  async function addPrimitiveChild() {
    if (!selection.selectedId) return;
    const seed = { type: 'box', params: { size: [10, 10, 10], center: true } };
    try {
      await session.session.mutate((prev) => addChild(prev, selection.selectedId!, seed));
    } catch (err) {
      console.error(err);
    }
  }
</script>

<div class="tool-palette">
  <details>
    <summary>Wrap with…</summary>
    {#each wrappers as w (w.type)}
      <button onclick={() => wrapWithType(w.type, w.params)}>{w.type}</button>
    {/each}
  </details>
  <button onclick={addPrimitiveChild} disabled={!selectedNode}>+ child (box)</button>
  <button onclick={deleteSelected} disabled={!selection.selectedId || selection.selectedId === '$'}>
    delete
  </button>
</div>
