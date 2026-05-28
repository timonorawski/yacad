<script lang="ts">
  import type { NodeDoc } from '@yacad/dag';
  import { getNodeType } from '@yacad/dag';
  import type { SelectionState } from '../state/selection.svelte';
  import { formatsFor, type ExportFormat } from '../exports';
  import TreeNode from './TreeNode.svelte';

  interface Props {
    doc: NodeDoc;
    path: string;
    selection: SelectionState;
    outputTypes: Map<string, '2d' | '3d'>;
    onExport: (path: string, format: ExportFormat) => Promise<void>;
  }

  let { doc, path, selection, outputTypes, onExport }: Props = $props();

  let expanded = $state(true);
  let exportMenu: HTMLDetailsElement | undefined = $state();
  const children = $derived(doc.children ?? []);
  const hasChildren = $derived(children.length > 0);
  const isSelected = $derived(selection.selectedId === path);
  const summary = $derived.by(() => {
    const def = getNodeType(doc.type);
    if (!def) return doc.type + ' (unknown)';
    return doc.type;
  });
  const outputType = $derived(outputTypes.get(path));
  const exportFormats = $derived(outputType ? formatsFor(outputType) : []);

  function closeExportMenu() {
    if (exportMenu) exportMenu.open = false;
  }
</script>

<div class="tree-row" class:selected={isSelected}>
  {#if hasChildren}
    <button class="toggle" onclick={() => (expanded = !expanded)}>{expanded ? '▼' : '▶'}</button>
  {:else}
    <span class="toggle-spacer"></span>
  {/if}
  <button class="row-label" onclick={() => selection.select(path)}>{summary}</button>
  {#if exportFormats.length > 0}
    <details class="row-export" bind:this={exportMenu}>
      <summary aria-label="Export this node">⤓</summary>
      <div class="row-export-panel">
        {#each exportFormats as spec (spec.format)}
          <button
            type="button"
            onclick={() => {
              closeExportMenu();
              void onExport(path, spec.format);
            }}
          >
            {spec.label}
          </button>
        {/each}
      </div>
    </details>
  {/if}
</div>
{#if hasChildren && expanded}
  <div class="tree-children">
    {#each children as child, i (i)}
      <TreeNode
        doc={child}
        path={path === '$' ? `$/${i}` : `${path}/${i}`}
        {selection}
        {outputTypes}
        {onExport}
      />
    {/each}
  </div>
{/if}
