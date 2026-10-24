import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/test/mocks/server";
import { approveAiAction, getPendingAiActionCount, listAiActions, rejectAiAction } from "./aiActions";

const ACTION = {
  id: "a1", source: "background", runId: null, threadId: null, userId: "u1", connectionId: "c1", agentPath: null,
  tool: "kill_query", title: "Kill a query", risk: "low", args: { queryId: "q1" }, description: "KILL q1",
  status: "pending", result: null, error: null, decidedBy: null, decidedAt: null, expiresAt: 2, createdAt: 1,
  canDecide: true, userName: "Alice", decidedByName: null,
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
});
