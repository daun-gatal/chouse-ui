import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { deleteAgentPolicy, getAgentSession, getAgentSummary, listAgentPolicies, listAgentSessions, saveAgentPolicy, setAgentsPaused } from "./agents";

describe("agents API", () => {
  it("reads sessions and manages policies", async () => {
    const seen: Array<{ method: string; path: string; params: Record<string, string> }> = [];
    server.use(
      http.all("/api/agents/*", ({ request }) => {
        const url = new URL(request.url);
        seen.push({ method: request.method, path: url.pathname, params: Object.fromEntries(url.searchParams) });
        return HttpResponse.json({ success: true, data: { sessions: [{ id: "s1" }], policies: [{ id: "p1" }], paused: true } });
      }),
    );
    await getAgentSummary();
    expect(await listAgentSessions(7)).toEqual([{ id: "s1" }]);
    await getAgentSession("s1");
    expect(await listAgentPolicies()).toEqual([{ id: "p1" }]);
    await saveAgentPolicy({ scopeKind: "default", scopeId: "*", maxBytesPerQuery: null, dailyBytes: null, partitionFilterBytes: null, incidentMode: "warn", alertMultiplier: null });
    await deleteAgentPolicy("p1");
    expect(await setAgentsPaused(true)).toMatchObject({ paused: true });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "GET /api/agents/summary",
      "GET /api/agents/sessions",
      "GET /api/agents/sessions/s1",
      "GET /api/agents/policies",
      "PUT /api/agents/policies",
      "DELETE /api/agents/policies/p1",
      "POST /api/agents/pause",
    ]);
    expect(seen[1].params).toEqual({ days: "7" });
  });
});
