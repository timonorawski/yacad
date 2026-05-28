<script lang="ts">
  import type { NodeDoc } from '@yacad/dag';
  import { getKernelTypeDoc } from '@yacad/dag';
  import NumberField from '../forms/NumberField.svelte';
  import IntField from '../forms/IntField.svelte';
  import BoolField from '../forms/BoolField.svelte';
  import StringField from '../forms/StringField.svelte';
  import EnumField from '../forms/EnumField.svelte';
  import Vec2Field from '../forms/Vec2Field.svelte';
  import Vec2ArrayField from '../forms/Vec2ArrayField.svelte';
  import Vec3Field from '../forms/Vec3Field.svelte';

  interface Props {
    node: NodeDoc;
    onCommit: (paramName: string, value: unknown) => void;
  }

  let { node, onCommit }: Props = $props();
  const doc = $derived(getKernelTypeDoc(node.type));
</script>

{#if doc}
  <h3>{node.type}</h3>
  <p class="summary">{doc.summary}</p>
  {#each doc.paramSchema as schema (schema.name)}
    {@const value = (node.params ?? {})[schema.name]}
    {#if schema.enum}
      <EnumField
        {schema}
        value={value as string | undefined}
        onCommit={(v) => onCommit(schema.name, v)}
      />
    {:else if schema.type === 'number'}
      <NumberField
        {schema}
        value={value as number | undefined}
        onCommit={(v) => onCommit(schema.name, v)}
      />
    {:else if schema.type === 'int'}
      <IntField
        {schema}
        value={value as number | undefined}
        onCommit={(v) => onCommit(schema.name, v)}
      />
    {:else if schema.type === 'boolean'}
      <BoolField
        {schema}
        value={value as boolean | undefined}
        onCommit={(v) => onCommit(schema.name, v)}
      />
    {:else if schema.type === 'string'}
      <StringField
        {schema}
        value={value as string | undefined}
        onCommit={(v) => onCommit(schema.name, v)}
      />
    {:else if schema.type === 'vec2-array'}
      <Vec2ArrayField
        {schema}
        value={value as [number, number][] | undefined}
        onCommit={(v) => onCommit(schema.name, v)}
      />
    {:else if schema.type === 'vec2'}
      <Vec2Field
        {schema}
        value={value as [number, number] | undefined}
        onCommit={(v) => onCommit(schema.name, v)}
      />
    {:else if schema.type === 'vec3'}
      <Vec3Field
        {schema}
        value={value as [number, number, number] | undefined}
        onCommit={(v) => onCommit(schema.name, v)}
      />
    {/if}
  {/each}
{:else}
  <p><em>no kernel schema for "{node.type}"</em></p>
{/if}
