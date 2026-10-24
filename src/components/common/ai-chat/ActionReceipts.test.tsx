import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { AiAction } from "@/api/aiActions";
import { server } from "@/test/mocks/server";

import { ActionReceipts } from "./ActionReceipts";

function action(extra: Partial<AiAction>): AiAction {
  return {
    id: "a1", source: "chat", origin: "chat", runId: "r1", threadId: "t1", userId: "u1", connectionId: "c1", agentPath: null,
    tool: "create_saved_query", title: "Save a query", toolkit: "data", tier: "t1", args: {}, description: 'Save the query "orders"',
    status: "executed", result: null, error: null, decidedBy: null, decidedAt: null, expiresAt: 0, createdAt: 0, undoneAt: null,
    canDecide: false, undoAvailable: true, userName: "Alice", decidedByName: null, ...extra,
  };
}

describe("ActionReceipts", () => {
  it("lists what a reply changed, in order, and undoes a T1 action", async () => {
    const asked: string[] = [];
    server.use(
      http.get("/api/ai-actions/activity", ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("ids") ?? "");
        return HttpResponse.json({ success: true, data: { actions: [
          action({ id: "a2", tool: "drop_table", title: "Drop a table", tier: "t3", status: "pending", source: "background", undoAvailable: false, description: "DROP TABLE db.t" }),
          action({}),
          action({ id: "a3", status: "failed", undoAvailable: false, error: "Permission denied", description: "Save the query \"x\"" }),
        ] } });
      }),
      http.post("/api/ai-actions/a1/undo", () => HttpResponse.json({ success: true, data: action({ undoneAt: 5, undoAvailable: false }) })),
    );
    render(<ActionReceipts ids={["a1", "a2", "a3"]} />);
    await waitFor(() => expect(screen.getByText('Save the query "orders"')).not.toBeNull());
    expect(asked).toEqual(["a1,a2,a3"]);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toContain("Done");
    expect(items[1]).toContain("Waiting for a second approver");
    expect(items[2]).toContain("Permission denied");
    expect(screen.getAllByRole("button", { name: /Undo/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Undo Save a query" }));
    await waitFor(() => expect(screen.getByText("Undone")).not.toBeNull());
    expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull();
  });

  it("shows nothing until there is something to show", () => {
    const { container } = render(<ActionReceipts ids={[]} />);
    expect(container.textContent).toBe("");
  });
});
