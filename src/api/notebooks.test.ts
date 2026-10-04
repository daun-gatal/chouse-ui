import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { addCell, deleteCell, ensureNotebook, exportNotebook, getNotebook, querySnapshot, rerunCell, type NotebookCell } from "./notebooks";

describe("notebooks API", () => {
  it("ensures, reads and edits a notebook", async () => {
    const seen: string[] = [];
    server.use(
      http.all("/api/notebooks/*", async ({ request }) => {
        const url = new URL(request.url);
        seen.push(`${request.method} ${url.pathname}`);
        return HttpResponse.json({ success: true, data: { notebook: { id: "n1" }, cells: [] } });
      }),
    );
    await ensureNotebook("incident_observe", "o1", "Investigation");
    await getNotebook("n1");
    await addCell("n1", { kind: "note", text: "hello" });
    await rerunCell("n1", "c1");
    await deleteCell("n1", "c1");
    expect(seen).toEqual([
      "POST /api/notebooks/ensure",
      "GET /api/notebooks/n1",
      "POST /api/notebooks/n1/cells",
      "POST /api/notebooks/n1/cells/c1/run",
      "DELETE /api/notebooks/n1/cells/c1",
    ]);
  });

  it("exports the postmortem as markdown", async () => {
    server.use(http.get("/api/notebooks/n1/export", () => new HttpResponse("# Postmortem", { headers: { "Content-Type": "text/markdown" } })));
    expect(await exportNotebook("n1")).toBe("# Postmortem");
  });

  it("fails the export on a non-2xx response", async () => {
    server.use(http.get("/api/notebooks/n1/export", () => new HttpResponse("nope", { status: 403 })));
    await expect(exportNotebook("n1")).rejects.toThrow("403");
  });

  it("reads query snapshots defensively", () => {
    const cell = (content: Record<string, unknown>): NotebookCell => ({ id: "c", notebookId: "n", position: 0, kind: "query", authorKind: "user", authorId: null, content, createdAt: 0, updatedAt: 0 });
    expect(querySnapshot(cell({ snapshot: { columns: ["a"], rows: [[1]], ranAt: 5 } }))).toEqual({ columns: ["a"], rows: [[1]], ranAt: 5 });
    expect(querySnapshot(cell({ snapshot: null }))).toBeNull();
    expect(querySnapshot(cell({ snapshot: { columns: "x" } }))).toBeNull();
  });
});
