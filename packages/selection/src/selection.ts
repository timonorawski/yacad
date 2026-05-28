/**
 * Single-node selection state with subscribers. The studio v2 tree editor
 * and spec-3's WYSIWYG both consume this. Multi-select is a non-breaking
 * future extension via additive `selectedIds` + `selectAdd`/`selectRemove`.
 *
 * Subscriber dispatch is hardened in the same way as `@yacad/doc-store`'s
 * session: snapshot subscribers before iteration so unsubscribes/subscribes
 * during dispatch don't affect the current emit, and swallow + log throws
 * from one subscriber so they don't abort delivery to the rest.
 */
export class Selection {
  private current: string | null = null;
  private readonly subscribers = new Set<(id: string | null) => void>();

  /** Currently-selected node id, or null. */
  get selectedId(): string | null {
    return this.current;
  }

  /** Replace the current selection. Emits to subscribers iff changed. */
  select(id: string | null): void {
    if (id === this.current) return;
    this.current = id;
    this.emit(id);
  }

  /** Convenience for select(null). */
  clear(): void {
    this.select(null);
  }

  /** Returns true iff `id` is currently selected. */
  isSelected(id: string): boolean {
    return this.current === id;
  }

  /** Subscribe to selection changes; returns unsubscribe. */
  subscribe(cb: (selectedId: string | null) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private emit(id: string | null): void {
    // Snapshot subscribers so subscribe/unsubscribe during dispatch doesn't
    // affect the current emit (mirrors doc-store's hardening).
    for (const cb of [...this.subscribers]) {
      try {
        cb(id);
      } catch (err) {
        console.error('Selection subscriber threw:', err);
      }
    }
  }
}
