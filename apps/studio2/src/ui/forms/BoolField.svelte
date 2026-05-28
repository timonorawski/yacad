<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: boolean | undefined;
    onCommit: (value: boolean) => void;
  }

  let { schema, value, onCommit }: Props = $props();
</script>

<label class="form-field bool-field" title={schema.doc}>
  <input
    type="checkbox"
    checked={value ?? false}
    onchange={(e) => onCommit((e.currentTarget as HTMLInputElement).checked)}
  />
  <span>{schema.name}</span>
</label>
