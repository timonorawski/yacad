<script lang="ts">
  interface Props {
    userDocs: { id: string; name: string }[];
    sampleDocs: { id: string; name: string }[];
    currentId: string | null;
    openDoc: (id: string, source: 'user' | 'sample') => Promise<void>;
    createDoc: () => Promise<void>;
    refreshSamples: () => Promise<void>;
  }

  let { userDocs, sampleDocs, currentId, openDoc, createDoc, refreshSamples }: Props = $props();

  function onSelect(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    if (value === '__new__') {
      void createDoc();
      return;
    }
    // Encoded as `${source}:${id}` so we can dispatch to the right library.
    const colonIdx = value.indexOf(':');
    if (colonIdx === -1) return;
    const source = value.slice(0, colonIdx);
    const id = value.slice(colonIdx + 1);
    if ((source === 'sample' || source === 'user') && id && id !== currentId) {
      void openDoc(id, source);
    }
  }
</script>

<div class="doc-picker">
  <label>
    Document
    <select value={currentId ? `user:${currentId}` : ''} onchange={onSelect}>
      {#if sampleDocs.length > 0}
        <optgroup label="Samples">
          {#each sampleDocs as d (d.id)}
            <option value={`sample:${d.id}`}>{d.name}</option>
          {/each}
        </optgroup>
      {/if}
      {#if userDocs.length > 0}
        <optgroup label="Your documents">
          {#each userDocs as d (d.id)}
            <option value={`user:${d.id}`}>{d.name}</option>
          {/each}
        </optgroup>
      {/if}
      <option value="__new__">＋ new document</option>
    </select>
  </label>
  <button type="button" onclick={() => void refreshSamples()} title="Wipe and re-seed all samples">
    Refresh samples
  </button>
</div>
