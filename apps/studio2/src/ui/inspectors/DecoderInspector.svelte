<script lang="ts">
  import type { NodeDoc } from '@yacad/dag';
  import type { DocSession } from '@yacad/doc-store';
  import { hashStlBlob } from '@yacad/import-stl';
  import { hashObjBlob } from '@yacad/import-obj';
  import { hashGltfBlob } from '@yacad/import-gltf';

  interface Props {
    node: NodeDoc;
    session: DocSession;
    onCommitHash: (hash: string) => void;
  }

  let { node, session, onCommitHash }: Props = $props();

  const blobHash = $derived((node.params ?? {})['blobHash'] as string | undefined);
  const sizeBytes = $derived(blobHash ? (session.blobs.get(blobHash)?.length ?? 0) : 0);

  let fileInput: HTMLInputElement;

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash =
      node.type === 'import-stl'
        ? await hashStlBlob(bytes)
        : node.type === 'import-obj'
          ? await hashObjBlob(bytes)
          : await hashGltfBlob(bytes);
    await session.addBlob(bytes);
    onCommitHash(hash);
    input.value = '';
  }
</script>

<h3>{node.type}</h3>
<p class="summary">
  blob: <code>{blobHash ? blobHash.slice(0, 12) + '…' : '(none)'}</code>
  {#if sizeBytes}<small>({sizeBytes} bytes)</small>{/if}
</p>
<button onclick={() => fileInput.click()}>Replace…</button>
<input type="file" bind:this={fileInput} onchange={onFile} style="display: none" />
