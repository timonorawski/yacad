<script lang="ts">
  import { onMount } from 'svelte';
  import type { WorkerClient, EvaluateOutcome } from '@yacad/worker';
  import { Viewport } from '@yacad/render';
  import { loadManifold } from '@yacad/kernel-manifold';
  import wasmUrl from 'manifold-3d/manifold.wasm?url';
  import type { SessionState } from '../state/session.svelte';

  interface Props {
    session: SessionState;
    client: WorkerClient;
  }

  let { session, client }: Props = $props();

  let canvas: HTMLCanvasElement;
  let viewport: Viewport | undefined;
  let manifoldApi: Awaited<ReturnType<typeof loadManifold>> | undefined;
  let status = $state<'idle' | 'evaluating' | 'error'>('idle');
  let error = $state('');
  let stats = $state<EvaluateOutcome['stats'] | null>(null);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let evalSeq = 0;
  const STATUS_DEFER_MS = 50;
  const EVAL_DEBOUNCE_MS = 150;

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
      if (outcome.geometry.kind === '2d') {
        manifoldApi ??= await loadManifold({ locateFile: () => wasmUrl });
        viewport.setGeometry(outcome.geometry, manifoldApi);
      } else {
        viewport.setMesh(outcome.geometry.mesh);
      }
      stats = outcome.stats;
      error = '';
      status = 'idle';
    } catch (e) {
      if (seq !== evalSeq) return;
      clearTimeout(statusTimer);
      status = 'error';
      error = (e as Error).message;
    }
  }

  function scheduleEvaluate() {
    clearTimeout(debounce);
    debounce = setTimeout(() => void evaluate(), EVAL_DEBOUNCE_MS);
  }

  onMount(() => {
    viewport = new Viewport(canvas);
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      viewport?.resize(rect.width, rect.height);
    });
    ro.observe(canvas);
    void evaluate();

    return () => {
      ro.disconnect();
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
<div class="viewport-footer">
  <span class="status" data-status={status}>{status}</span>
  {#if stats}
    <span>nodes: {stats.nodes}, hits: {stats.hits}, misses: {stats.misses}</span>
  {/if}
  {#if error}<span class="field-error">{error}</span>{/if}
</div>
