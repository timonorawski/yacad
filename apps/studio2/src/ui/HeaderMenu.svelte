<script lang="ts">
  interface Props {
    docsOpen: boolean;
    onToggleDocs: () => void;
    onRefreshSamples: () => Promise<void>;
    onDownloadCurrent: () => Promise<void>;
    onDownloadAll: () => Promise<void>;
    onImport: () => Promise<void>;
  }

  let {
    docsOpen,
    onToggleDocs,
    onRefreshSamples,
    onDownloadCurrent,
    onDownloadAll,
    onImport,
  }: Props = $props();
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
        void onDownloadCurrent();
      }}>Download current document</button
    >
    <button
      type="button"
      onclick={() => {
        close();
        void onDownloadAll();
      }}>Download all documents</button
    >
    <button
      type="button"
      onclick={() => {
        close();
        void onImport();
      }}>Import document…</button
    >
    <button
      type="button"
      onclick={() => {
        close();
        void onRefreshSamples();
      }}>Refresh samples</button
    >
    <hr class="header-menu-sep" />
    <a
      class="header-menu-link"
      href="https://github.com/timonorawski/yacad"
      target="_blank"
      rel="noopener noreferrer"
      onclick={close}>GitHub repo ↗</a
    >
  </div>
</details>
