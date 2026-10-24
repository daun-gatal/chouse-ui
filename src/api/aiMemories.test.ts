import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/test/mocks/server";
import {
  createMemory,
  deleteMemory,
  exportMyMemories,
  getMyMemories,
  getPendingMemoryCount,
  getTableMemories,
  getTeamMemories,
  reviewMemory,
  setMemoryEnabled,
  updateMemory,
} from "./aiMemories";

const MEMORY = {
  id: "m1", scope: "user", ownerId: "u1", connectionId: null, connectionName: null, content: "Prefers UTC", status: "active",
  source: "agent", agentSlug: "clickhouse-data", threadId: "t1", flag: null, proposedBy: "u1", proposedByName: "Ann",
  decidedBy: null, decidedByName: null, decidedAt: null, createdAt: 1, updatedAt: 1, canEdit: true,
};

const ok = (data: unknown): Response => HttpResponse.json({ success: true, data });

describe("aiMemories API", () => {
  it("reads your memories and turns memory off", async () => {
    let settings: unknown;
    server.use(
      http.get("/api/ai-memories/mine", () => ok({ enabled: true, memories: [MEMORY] })),
      http.put("/api/ai-memories/settings", async ({ request }) => {
        settings = await request.json();
        return ok({ enabled: false });
      }),
      http.get("/api/ai-memories/export", () => ok({ exportedAt: "2026-10-24T00:00:00Z", memories: [{ content: "Prefers UTC", source: "agent", createdAt: "x" }] })),
    );
    expect(await getMyMemories()).toEqual({ enabled: true, memories: [MEMORY] });
    expect(await setMemoryEnabled(false)).toBe(false);
    expect(settings).toEqual({ enabled: false });
    expect((await exportMyMemories()).memories).toHaveLength(1);
  });

  it("filters team memories and asks about one table", async () => {
    const seen: string[] = [];
    server.use(
      http.get("/api/ai-memories/team", ({ request }) => {
        seen.push(new URL(request.url).search);
        return ok({ canManage: false, memories: [] });
      }),
      http.get("/api/ai-memories/for-table", ({ request }) => {
        seen.push(new URL(request.url).search);
        return ok({ canManage: false, memories: [] });
      }),
      http.get("/api/ai-memories/pending-count", () => ok({ count: 4 })),
    );
    await getTeamMemories();
    await getTeamMemories({ connectionId: "c1", status: "proposed" });
    await getTableMemories("c1", "sales", "orders");
    expect(seen).toEqual(["", "?connectionId=c1&status=proposed", "?connectionId=c1&database=sales&table=orders"]);
    expect(await getPendingMemoryCount()).toBe(4);
  });

  it("creates, edits, deletes and reviews", async () => {
    const calls: string[] = [];
    server.use(
      http.post("/api/ai-memories", async ({ request }) => {
        calls.push(`create ${JSON.stringify(await request.json())}`);
        return ok({ ...MEMORY, duplicate: false });
      }),
      http.put("/api/ai-memories/m1", async ({ request }) => {
        calls.push(`update ${JSON.stringify(await request.json())}`);
        return ok(MEMORY);
      }),
      http.delete("/api/ai-memories/m1", () => {
        calls.push("delete");
        return ok({ deleted: true });
      }),
      http.post("/api/ai-memories/m1/approve", () => {
        calls.push("approve");
        return ok({ ...MEMORY, status: "active" });
      }),
      http.post("/api/ai-memories/m1/reject", () => {
        calls.push("reject");
        return ok({ ...MEMORY, status: "rejected" });
      }),
    );
    await createMemory({ scope: "connection", content: "events.ts is UTC", connectionId: "c1" });
    await updateMemory("m1", "Prefers UTC everywhere");
    await deleteMemory("m1");
    expect((await reviewMemory("m1", true)).status).toBe("active");
    expect((await reviewMemory("m1", false)).status).toBe("rejected");
    expect(calls).toEqual([
      'create {"scope":"connection","content":"events.ts is UTC","connectionId":"c1"}',
      'update {"content":"Prefers UTC everywhere"}',
      "delete",
      "approve",
      "reject",
    ]);
  });

  it("surfaces a refused note", async () => {
    server.use(http.post("/api/ai-memories", () => HttpResponse.json(
      { success: false, error: { code: "BAD_REQUEST", message: "Not saved: the note matched the PII redaction guardrail.", category: "validation" } },
      { status: 400 },
    )));
    await expect(createMemory({ scope: "user", content: "a@b.co" })).rejects.toMatchObject({ statusCode: 400 });
  });
});
