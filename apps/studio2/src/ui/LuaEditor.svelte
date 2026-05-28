<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { canonicalBytes } from '@yacad/canonical';
  import { defaultHasher } from '@yacad/hash';
  import { validateLuaSource, LuaValidationError, type LuaDefinition } from '@yacad/lua';
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

  interface ValidationStatus {
    ok: boolean;
    count: number; // issue count; 0 when ok
    ms: number; // last-run wall-clock duration
  }
  let validation = $state<ValidationStatus>({ ok: true, count: 0, ms: 0 });
  let validateTimer: ReturnType<typeof setTimeout> | undefined;
  const VALIDATE_DEBOUNCE_MS = 150;

  function runValidation() {
    const t0 = performance.now();
    let count = 0;
    let ok = true;
    try {
      validateLuaSource({ schema: definition.schema, code: codeBuffer });
    } catch (e) {
      if (e instanceof LuaValidationError) {
        ok = false;
        count = e.issues.length;
      } else {
        throw e; // non-validation errors propagate rather than masking as "valid"
      }
    }
    validation = { ok, count, ms: performance.now() - t0 };
  }

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
      clearTimeout(validateTimer);
      validateTimer = setTimeout(runValidation, VALIDATE_DEBOUNCE_MS);
    });
    runValidation(); // eager: reflect the loaded definition, not the default state
  });

  onDestroy(() => {
    clearTimeout(validateTimer);
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
      <span
        class="lua-validation-status"
        class:ok={validation.ok}
        class:invalid={!validation.ok}
        title={validation.ok
          ? `Lua validated in ${validation.ms.toFixed(1)}ms`
          : `${validation.count} validation issue${validation.count === 1 ? '' : 's'} (${validation.ms.toFixed(1)}ms)`}
      >
        {#if validation.ok}
          ✓ validated
        {:else}
          {validation.count} issue{validation.count === 1 ? '' : 's'}
        {/if}
        <span class="lua-validation-ms">{validation.ms.toFixed(1)}ms</span>
      </span>
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
