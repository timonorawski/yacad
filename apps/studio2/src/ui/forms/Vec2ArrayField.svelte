<script lang="ts">
  import type { ParamDoc } from '@yacad/dag';

  interface Props {
    schema: ParamDoc;
    value: [number, number][] | undefined;
    onCommit: (value: [number, number][]) => void;
  }

  let { schema, value, onCommit }: Props = $props();

  /** Local in-flight string representation per cell so blur/Enter commit semantics
   *  match the other field components. */
  let editing = $state<[string, string][]>(toStrings(value ?? []));
  let error = $state<string | null>(null);

  $effect(() => {
    editing = toStrings(value ?? []);
    error = null;
  });

  function toStrings(pts: readonly [number, number][]): [string, string][] {
    return pts.map(([x, y]) => [String(x), String(y)] as [string, string]);
  }

  function commit() {
    const parsed: [number, number][] = [];
    for (const [sx, sy] of editing) {
      const x = Number(sx);
      const y = Number(sy);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        error = 'every component must be a finite number';
        return;
      }
      parsed.push([x, y]);
    }
    error = null;
    onCommit(parsed);
  }

  function addPoint() {
    // New point starts at (0, 0); user fills in. Commit only on blur of an input.
    editing = [...editing, ['0', '0']];
    commit();
  }

  function removeAt(idx: number) {
    editing = editing.filter((_, i) => i !== idx);
    commit();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  }
</script>

<label class="form-field vec-array-field" class:error={!!error} title={schema.doc}>
  <span>{schema.name}</span>
  <div class="vec-array-rows">
    {#each editing as row, i (i)}
      <div class="vec-array-row">
        <span class="vec-array-index">{i}</span>
        <input
          type="number"
          bind:value={row[0]}
          onblur={commit}
          onkeydown={onKey}
          aria-label={`point ${i} x`}
        />
        <input
          type="number"
          bind:value={row[1]}
          onblur={commit}
          onkeydown={onKey}
          aria-label={`point ${i} y`}
        />
        <button
          type="button"
          class="vec-array-remove"
          onclick={() => removeAt(i)}
          aria-label={`remove point ${i}`}>−</button
        >
      </div>
    {/each}
  </div>
  <button type="button" class="vec-array-add" onclick={addPoint}>+ point</button>
  {#if error}<small class="field-error">{error}</small>{/if}
</label>
