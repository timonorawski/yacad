<script lang="ts">
  import type { NodeDoc, ParamDoc } from '@yacad/dag';
  import type { LuaDefinition, LuaParamDecl, ValidationIssue } from '@yacad/lua';
  import { validateLuaSource, LuaValidationError } from '@yacad/lua';
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

  const validationIssues = $derived.by<readonly ValidationIssue[]>(() => {
    if (!definition) return [];
    try {
      validateLuaSource(definition);
      return [];
    } catch (e) {
      if (e instanceof LuaValidationError) return e.issues;
      throw e;
    }
  });

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
  {#if validationIssues.length > 0}
    <section class="validation-issues">
      <h4>{validationIssues.length} validation issue{validationIssues.length === 1 ? '' : 's'}</h4>
      <ul>
        {#each validationIssues as issue (issue.line + ':' + issue.column + ':' + issue.category)}
          <li class="issue issue-{issue.category}">
            <code>line {issue.line}:{issue.column}</code>
            <span class="category">{issue.category}</span>
            <span class="message">{issue.message}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
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

<style>
  .validation-issues {
    background: color-mix(in srgb, var(--error) 12%, var(--panel));
    border: 1px solid color-mix(in srgb, var(--error) 40%, var(--panel));
    border-radius: 4px;
    padding: 0.5em 0.75em;
    margin: 0.5em 0;
    font-size: 0.9em;
  }
  .validation-issues h4 {
    margin: 0 0 0.5em;
    color: var(--error);
  }
  .validation-issues ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .validation-issues li {
    display: flex;
    gap: 0.5em;
    padding: 0.15em 0;
  }
  .validation-issues code {
    color: var(--fg);
    opacity: 0.7;
  }
  .validation-issues .category {
    color: var(--error);
    font-weight: 600;
  }
  .validation-issues .message {
    color: var(--fg);
  }
</style>
