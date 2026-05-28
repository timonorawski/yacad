<script lang="ts">
  interface Props {
    docsOpen: boolean;
    onToggleDocs: () => void;
    onRefreshSamples: () => Promise<void>;
  }

  let { docsOpen, onToggleDocs, onRefreshSamples }: Props = $props();
  let menu: HTMLDetailsElement | undefined = $state();

  function close() {
    if (menu) menu.open = false;
  }
</script>

<details class="header-menu" bind:this={menu}>
  <summary aria-label="Global actions">≡</summary>
  <div class="header-menu-panel">
    <button
      type="button"
      onclick={() => {
        close();
        onToggleDocs();
      }}>{docsOpen ? 'Hide docs' : 'Show docs'}</button
    >
    <button
      type="button"
      onclick={() => {
        close();
        void onRefreshSamples();
      }}>Refresh samples</button
    >
  </div>
</details>
