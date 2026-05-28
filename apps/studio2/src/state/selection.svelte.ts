import { Selection } from '@yacad/selection';

/**
 * Svelte $state wrapper around a Selection instance. The class exposes
 * reactive `selectedId` that components can read directly; `select` / `clear`
 * proxy through to the underlying Selection (which fires its subscribers).
 *
 * One adapter per session lifetime; the App swaps it on doc change.
 */
export class SelectionState {
  readonly selection = new Selection();
  selectedId = $state<string | null>(null);

  constructor() {
    this.selection.subscribe((id) => {
      this.selectedId = id;
    });
  }

  select(id: string | null): void {
    this.selection.select(id);
  }

  clear(): void {
    this.selection.clear();
  }
}
