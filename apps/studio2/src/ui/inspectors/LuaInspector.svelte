<script lang="ts">
  import type { NodeDoc, ParamDoc } from '@yacad/dag';
  import type { LuaDefinition, LuaParamDecl } from '@yacad/lua';
  import NumberField from '../forms/NumberField.svelte';
  import IntField from '../forms/IntField.svelte';
  import BoolField from '../forms/BoolField.svelte';
  import StringField from '../forms/StringField.svelte';
  import Vec3Field from '../forms/Vec3Field.svelte';

  interface Props {
    node: NodeDoc;
    definitionResolver: (hash: string) => unknown;
    onCommitValue: (paramName: string, value: unknown) => void;
  }

  let { node, definitionResolver, onCommitValue }: Props = $props();

  const definitionHash = $derived((node.params ?? {})['definitionHash'] as string | undefined);
  const definition = $derived.by(() => {
    if (!definitionHash) return undefined;
    const raw = definitionResolver(definitionHash);
    return raw as LuaDefinition | undefined;
  });
  const values = $derived(((node.params ?? {})['values'] ?? {}) as Record<string, unknown>);

  function commit(paramName: string, value: unknown) {
    const nextValues = { ...values, [paramName]: value };
    onCommitValue('values', nextValues);
  }

  function paramsEntries(def: LuaDefinition): [string, LuaParamDecl][] {
    return Object.entries(def.schema.params);
  }

  function toParamDoc(name: string, decl: LuaParamDecl): ParamDoc {
    return {
      name,
      type: decl.type,
      required: decl.default === undefined,
      doc: '',
      ...(decl.default !== undefined ? { default: decl.default } : {}),
      ...(decl.min !== undefined ? { min: decl.min } : {}),
      ...(decl.max !== undefined ? { max: decl.max } : {}),
    };
  }
</script>

{#if definition}
  <h3>lua</h3>
  <p class="summary">definitionHash: <code>{definitionHash}</code></p>
  {#each paramsEntries(definition) as [name, decl] (name)}
    {@const schema = toParamDoc(name, decl)}
    {@const value = values[name] ?? decl.default}
    {#if decl.type === 'number'}
      <NumberField {schema} value={value as number | undefined} onCommit={(v) => commit(name, v)} />
    {:else if decl.type === 'int'}
      <IntField {schema} value={value as number | undefined} onCommit={(v) => commit(name, v)} />
    {:else if decl.type === 'boolean'}
      <BoolField {schema} value={value as boolean | undefined} onCommit={(v) => commit(name, v)} />
    {:else if decl.type === 'string'}
      <StringField {schema} value={value as string | undefined} onCommit={(v) => commit(name, v)} />
    {:else if decl.type === 'vec3'}
      <Vec3Field
        {schema}
        value={value as [number, number, number] | undefined}
        onCommit={(v) => commit(name, v)}
      />
    {/if}
  {/each}
{:else if definitionHash}
  <p><em>LuaDefinition <code>{definitionHash.slice(0, 8)}…</code> not loaded</em></p>
{:else}
  <p><em>no definitionHash on this node</em></p>
{/if}
