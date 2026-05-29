<script lang="ts">
  import type { NodeDoc } from '@yacad/dag';
  import { getNodeType } from '@yacad/dag';
  import type { WorkerClient } from '@yacad/worker';
  import type { NodeEval } from '@yacad/engine';
  import type { SelectionState } from '../state/selection.svelte';
  import { formatsFor, type ExportFormat } from '../exports';
  import TreeNode from './TreeNode.svelte';

  interface Props {
    doc: NodeDoc;
    path: string;
    selection: SelectionState;
    outputTypes: Map<string, '2d' | '3d'>;
    onExport: (path: string, format: ExportFormat) => Promise<void>;
    viewerMode: boolean;
    client?: WorkerClient | undefined;
    isDerived?: boolean | undefined;
    perNode?: readonly NodeEval[] | undefined;
    onFocusNode?: ((nodeId: string) => void) | undefined;
    onSelectDerived?: ((path: string, doc: NodeDoc) => void) | undefined;
  }

  let {
    doc,
    path,
    selection,
    outputTypes,
    onExport,
    viewerMode,
    client,
    isDerived,
    perNode,
    onFocusNode,
    onSelectDerived,
  }: Props = $props();

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

  let expansionOpen = $state(false);
  let expansionDoc = $state<NodeDoc | null>(null);
  let expansionLoading = $state(false);

  const isExpandable = $derived(doc.type === 'lua');

  async function toggleExpansion() {
    if (expansionOpen) {
      expansionOpen = false;
      return;
    }
    if (!client || !perNode) return;
    const entry = perNode.find((n) => n.id === path);
    if (!entry) return;
    expansionLoading = true;
    const fetched = await client.getExpandedDoc(entry.hash);
    expansionLoading = false;
    if (fetched) {
      expansionDoc = fetched;
      expansionOpen = true;
    }
  }

  function closeExportMenu() {
    if (exportMenu) exportMenu.open = false;
  }
</script>

<div class="tree-row" class:selected={isSelected} class:derived={isDerived}>
  {#if hasChildren}
    <button class="toggle" onclick={() => (expanded = !expanded)}>{expanded ? '▼' : '▶'}</button>
  {:else}
    <span class="toggle-spacer"></span>
  {/if}
  <button
    class="row-label"
    onclick={() => {
      selection.select(path);
      if (isDerived) onSelectDerived?.(path, doc);
    }}>{summary}</button
  >
  {#if onFocusNode && perNode}
    <button
      class="row-focus"
      title="Inspect this node's geometry in isolation"
      onclick={(e) => {
        e.stopPropagation();
        selection.select(path);
        onFocusNode(path);
      }}
      aria-label="Focus node">&#128269;</button
    >
  {/if}
  {#if isExpandable && !isDerived}
    <button
      class="expansion-toggle"
      onclick={toggleExpansion}
      title={expansionOpen ? 'Hide generated sub-DAG' : 'Show generated sub-DAG'}
      >{expansionLoading ? '…' : expansionOpen ? '▾' : '◆'}</button
    >
  {/if}
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
        {viewerMode}
        {client}
        {isDerived}
        {perNode}
        {onFocusNode}
        {onSelectDerived}
      />
    {/each}
  </div>
{/if}
{#if expansionOpen && expansionDoc}
  <div class="tree-children derived-subtree">
    {#each expansionDoc.children ?? [] as child, i}
      <svelte:self
        doc={child}
        path="{path}/__expanded/{i}"
        {selection}
        {outputTypes}
        onExport={async () => {}}
        viewerMode={true}
        isDerived={true}
        {client}
        {perNode}
        {onSelectDerived}
      />
    {/each}
  </div>
{/if}
