<script lang="ts">
  import { onMount } from 'svelte';
  import { meshToBinaryStl } from '@yacad/export-stl';
  import type { Mesh } from '@yacad/geometry';
  import { Viewport } from '@yacad/render';
  import { WorkerClient, type EvaluateOutcome } from '@yacad/worker';
  import wasmUrl from 'manifold-3d/manifold.wasm?url';
  import EvalWorker from './worker?worker';

  const DEFAULT_DOC = JSON.stringify(
    {
      type: 'difference',
      children: [
        { type: 'box', params: { size: [30, 30, 30], center: true } },
        { type: 'sphere', params: { radius: 19, segments: 48 } },
      ],
    },
    null,
    2,
  );

  let canvas: HTMLCanvasElement;
  let text = $state(DEFAULT_DOC);
  let status = $state<'idle' | 'evaluating' | 'error'>('idle');
  let error = $state('');
  let stats = $state<EvaluateOutcome['stats'] | null>(null);
  let perNode = $state<EvaluateOutcome['perNode']>([]);

  let client: WorkerClient;
  let viewport: Viewport;
  let lastMesh = $state<Mesh | undefined>(undefined);
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let evalSeq = 0;

  const hitRate = $derived(
    stats && stats.nodes > 0 ? Math.round((stats.hits / stats.nodes) * 100) : 0,
  );

  onMount(() => {
    const worker = new EvalWorker();
    client = new WorkerClient(worker, { wasmUrl });
    viewport = new Viewport(canvas);

    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      viewport.resize(rect.width, rect.height);
    });
    ro.observe(canvas);

    void evaluate();

    return () => {
      ro.disconnect();
      viewport.dispose();
      worker.terminate();
    };
  });

  function scheduleEvaluate(): void {
    clearTimeout(debounce);
    debounce = setTimeout(() => void evaluate(), 150);
  }

  async function evaluate(): Promise<void> {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      status = 'error';
      error = `Invalid JSON: ${(e as Error).message}`;
      return;
    }

    status = 'evaluating';
    error = '';
    const seq = ++evalSeq;
    try {
      const outcome = await client.evaluate(doc, 'final');
      if (seq !== evalSeq) return; // a newer edit superseded this one
      lastMesh = outcome.mesh;
      viewport.setMesh(outcome.mesh);
      stats = outcome.stats;
      perNode = outcome.perNode;
      status = 'idle';
    } catch (e) {
      if (seq !== evalSeq) return;
      status = 'error';
      error = (e as Error).message;
    }
  }

  function exportStl(): void {
    if (!lastMesh) return;
    const blob = new Blob([meshToBinaryStl(lastMesh)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'model.stl';
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="app">
  <header>
    <h1>yacad studio</h1>
    <span class="tagline">parametric DAG · content-addressed cache · Manifold kernel</span>
  </header>

  <div class="sidebar">
    <textarea bind:value={text} oninput={scheduleEvaluate} spellcheck="false"></textarea>

    <div class="panel">
      <div class="toolbar">
        <button onclick={exportStl} disabled={!lastMesh}>Export STL</button>
        <span class="status" class:error={status === 'error'}>
          {#if status === 'evaluating'}Evaluating…{:else if status === 'error'}{error}{:else}Ready{/if}
        </span>
      </div>

      {#if stats}
        <div class="stats">
          <span>nodes <b>{stats.nodes}</b></span>
          <span>hits <b>{stats.hits}</b></span>
          <span>misses <b>{stats.misses}</b></span>
          <span>hit-rate <b>{hitRate}%</b></span>
        </div>
        <ul class="nodes">
          {#each perNode as node (node.id)}
            <li>
              <span>{node.id}</span>
              <span class="tag" class:hit={node.hit} class:miss={!node.hit}>
                {node.hit ? 'cached' : 'computed'}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>

  <div class="viewport">
    <canvas bind:this={canvas}></canvas>
  </div>
</div>
