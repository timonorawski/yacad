<script lang="ts">
  import type { Viewport, DisplayMode, ProjectionView } from '@yacad/render';

  interface Props {
    viewport: Viewport;
  }

  let { viewport }: Props = $props();

  let displayMode = $state<DisplayMode>('solid');
  let isOrtho = $state(false);

  function cycleDisplayMode() {
    const modes: DisplayMode[] = ['solid', 'wireframe', 'solid+edges'];
    const idx = modes.indexOf(displayMode);
    displayMode = modes[(idx + 1) % modes.length]!;
    viewport.setDisplayMode(displayMode);
  }

  function setProjection(view: ProjectionView) {
    viewport.setCameraProjection(view);
    isOrtho = viewport.isOrthographic();
  }

  function switchToPerspective() {
    viewport.switchToPerspective();
    isOrtho = false;
  }

  const displayLabel: Record<DisplayMode, string> = {
    solid: 'Solid',
    wireframe: 'Wire',
    'solid+edges': 'Edges',
  };
</script>

<div class="vp-toolbar">
  <div class="vp-toolbar-group">
    <button
      class="vp-tb-btn"
      title="Cycle display mode: Solid / Wireframe / Solid+Edges"
      onclick={cycleDisplayMode}>{displayLabel[displayMode]}</button
    >
  </div>

  <div class="vp-toolbar-sep"></div>

  <div class="vp-toolbar-group">
    <button class="vp-tb-btn" title="Front view" onclick={() => setProjection('front')}>F</button>
    <button class="vp-tb-btn" title="Back view" onclick={() => setProjection('back')}>Bk</button>
    <button class="vp-tb-btn" title="Left view" onclick={() => setProjection('left')}>L</button>
    <button class="vp-tb-btn" title="Right view" onclick={() => setProjection('right')}>R</button>
    <button class="vp-tb-btn" title="Top view" onclick={() => setProjection('top')}>T</button>
    <button class="vp-tb-btn" title="Bottom view" onclick={() => setProjection('bottom')}>Bt</button
    >
    <button class="vp-tb-btn" title="Isometric view" onclick={() => setProjection('isometric')}
      >Iso</button
    >
    {#if isOrtho}
      <button
        class="vp-tb-btn vp-tb-active"
        title="Switch to perspective"
        onclick={switchToPerspective}>P</button
      >
    {/if}
  </div>

  <div class="vp-toolbar-sep"></div>

  <div class="vp-toolbar-group">
    <button class="vp-tb-btn" title="Zoom to fit" onclick={() => viewport.zoomToExtents()}
      >Fit</button
    >
    <button class="vp-tb-btn" title="Zoom in" onclick={() => viewport.zoomIn()}>+</button>
    <button class="vp-tb-btn" title="Zoom out" onclick={() => viewport.zoomOut()}>-</button>
  </div>
</div>
