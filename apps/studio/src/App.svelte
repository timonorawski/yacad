<script lang="ts">
  import { onMount } from 'svelte';
  import { marked } from 'marked';
  import { meshToBinaryStl } from '@yacad/export-stl';
  import type { Mesh } from '@yacad/geometry';
  import { Viewport } from '@yacad/render';
  import { WorkerClient, type EvaluateOutcome } from '@yacad/worker';
  import wasmUrl from 'manifold-3d/manifold.wasm?url';
  import sceneBox from '../../../packages/e2e/scenes/primitives/box.json?raw';
  import sceneSphere from '../../../packages/e2e/scenes/primitives/sphere.json?raw';
  import sceneCylinder from '../../../packages/e2e/scenes/primitives/cylinder.json?raw';
  import sceneTranslatedBox from '../../../packages/e2e/scenes/transforms/translated-box.json?raw';
  import sceneRotatedCylinder from '../../../packages/e2e/scenes/transforms/rotated-cylinder.json?raw';
  import sceneUnionStack from '../../../packages/e2e/scenes/booleans/union-stack.json?raw';
  import sceneBoxMinusSphere from '../../../packages/e2e/scenes/booleans/box-minus-sphere.json?raw';
  import sceneCoredBlock from '../../../packages/e2e/scenes/composite/cored-block.json?raw';
  import languageReferenceMd from '../../../docs/language-reference.md?raw';
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
  let perf = $state<EvaluateOutcome['perf'] | null>(null);
  let perNode = $state<EvaluateOutcome['perNode']>([]);
  let roundTripMs = $state<number | null>(null);
  let docsOpen = $state(false);
  let selectedScene = $state('default');

  let client: WorkerClient;
  let viewport: Viewport;
  let lastMesh = $state<Mesh | undefined>(undefined);
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let evalSeq = 0;

  const sceneLibrary = [
    { id: 'default', label: 'Default: box - sphere', text: DEFAULT_DOC },
    { id: 'box', label: 'Primitive: box', text: sceneBox },
    { id: 'sphere', label: 'Primitive: sphere', text: sceneSphere },
    { id: 'cylinder', label: 'Primitive: cylinder', text: sceneCylinder },
    { id: 'translated-box', label: 'Transform: translated box', text: sceneTranslatedBox },
    { id: 'rotated-cylinder', label: 'Transform: rotated cylinder', text: sceneRotatedCylinder },
    { id: 'union-stack', label: 'Boolean: union stack', text: sceneUnionStack },
    { id: 'box-minus-sphere', label: 'Boolean: box minus sphere', text: sceneBoxMinusSphere },
    { id: 'cored-block', label: 'Composite: cored block', text: sceneCoredBlock },
  ] as const;

  const languageReferenceHtml = marked.parse(languageReferenceMd) as string;

  const hitRate = $derived(
    stats && stats.nodes > 0 ? Math.round((stats.hits / stats.nodes) * 100) : 0,
  );

  const missRate = $derived(stats && stats.nodes > 0 ? Math.round((stats.misses / stats.nodes) * 100) : 0);

  const expensiveNodes = $derived([...perNode].sort((a, b) => b.totalMs - a.totalMs));

  const meshSummary = $derived(
    lastMesh
      ? {
          vertices: lastMesh.vertices.length / 3,
          triangles: lastMesh.indices.length / 3,
        }
      : null,
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

  function onEditorInput(): void {
    selectedScene = 'custom';
    scheduleEvaluate();
  }

  function formatJson(): void {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
      status = 'idle';
      error = '';
    } catch (e) {
      status = 'error';
      error = `Invalid JSON: ${(e as Error).message}`;
    }
  }

  function pickScene(id: string): void {
    const scene = sceneLibrary.find((entry) => entry.id === id);
    if (!scene) return;
    selectedScene = scene.id;
    text = JSON.stringify(JSON.parse(scene.text), null, 2);
    void evaluate();
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
    const requestStart = performance.now();
    try {
      const outcome = await client.evaluate(doc, 'final');
      if (seq !== evalSeq) return; // a newer edit superseded this one
      lastMesh = outcome.mesh;
      viewport.setMesh(outcome.mesh);
      stats = outcome.stats;
      perf = outcome.perf;
      perNode = outcome.perNode;
      roundTripMs = performance.now() - requestStart;
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
    <button class="ghost" onclick={() => (docsOpen = !docsOpen)}>
      {docsOpen ? 'Hide' : 'Show'} Language Reference
    </button>
  </header>

  <div class="sidebar">
    <div class="editor-controls">
      <label>
        <span>Sample scene</span>
        <select value={selectedScene} onchange={(event) => pickScene((event.currentTarget as HTMLSelectElement).value)}>
          <option value="custom">Custom (current editor)</option>
          {#each sceneLibrary as scene}
            <option value={scene.id}>{scene.label}</option>
          {/each}
        </select>
      </label>
      <button class="ghost" onclick={formatJson}>Format JSON</button>
    </div>

    <textarea bind:value={text} oninput={onEditorInput} spellcheck="false"></textarea>

    <div class="panel">
      <div class="toolbar">
        <button class="ghost" onclick={() => void evaluate()}>Evaluate</button>
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
          <span>miss-rate <b>{missRate}%</b></span>
        </div>

        {#if meshSummary}
          <div class="metrics-grid">
            <span>mesh vertices <b>{meshSummary.vertices}</b></span>
            <span>mesh triangles <b>{meshSummary.triangles}</b></span>
            <span>main round-trip <b>{roundTripMs ? roundTripMs.toFixed(2) : '-'} ms</b></span>
            <span>worker total <b>{perf ? perf.workerTotalMs.toFixed(2) : '-'} ms</b></span>
            <span>buildGraph <b>{perf ? perf.buildGraphMs.toFixed(2) : '-'} ms</b></span>
            <span>engine total <b>{perf ? perf.engineMs.toFixed(2) : '-'} ms</b></span>
            <span>engine lookup <b>{stats.lookupMs.toFixed(2)} ms</b></span>
            <span>engine kernel <b>{stats.kernelMs.toFixed(2)} ms</b></span>
            <span>engine cache write <b>{stats.storeMs.toFixed(2)} ms</b></span>
            <span>engine wall <b>{stats.totalMs.toFixed(2)} ms</b></span>
          </div>
        {/if}

        <div class="node-table-wrap">
          <table class="node-table">
            <thead>
              <tr>
                <th>node</th>
                <th>cache</th>
                <th>total ms</th>
                <th>self ms</th>
                <th>kernel ms</th>
              </tr>
            </thead>
            <tbody>
              {#each expensiveNodes as node (node.id)}
                <tr>
                  <td>{node.id}</td>
                  <td>
                    <span class="tag" class:hit={node.hit} class:miss={!node.hit}>
                      {node.hit ? 'cached' : 'computed'}
                    </span>
                  </td>
                  <td>{node.totalMs.toFixed(2)}</td>
                  <td>{node.selfMs.toFixed(2)}</td>
                  <td>{node.kernelMs.toFixed(2)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>

  <div class="viewport">
    <canvas bind:this={canvas}></canvas>
  </div>

  <aside class="docs" class:open={docsOpen}>
    <div class="docs-header">
      <h2>Language Reference</h2>
      <button class="ghost" onclick={() => (docsOpen = false)}>Close</button>
    </div>
    <div class="docs-content">{@html languageReferenceHtml}</div>
  </aside>
</div>
