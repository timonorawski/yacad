<script lang="ts">
  interface Props {
    docs: { id: string; name: string }[];
    currentId: string | null;
    openDoc: (id: string) => Promise<void>;
    createDoc: () => Promise<void>;
  }

  let { docs, currentId, openDoc, createDoc }: Props = $props();

  function onSelect(e: Event) {
    const id = (e.currentTarget as HTMLSelectElement).value;
    if (id === '__new__') {
      void createDoc();
    } else if (id !== currentId) {
      void openDoc(id);
    }
  }
</script>

<label>
  Document
  <select value={currentId ?? ''} onchange={onSelect}>
    {#each docs as d (d.id)}
      <option value={d.id}>{d.name}</option>
    {/each}
    <option value="__new__">＋ new document</option>
  </select>
</label>
