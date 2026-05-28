<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: [number, number, number] | undefined;
    onCommit: (value: [number, number, number]) => void;
  }

  let { schema, value, onCommit }: Props = $props();

  let editing = $state<[string, string, string]>([
    value?.[0]?.toString() ?? '0',
    value?.[1]?.toString() ?? '0',
    value?.[2]?.toString() ?? '0',
  ]);
  let error = $state<string | null>(null);

  $effect(() => {
    editing = [
      value?.[0]?.toString() ?? '0',
      value?.[1]?.toString() ?? '0',
      value?.[2]?.toString() ?? '0',
    ];
    error = null;
  });

  function commit() {
    const x = Number(editing[0]);
    const y = Number(editing[1]);
    const z = Number(editing[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      error = 'must be finite numbers';
      return;
    }
    error = null;
    onCommit([x, y, z]);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  }
</script>

<label class="form-field vec-field" class:error={!!error} title={schema.doc}>
  <span>{schema.name}</span>
  <div class="vec-inputs">
    <input type="number" bind:value={editing[0]} onblur={commit} onkeydown={onKey} />
    <input type="number" bind:value={editing[1]} onblur={commit} onkeydown={onKey} />
    <input type="number" bind:value={editing[2]} onblur={commit} onkeydown={onKey} />
  </div>
  {#if error}<small class="field-error">{error}</small>{/if}
</label>
