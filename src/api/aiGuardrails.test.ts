import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import {
  createGuardrail,
  deleteGuardrail,
  draftGuardrail,
  getGuardrailEvents,
  getGuardrails,
  guardrailInputOf,
  listGuardrailRevisions,
  reorderGuardrails,
  resetGuardrail,
  rollbackGuardrail,
  setGuardrailState,
  testGuardrail,
  updateGuardrail,
  type Guardrail,
  type GuardrailInput,
} from "./aiGuardrails";

const input: GuardrailInput = {
  slug: "employee-ids", name: "Employee IDs", description: "", kind: "pattern",
  config: { detectors: [], patterns: [{ label: "Employee ID", regex: "EMP-\\d{6}", caseInsensitive: false }], strategy: "placeholder" },
  stages: ["tool_result"], action: "redact", mode: "shadow", scope: { agents: "all", features: "all", mcp: false }, position: 25, enabled: true,
};

const stored: Guardrail = {
  ...input, id: "g1", isSystem: false, seedHash: null, customized: false, version: 3, createdBy: "u1", createdAt: 1, updatedAt: 2,
  updateAvailable: false, triggers24h: { total: 4, applied: 4, blocked: 0 },
};

function ok(data: unknown): Response {
  return HttpResponse.json({ success: true, data });
}

describe("api/aiGuardrails", () => {
  it("calls every route with the right method, path and body", async () => {
    const seen: Array<{ method: string; path: string; search: string; body: unknown }> = [];
    server.use(http.all("/api/ai-guardrails*", async ({ request }) => {
      const url = new URL(request.url);
      const text = request.method === "GET" || request.method === "DELETE" ? "" : await request.text();
      seen.push({ method: request.method, path: url.pathname, search: url.search, body: text ? JSON.parse(text) : null });
      if (url.pathname.endsWith("/events")) return ok({ events: [], total: 0 });
      if (url.pathname.endsWith("/revisions")) return ok({ revisions: [{ id: "r1" }] });
      if (url.pathname.endsWith("/reorder")) return ok({ guardrails: [] });
      return ok(stored);
    }));

    await getGuardrails();
    expect(await getGuardrailEvents({ days: 7, guardrailId: "g1" })).toEqual({ events: [], total: 0 });
    await getGuardrailEvents({ days: 30, mode: "shadow", limit: 25, offset: 50 });
    await createGuardrail(input);
    await updateGuardrail("g1", input, 3);
    await setGuardrailState("g1", { mode: "enforce" }, 3);
    await reorderGuardrails(["g2", "g1"]);
    await deleteGuardrail("g1", 4);
    await resetGuardrail("builtin-guardrail-pii");
    expect(await listGuardrailRevisions("g1")).toEqual([{ id: "r1" }]);
    await rollbackGuardrail("r1");
    await testGuardrail({ guardrail: input, stage: "tool_result", text: "EMP-123456" });
    await draftGuardrail("Mask employee ids", "model-2");

    expect(seen.map((s) => `${s.method} ${s.path}${s.search}`)).toEqual([
      "GET /api/ai-guardrails",
      "GET /api/ai-guardrails/events?days=7&guardrailId=g1",
      "GET /api/ai-guardrails/events?days=30&mode=shadow&limit=25&offset=50",
      "POST /api/ai-guardrails",
      "PUT /api/ai-guardrails/g1",
      "PATCH /api/ai-guardrails/g1/state",
      "POST /api/ai-guardrails/reorder",
      "DELETE /api/ai-guardrails/g1?version=4",
      "POST /api/ai-guardrails/builtin-guardrail-pii/reset",
      "GET /api/ai-guardrails/g1/revisions",
      "POST /api/ai-guardrails/revisions/r1/rollback",
      "POST /api/ai-guardrails/test",
      "POST /api/ai-guardrails/draft?modelId=model-2",
    ]);
    expect(seen[4].body).toEqual({ ...input, version: 3 });
    expect(seen[5].body).toEqual({ mode: "enforce", version: 3 });
    expect(seen[6].body).toEqual({ ids: ["g2", "g1"] });
    expect(seen[12].body).toEqual({ goal: "Mask employee ids" });
  });

  it("surfaces the server's validation message", async () => {
    server.use(http.post("/api/ai-guardrails", () => HttpResponse.json({ success: false, error: { code: "BAD_REQUEST", message: "Pattern 'x': Nested repeats" } }, { status: 400 })));
    await expect(createGuardrail(input)).rejects.toThrow("Nested repeats");
  });

  it("keeps only the editable fields of a stored guardrail", () => {
    expect(guardrailInputOf(stored)).toEqual(input);
  });
});
