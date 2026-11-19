import { describe, expect, it, vi } from "vitest";

// Vite bundles the worker; the test only checks that Monaco is pointed at it.
vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({
  default: class FakeEditorWorker {
    readonly kind = "bundled-editor-worker";
  },
}));

describe("monacoConfig worker environment", () => {
  it("starts Monaco's bundled editor worker instead of a worker URL", async () => {
    const { monacoEnvironment, installMonacoEnvironment } = await import("./monacoWorker");

    installMonacoEnvironment();
    expect(window.MonacoEnvironment).toBe(monacoEnvironment);
    // A getWorkerUrl pointing at a file the build never emitted made the
    // worker load index.html and Monaco throw an uncaught error event.
    expect(monacoEnvironment.getWorkerUrl).toBeUndefined();
    const worker = monacoEnvironment.getWorker?.("workerMain.js", "editorWorkerService");
    expect(worker).toMatchObject({ kind: "bundled-editor-worker" });
  });
});
