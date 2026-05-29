<script lang="ts">
  import type { SessionState } from '../state/session.svelte';
  import type { SelectionState } from '../state/selection.svelte';
  import type { ExportFormat } from '../exports';
  import TreeNode from './TreeNode.svelte';
  import ToolPalette from './ToolPalette.svelte';

  interface Props {
    session: SessionState;
    selection: SelectionState;
    outputTypes: Map<string, '2d' | '3d'>;
    onExport: (path: string, format: ExportFormat) => Promise<void>;
    viewerMode: boolean;
  }

  let { session, selection, outputTypes, onExport, viewerMode }: Props = $props();
</script>

<div class="tree-pane-inner">
  {#if !viewerMode}
    <ToolPalette {session} {selection} />
  {/if}
  <TreeNode doc={session.doc} path="$" {selection} {outputTypes} {onExport} {viewerMode} />
</div>
