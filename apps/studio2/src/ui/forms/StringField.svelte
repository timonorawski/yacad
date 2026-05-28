<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: string | undefined;
    onCommit: (value: string) => void;
  }

  let { schema, value, onCommit }: Props = $props();

  let editing = $state(value ?? '');
  $effect(() => {
    editing = value ?? '';
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  }
</script>

<label class="form-field" title={schema.doc}>
  <span>{schema.name}</span>
  <input type="text" bind:value={editing} onblur={() => onCommit(editing)} onkeydown={onKey} />
</label>
