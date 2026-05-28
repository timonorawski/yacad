import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

let registered = false;

/** Configure monaco's worker bootstrap. Idempotent. */
export function ensureMonacoEnvironment(): typeof monaco {
  if (!registered) {
    (self as unknown as Record<string, unknown>).MonacoEnvironment = {
      getWorker: () => new EditorWorker(),
    };
    registered = true;
  }
  return monaco;
}
