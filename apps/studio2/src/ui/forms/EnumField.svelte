<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: string | undefined;
    onCommit: (value: string) => void;
  }

  let { schema, value, onCommit }: Props = $props();
  const options = $derived(schema.enum ?? []);
</script>

<label class="form-field" title={schema.doc}>
  <span>{schema.name}</span>
  <select
    value={value ?? ''}
    onchange={(e) => onCommit((e.currentTarget as HTMLSelectElement).value)}
  >
    {#each options as opt (opt)}
      <option value={opt}>{opt}</option>
    {/each}
  </select>
</label>
