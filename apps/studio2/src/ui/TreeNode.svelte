<script lang="ts">
  import type { NodeDoc } from '@yacad/dag';
  import { getNodeType } from '@yacad/dag';
  import type { SelectionState } from '../state/selection.svelte';
  import TreeNode from './TreeNode.svelte';

  interface Props {
    doc: NodeDoc;
    path: string;
    selection: SelectionState;
  }

  let { doc, path, selection }: Props = $props();

  let expanded = $state(true);
  const children = $derived(doc.children ?? []);
  const hasChildren = $derived(children.length > 0);
  const isSelected = $derived(selection.selectedId === path);
  const summary = $derived.by(() => {
    const def = getNodeType(doc.type);
    if (!def) return doc.type + ' (unknown)';
    return doc.type;
  });
</script>

<div class="tree-row" class:selected={isSelected}>
  {#if hasChildren}
    <button class="toggle" onclick={() => (expanded = !expanded)}>{expanded ? '▼' : '▶'}</button>
  {:else}
    <span class="toggle-spacer"></span>
  {/if}
  <button class="row-label" onclick={() => selection.select(path)}>{summary}</button>
</div>
{#if hasChildren && expanded}
  <div class="tree-children">
    {#each children as child, i (i)}
      <TreeNode doc={child} path={path === '$' ? `$/${i}` : `${path}/${i}`} {selection} />
    {/each}
  </div>
{/if}
