<script lang="ts">
  import type { EvaluateOutcome } from '@yacad/worker';

  interface Props {
    outcome: EvaluateOutcome | undefined;
  }

  let { outcome }: Props = $props();

  const stats = $derived(outcome?.stats);
  const perf = $derived(outcome?.perf);
  const perNode = $derived(outcome?.perNode ?? []);
  const hitRate = $derived(
    stats && stats.nodes > 0 ? Math.round((stats.hits / stats.nodes) * 100) : 0,
  );
  const expensiveNodes = $derived([...perNode].sort((a, b) => b.totalMs - a.totalMs));
</script>

<details class="perf-panel" open>
  <summary>Performance</summary>
  {#if !stats}
    <p class="perf-empty">Evaluate to populate.</p>
  {:else}
    <div class="perf-summary">
      <span>nodes <b>{stats.nodes}</b></span>
      <span>hits <b>{stats.hits}</b></span>
      <span>misses <b>{stats.misses}</b></span>
      <span>hit-rate <b>{hitRate}%</b></span>
      <span>total <b>{stats.totalMs.toFixed(2)} ms</b></span>
    </div>
    {#if perf}
      <div class="perf-transport">
        <span>transport in <b>{perf.transportInMs.toFixed(2)} ms</b></span>
        <span>worker total <b>{perf.workerTotalMs.toFixed(2)} ms</b></span>
        <span>transport out <b>{perf.transportOutMs.toFixed(2)} ms</b></span>
        <span>buildGraph <b>{perf.buildGraphMs.toFixed(2)} ms</b></span>
        <span>engine <b>{perf.engineMs.toFixed(2)} ms</b></span>
        <span>copy mesh <b>{perf.copyMeshMs.toFixed(2)} ms</b></span>
      </div>
    {/if}
    <div class="perf-node-table-wrap">
      <table class="perf-node-table">
        <thead>
          <tr>
            <th>node</th>
            <th>cache</th>
            <th>total ms</th>
            <th>import</th>
            <th>op</th>
            <th>export</th>
          </tr>
        </thead>
        <tbody>
          {#each expensiveNodes as n (n.id)}
            <tr>
              <td>{n.id}</td>
              <td>
                <span class="perf-cache-tag" class:hit={n.hit}>
                  {n.hit ? 'cached' : 'computed'}
                </span>
              </td>
              <td>{n.totalMs.toFixed(2)}</td>
              <td>{n.importMs.toFixed(2)}</td>
              <td>{n.opMs.toFixed(2)}</td>
              <td>{n.exportMs.toFixed(2)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</details>
