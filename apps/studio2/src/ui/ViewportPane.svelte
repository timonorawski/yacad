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
    focusedHash?: string | null;
    onUnfocus?: () => void;
  }

  let {
    session,
    client,
    onEvaluated,
    selectedId = null,
    perNode,
    focusedHash = null,
    onUnfocus,
  }: Props = $props();

  let canvas: HTMLCanvasElement;
  let viewport = $state<Viewport | undefined>(undefined);
  let manifoldApi: Awaited<ReturnType<typeof loadManifold>> | undefined;
  let status = $state<'idle' | 'evaluating' | 'error'>('idle');
  let error = $state('');
  let stats = $state<EvaluateOutcome['stats'] | null>(null);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let evalSeq = 0;
  const STATUS_DEFER_MS = 50;
  const EVAL_DEBOUNCE_MS = 150;

  /** Show focused geometry when focusedHash changes. */
  let prevFocusedHash: string | null = null;
  $effect(() => {
    const hash = focusedHash;
    if (hash === prevFocusedHash) return;
    prevFocusedHash = hash;
    if (!hash) {
      // Exited focus mode — re-evaluate full document.
      scheduleEvaluate();
      return;
    }
    // Entered focus mode — fetch and display single-node geometry.
    void (async () => {
      if (!viewport) return;
      const geometry = await client.getGeometry(hash);
      if (!geometry || focusedHash !== hash) return;
      if (geometry.kind === '2d') {
        manifoldApi ??= await loadManifold({ locateFile: () => wasmUrl });
        viewport.setGeometry(geometry, manifoldApi);
      } else {
        viewport.setMesh(geometry.mesh);
      }
    })();
  });

  async function evaluate() {
    if (!viewport) return;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status = 'evaluating';
    }, STATUS_DEFER_MS);
    const seq = ++evalSeq;
    try {
      const outcome = await client.evaluate($state.snapshot(session.doc), 'final');
      if (seq !== evalSeq) return;
      clearTimeout(statusTimer);
      if (!focusedHash) {
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
      if (focusedHash) {
        onUnfocus?.();
      }
    }
    if (e.key === 'Escape' && focusedHash) {
      onUnfocus?.();
    }
  }

  onMount(() => {
    viewport = new Viewport(canvas);
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      viewport?.resize(rect.width, rect.height);
    });
    ro.observe(canvas);
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
</script>

<canvas bind:this={canvas} class="viewport-canvas"></canvas>
{#if viewport}
  <ViewportToolbar {viewport} />
{/if}
{#if focusedHash}
  <button
    class="focus-close-btn"
    title="Exit focused view (Esc)"
    onclick={() => onUnfocus?.()}
    aria-label="Exit focused view">&times;</button
  >
{/if}
<div class="viewport-footer">
  <span class="status" data-status={status}>{status}</span>
  {#if stats}
    <span>nodes: {stats.nodes}, hits: {stats.hits}, misses: {stats.misses}</span>
  {/if}
  {#if error}<span class="field-error">{error}</span>{/if}
</div>
