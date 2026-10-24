import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/test/mocks/server";
import { getTriageRules, getTriageRunForSubject, listTriageRuns, saveTriageRule } from "./aiTriage";

const ok = (data: unknown): Response => HttpResponse.json({ success: true, data });

describe("aiTriage API", () => {
  it("reads rules and saves one", async () => {
    let saved: unknown;
    server.use(
      http.get("/api/ai-triage/rules", () => ok({ canManage: true, defaultAgentId: "a1", rules: [], channels: [], agents: [] })),
      http.put("/api/ai-triage/rules/fleet_alert", async ({ request }) => {
        saved = await request.json();
        return ok({ trigger: "fleet_alert", enabled: true });
      }),
    );
    expect((await getTriageRules()).defaultAgentId).toBe("a1");
    const input = { enabled: true, agentId: null, cooldownMinutes: 30, dailyTokenBudget: 50_000, channelIds: ["ch1"] };
    expect((await saveTriageRule("fleet_alert", input)).enabled).toBe(true);
    expect(saved).toEqual(input);
  });

  it("lists runs with filters and finds one subject's run", async () => {
    const seen: string[] = [];
    server.use(
      http.get("/api/ai-triage/runs", ({ request }) => {
        seen.push(new URL(request.url).search);
        return ok({ runs: [], total: 0 });
      }),
      http.get("/api/ai-triage/runs/for-subject", ({ request }) => {
        seen.push(new URL(request.url).search);
        return ok(null);
      }),
    );
    await listTriageRuns();
    await listTriageRuns({ trigger: "observe_incident", status: "completed", limit: 20, offset: 40 });
    expect(await getTriageRunForSubject("observe_incident", "i1")).toBeNull();
    expect(seen).toEqual(["", "?trigger=observe_incident&status=completed&limit=20&offset=40", "?trigger=observe_incident&subjectId=i1"]);
  });

  it("surfaces a refused rule", async () => {
    server.use(http.put("/api/ai-triage/rules/fleet_alert", () => HttpResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Permission required: ai_agents:manage", category: "auth" } },
      { status: 403 },
    )));
    await expect(saveTriageRule("fleet_alert", { enabled: true, agentId: null, cooldownMinutes: 1, dailyTokenBudget: 1_000, channelIds: [] })).rejects.toMatchObject({ statusCode: 403 });
  });
});
