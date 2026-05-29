<script lang="ts">
  import { onMount } from 'svelte';
  import type { WorkerClient, EvaluateOutcome } from '@yacad/worker';
  import type { NodeEval } from '@yacad/engine';
  import { Viewport } from '@yacad/render';
  import { loadManifold } from '@yacad/kernel-manifold';
  import wasmUrl from 'manifold-3d/manifold.wasm?url';
  import type { SessionState } from '../state/session.svelte';
  import ViewportToolbar from './ViewportToolbar.svelte';

  interface Props {
    session: SessionState;
    client: WorkerClient;
    onEvaluated?: (outcome: EvaluateOutcome | undefined) => void;
    selectedId?: string | null;
    perNode?: readonly NodeEval[] | undefined;
  }

  let { session, client, onEvaluated, selectedId = null, perNode }: Props = $props();

  let canvas: HTMLCanvasElement;
  let viewport = $state<Viewport | undefined>(undefined);
  let manifoldApi: Awaited<ReturnType<typeof loadManifold>> | undefined;
  let status = $state<'idle' | 'evaluating' | 'error'>('idle');
  let error = $state('');
  let stats = $state<EvaluateOutcome['stats'] | null>(null);

  // Focused node view state
  let focused = $state(false);
  let focusedHash = $state<string | null>(null);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let evalSeq = 0;
  const STATUS_DEFER_MS = 50;
  const EVAL_DEBOUNCE_MS = 150;

  /** Look up the semantic hash for the currently selected node from perNode results. */
  function hashForSelected(): string | null {
    if (!selectedId || !perNode) return null;
    const entry = perNode.find((n) => n.id === selectedId);
    return entry?.hash ?? null;
  }

  /** Toggle focused mode: show geometry for a single node via cache lookup. */
  async function toggleFocus() {
    if (focused) {
      // Exit focus — re-evaluate full document
      focused = false;
      focusedHash = null;
      scheduleEvaluate();
      return;
    }
    const hash = hashForSelected();
    if (!hash || !viewport) return;
    focused = true;
    focusedHash = hash;
    const geometry = await client.getGeometry(hash);
    if (!geometry || !focused) return;
    if (geometry.kind === '2d') {
      manifoldApi ??= await loadManifold({ locateFile: () => wasmUrl });
      viewport.setGeometry(geometry, manifoldApi);
    } else {
      viewport.setMesh(geometry.mesh);
    }
  }

  async function evaluate() {
    if (!viewport) return;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status = 'evaluating';
    }, STATUS_DEFER_MS);
    const seq = ++evalSeq;
    try {
      // $state.snapshot strips Svelte 5 proxy wrappers — postMessage requires
      // plain structured-cloneable objects.
      const outcome = await client.evaluate($state.snapshot(session.doc), 'final');
      if (seq !== evalSeq) return;
      clearTimeout(statusTimer);
      if (!focused) {
        if (outcome.geometry.kind === '2d') {
          manifoldApi ??= await loadManifold({ locateFile: () => wasmUrl });
          viewport.setGeometry(outcome.geometry, manifoldApi);
        } else {
          viewport.setMesh(outcome.geometry.mesh);
        }
      }
      stats = outcome.stats;
      error = '';
      status = 'idle';
      onEvaluated?.(outcome);
    } catch (e) {
      if (seq !== evalSeq) return;
      clearTimeout(statusTimer);
      status = 'error';
      error = (e as Error).message;
      onEvaluated?.(undefined);
    }
  }

  function scheduleEvaluate() {
    clearTimeout(debounce);
    debounce = setTimeout(() => void evaluate(), EVAL_DEBOUNCE_MS);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'f' || e.key === 'F') {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      void toggleFocus();
    }
  }

  onMount(() => {
    viewport = new Viewport(canvas);
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      viewport?.resize(rect.width, rect.height);
    });
    ro.observe(canvas);
    // Re-evaluate when the global cache is cleared, so the perf panel shows
    // every node as a miss (the demo's whole point).
    const onCacheCleared = () => scheduleEvaluate();
    window.addEventListener('yacad:cache-cleared', onCacheCleared);
    window.addEventListener('keydown', handleKeydown);
    void evaluate();

    return () => {
      ro.disconnect();
      window.removeEventListener('yacad:cache-cleared', onCacheCleared);
      window.removeEventListener('keydown', handleKeydown);
      viewport?.dispose();
      clearTimeout(debounce);
      clearTimeout(statusTimer);
    };
  });

  // Re-evaluate when the doc changes.
  $effect(() => {
    void session.doc;
    if (viewport) scheduleEvaluate();
  });

  // Exit focus mode when selection changes.
  $effect(() => {
    void selectedId;
    if (focused) {
      focused = false;
      focusedHash = null;
    }
  });
</script>

<canvas bind:this={canvas} class="viewport-canvas"></canvas>
{#if viewport}
  <ViewportToolbar {viewport} />
{/if}
<div class="viewport-footer">
  <span class="status" data-status={status}>{status}</span>
  {#if stats}
    <span>nodes: {stats.nodes}, hits: {stats.hits}, misses: {stats.misses}</span>
  {/if}
  {#if error}<span class="field-error">{error}</span>{/if}
  {#if selectedId && perNode}
    <button
      class="focus-toggle"
      class:active={focused}
      title={focused ? 'Exit focused view (F)' : 'Focus selected node (F)'}
      onclick={() => void toggleFocus()}>{focused ? 'Unfocus' : 'Focus'}</button
    >
  {/if}
  {#if focused && focusedHash}
    <span class="focused-label">focused: {focusedHash.slice(0, 8)}…</span>
  {/if}
</div>
