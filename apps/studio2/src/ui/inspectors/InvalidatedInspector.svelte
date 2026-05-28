<script lang="ts">
  interface Props {
    error: Error | undefined;
  }
  let { error }: Props = $props();
</script>

<h3 class="invalidated-title">document invalidated</h3>
{#if error}
  <p class="field-error">{error.message}</p>
{/if}
<p>
  <em>Reset to last valid is not yet implemented; please review the JSON outside the editor.</em>
</p>
