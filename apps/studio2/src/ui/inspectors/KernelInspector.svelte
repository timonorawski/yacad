<script lang="ts">
  import type { NodeDoc } from '@yacad/dag';
  import { getKernelTypeDoc, type ParamDoc } from '@yacad/dag';
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
    onCommitMany: (patch: Record<string, unknown>) => void;
  }

  let { node, onCommit, onCommitMany }: Props = $props();
  const doc = $derived(getKernelTypeDoc(node.type));

  type Entry =
    | { kind: 'single'; schema: ParamDoc }
    | { kind: 'group'; group: string; members: readonly ParamDoc[] };

  // Linearise the schema into "entries": single params keep their position;
  // mutually-exclusive groups collapse to one entry rendered at the slot of
  // their first member, preserving overall ordering.
  const entries = $derived.by<readonly Entry[]>(() => {
    if (!doc) return [];
    const out: Entry[] = [];
    const seenGroups = new Set<string>();
    for (const schema of doc.paramSchema) {
      if (schema.exclusiveGroup) {
        if (seenGroups.has(schema.exclusiveGroup)) continue;
        seenGroups.add(schema.exclusiveGroup);
        const members = doc.paramSchema.filter((p) => p.exclusiveGroup === schema.exclusiveGroup);
        out.push({ kind: 'group', group: schema.exclusiveGroup, members });
      } else {
        out.push({ kind: 'single', schema });
      }
    }
    return out;
  });

  /** Active member of an exclusive group: the one currently set on the node.
   *  When none are set, fall back to the first member that has a default,
   *  otherwise the first member. */
  function activeMember(members: readonly ParamDoc[]): ParamDoc {
    const params = node.params ?? {};
    const set = members.find((m) => params[m.name] !== undefined);
    if (set) return set;
    const withDefault = members.find((m) => m.default !== undefined);
    return withDefault ?? members[0]!;
  }

  function selectGroupMember(members: readonly ParamDoc[], nextName: string) {
    const patch: Record<string, unknown> = {};
    for (const m of members) {
      if (m.name === nextName) {
        // Seed the newly-active param with its default if it isn't already
        // populated; the doc validator requires exactly one to be present.
        if ((node.params ?? {})[m.name] === undefined) {
          patch[m.name] = m.default;
        }
      } else if ((node.params ?? {})[m.name] !== undefined) {
        patch[m.name] = undefined;
      }
    }
    if (Object.keys(patch).length > 0) onCommitMany(patch);
  }
</script>

{#snippet field(schema: ParamDoc)}
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
{/snippet}

{#if doc}
  <h3>{node.type}</h3>
  <p class="summary">{doc.summary}</p>
  {#each entries as entry (entry.kind === 'group' ? entry.group : entry.schema.name)}
    {#if entry.kind === 'single'}
      {@render field(entry.schema)}
    {:else}
      {@const active = activeMember(entry.members)}
      <fieldset class="exclusive-group">
        <legend>
          {#each entry.members as m (m.name)}
            <label class="exclusive-radio">
              <input
                type="radio"
                name={`${node.type}-${entry.group}`}
                value={m.name}
                checked={m.name === active.name}
                onchange={() => selectGroupMember(entry.members, m.name)}
              />
              {m.name}
            </label>
          {/each}
        </legend>
        {@render field(active)}
      </fieldset>
    {/if}
  {/each}
{:else}
  <p><em>no kernel schema for "{node.type}"</em></p>
{/if}
