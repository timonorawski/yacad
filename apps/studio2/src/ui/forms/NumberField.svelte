<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: number | undefined;
    onCommit: (value: number) => void;
  }

  let { schema, value, onCommit }: Props = $props();

  let editing = $state(value === undefined ? '' : String(value));
  let error = $state<string | null>(null);

  $effect(() => {
    editing = value === undefined ? '' : String(value);
    error = null;
  });

  function commit() {
    const n = Number(editing);
    if (!Number.isFinite(n)) {
      error = 'must be a number';
      return;
    }
    if (schema.min !== undefined && n < schema.min) {
      error = `must be ≥ ${schema.min}`;
      return;
    }
    if (schema.max !== undefined && n > schema.max) {
      error = `must be ≤ ${schema.max}`;
      return;
    }
    error = null;
    onCommit(n);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  }
</script>

<label class="form-field" class:error={!!error} title={schema.doc}>
  <span>{schema.name}</span>
  <input
    type="number"
    bind:value={editing}
    min={schema.min}
    max={schema.max}
    onblur={commit}
    onkeydown={onKey}
  />
  {#if error}<small class="field-error">{error}</small>{/if}
</label>
