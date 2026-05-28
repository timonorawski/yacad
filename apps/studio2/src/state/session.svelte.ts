import type { NodeDoc } from '@yacad/dag';
import type { DocSession } from '@yacad/doc-store';

/**
 * Svelte $state wrapper around a DocSession. Subscribes to `doc-changed`,
 * `meta-changed`, `persisted`, and `invalidated` events and re-derives the
 * reactive properties so Svelte templates can read them.
 *
 * The wrapper is constructed once per opened session — when the App switches
 * docs, it disposes the old SessionState (calls unsubscribe) and creates a
 * fresh one for the new session.
 */
export class SessionState {
  doc = $state<NodeDoc>(null!);
  name = $state('');
  isDirty = $state(false);
  canUndo = $state(false);
  canRedo = $state(false);
  invalidationError = $state<Error | undefined>(undefined);

  private readonly unsubscribe: () => void;

  constructor(readonly session: DocSession) {
    this.doc = session.doc;
    this.name = session.meta.name;
    this.isDirty = session.isDirty;
    this.canUndo = session.canUndo;
    this.canRedo = session.canRedo;
    this.invalidationError = session.invalidationError;

    this.unsubscribe = session.subscribe((evt) => {
      if (evt.kind === 'doc-changed') {
        this.doc = session.doc;
        this.isDirty = session.isDirty;
        this.canUndo = session.canUndo;
        this.canRedo = session.canRedo;
      } else if (evt.kind === 'meta-changed') {
        this.name = session.meta.name;
        this.isDirty = session.isDirty;
      } else if (evt.kind === 'persisted') {
        this.isDirty = session.isDirty;
      } else if (evt.kind === 'invalidated') {
        this.invalidationError = evt.error;
      }
    });
  }

  dispose(): void {
    this.unsubscribe();
  }
}
