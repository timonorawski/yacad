<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { canonicalBytes } from '@yacad/canonical';
  import { defaultHasher } from '@yacad/hash';
  import type { LuaDefinition } from '@yacad/lua';
  import { ensureMonacoEnvironment } from '../lua-editor-setup';

  interface Props {
    definition: LuaDefinition;
    onClose: () => void;
    /** Called with the new hash + canonical bytes after a save. */
    onSave: (newHash: string, newBytes: Uint8Array, newDef: LuaDefinition) => Promise<void>;
    onOpenApiRef: () => void;
  }

  let { definition, onClose, onSave, onOpenApiRef }: Props = $props();

  let container: HTMLDivElement | undefined = $state();
  let editor: ReturnType<typeof import('monaco-editor').editor.create> | undefined;
  let codeBuffer = $state(definition.code);
  let dirty = $state(false);
  let saving = $state(false);

  onMount(() => {
    if (!container) return;
    const monaco = ensureMonacoEnvironment();
    editor = monaco.editor.create(container, {
      value: definition.code,
      language: 'lua',
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
    });
    editor.onDidChangeModelContent(() => {
      const next = editor!.getValue();
      codeBuffer = next;
      dirty = next !== definition.code;
    });
  });

  onDestroy(() => {
    editor?.dispose();
    editor = undefined;
  });

  async function save() {
    if (!dirty || saving) return;
    const nextDef: LuaDefinition = { schema: definition.schema, code: codeBuffer };
    const bytes = canonicalBytes(nextDef);
    const hash = await defaultHasher.hash(bytes);
    saving = true;
    try {
      await onSave(hash, bytes, nextDef);
      dirty = false;
    } finally {
      saving = false;
    }
  }

  function revert() {
    if (!editor) return;
    editor.setValue(definition.code);
    codeBuffer = definition.code;
    dirty = false;
  }
</script>

<aside class="lua-editor open">
  <header class="lua-editor-header">
    <div class="lua-editor-title">
      Lua code
      {#if dirty}<span class="lua-editor-dirty">●</span>{/if}
    </div>
    <div class="lua-editor-actions">
      <button type="button" onclick={onOpenApiRef}>API reference</button>
      <button type="button" disabled={!dirty || saving} onclick={revert}>Revert</button>
      <button type="button" class="primary" disabled={!dirty || saving} onclick={() => void save()}
        >{saving ? 'Saving…' : 'Save'}</button
      >
      <button type="button" class="lua-editor-close" onclick={onClose} aria-label="Close editor"
        >×</button
      >
    </div>
  </header>
  <div class="lua-editor-body" bind:this={container}></div>
</aside>
