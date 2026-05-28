<script lang="ts">
  import type { SessionState } from '../state/session.svelte';
  import type { SelectionState } from '../state/selection.svelte';
  import TreeNode from './TreeNode.svelte';

  interface Props {
    session: SessionState;
    selection: SelectionState;
  }

  let { session, selection }: Props = $props();
</script>

<div class="tree-pane-inner">
  <TreeNode doc={session.doc} path="$" {selection} />
</div>
