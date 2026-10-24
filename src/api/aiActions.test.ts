import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/test/mocks/server";
import { approveAiAction, getAiActionInbox, getAiActivity, getPendingAiActionCount, listAiActions, rejectAiAction, undoAiAction } from "./aiActions";

const ACTION = {
  id: "a1", source: "background", origin: "background", runId: null, threadId: null, userId: "u1", connectionId: "c1", agentPath: null,
  tool: "kill_query", title: "Kill a query", toolkit: "data", tier: "t2", args: { queryId: "q1" }, description: "KILL q1",
  status: "pending", result: null, error: null, decidedBy: null, decidedAt: null, expiresAt: 2, createdAt: 1, undoneAt: null,
  canDecide: true, undoAvailable: false, userName: "Alice", decidedByName: null,
};

describe("aiActions API", () => {
  it("lists actions, filtered by status when asked", async () => {
    const seen: string[] = [];
    server.use(http.get("/api/ai-actions", ({ request }) => {
      seen.push(new URL(request.url).search);
      return HttpResponse.json({ success: true, data: { canAct: true, actions: [ACTION] } });
    }));
    expect(await listAiActions()).toEqual({ canAct: true, actions: [ACTION] });
    await listAiActions("pending");
    expect(seen).toEqual(["", "?status=pending"]);
  });

  it("reads the pending count", async () => {
    server.use(http.get("/api/ai-actions/pending-count", () => HttpResponse.json({ success: true, data: { count: 3 } })));
    expect(await getPendingAiActionCount()).toBe(3);
  });

  it("approves as proposed or with edited arguments, and rejects with a reason", async () => {
    const bodies: Array<[string, unknown]> = [];
    server.use(
      http.post("/api/ai-actions/a1/approve", async ({ request }) => {
        bodies.push(["approve", await request.json()]);
        return HttpResponse.json({ success: true, data: { ...ACTION, status: "executed" } });
      }),
      http.post("/api/ai-actions/a1/reject", async ({ request }) => {
        bodies.push(["reject", await request.json()]);
        return HttpResponse.json({ success: true, data: { ...ACTION, status: "rejected" } });
      }),
    );
    expect((await approveAiAction("a1")).status).toBe("executed");
    await approveAiAction("a1", { queryId: "q2" });
    expect((await rejectAiAction("a1", "not now")).status).toBe("rejected");
    await rejectAiAction("a1");
    expect(bodies).toEqual([["approve", {}], ["approve", { args: { queryId: "q2" } }], ["reject", { message: "not now" }], ["reject", {}]]);
  });

  it("surfaces an expired approval as an error", async () => {
    server.use(http.post("/api/ai-actions/a1/approve", () => HttpResponse.json(
      { success: false, error: { code: "APPROVAL_EXPIRED", message: "This action expired.", category: "validation" } },
      { status: 410 },
    )));
    await expect(approveAiAction("a1")).rejects.toMatchObject({ statusCode: 410, code: "APPROVAL_EXPIRED" });
  });

  it("reads the inbox and the activity feed, narrowed to a run when asked (ADR 0025)", async () => {
    const seen: string[] = [];
    server.use(
      http.get("/api/ai-actions/inbox", () => HttpResponse.json({ success: true, data: { actions: [ACTION] } })),
      http.get("/api/ai-actions/activity", ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ success: true, data: { actions: [{ ...ACTION, status: "executed", tier: "t1", undoAvailable: true }] } });
      }),
    );
    expect(await getAiActionInbox()).toEqual([ACTION]);
    expect((await getAiActivity())[0].undoAvailable).toBe(true);
    await getAiActivity({ runId: "r1", limit: 5 });
    expect(seen).toEqual(["", "?runId=r1&limit=5"]);
  });

  it("undoes an action, and surfaces a refused undo as an error", async () => {
    server.use(http.post("/api/ai-actions/a1/undo", () => HttpResponse.json({ success: true, data: { ...ACTION, status: "executed", undoneAt: 5 } })));
    expect((await undoAiAction("a1")).undoneAt).toBe(5);
    server.use(http.post("/api/ai-actions/a1/undo", () => HttpResponse.json(
      { success: false, error: { code: "UNDO_CHANGED_SINCE", message: "It changed after the assistant's action.", category: "validation" } },
      { status: 409 },
    )));
    await expect(undoAiAction("a1")).rejects.toMatchObject({ statusCode: 409, code: "UNDO_CHANGED_SINCE" });
  });
});
