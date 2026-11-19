import type * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

/**
 * Monaco's editor web worker, bundled by Vite (`?worker`). Only the generic
 * editor worker is needed: the SQL language runs in the main thread.
 *
 * This used to be a `getWorkerUrl` for `/worker/monaco-editor-worker.js`, a
 * file the build never emitted. The server answered with index.html, the
 * worker failed to start, Monaco threw an uncaught error event every time an
 * editor opened, and ran the worker's code in the main thread instead.
 */
export const monacoEnvironment: monaco.Environment = {
  getWorker(): Worker {
    return new EditorWorker();
  },
};

/** Points Monaco at the bundled worker; call before creating an editor. */
export function installMonacoEnvironment(): void {
  window.MonacoEnvironment = monacoEnvironment;
}
