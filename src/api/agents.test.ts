import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { assignAgentPolicy, deleteAgentPolicy, getAgentSession, getAgentSummary, getMcpOAuth, getMcpOverview, listAgentPolicies, listAgentSessions, listPolicyScopes, revokeMcpOAuthGrant, saveAgentPolicy, setAgentsPaused, setMcpOAuthClientStatus, updateMcpSettings } from "./agents";

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

  it("assigns one policy to many targets and lists the targets by name", async () => {
    const seen: Array<{ method: string; path: string; body: unknown }> = [];
    server.use(
      http.put("/api/agents/policies/assign", async ({ request }) => {
        seen.push({ method: request.method, path: new URL(request.url).pathname, body: await request.json() });
        return HttpResponse.json({ success: true, data: { policies: [{ id: "p1" }, { id: "p2" }] } });
      }),
      http.get("/api/agents/policy-scopes", () => HttpResponse.json({ success: true, data: { roles: [{ id: "analyst", label: "Analyst", detail: null }], tokens: [] } })),
    );
    const settings = { maxBytesPerQuery: null, dailyBytes: 1024, partitionFilterBytes: null, incidentMode: "warn" as const, alertMultiplier: null };
    const targets = [{ scopeKind: "role" as const, scopeId: "analyst" }, { scopeKind: "pat" as const, scopeId: "t1" }];
    expect(await assignAgentPolicy({ settings, targets, removeIds: ["old"] })).toEqual([{ id: "p1" }, { id: "p2" }]);
    expect(seen).toEqual([{ method: "PUT", path: "/api/agents/policies/assign", body: { settings, targets, removeIds: ["old"] } }]);
    expect((await listPolicyScopes()).roles).toEqual([{ id: "analyst", label: "Analyst", detail: null }]);
  });

  it("reads and updates the MCP settings", async () => {
    const seen: Array<{ method: string; body: unknown }> = [];
    const overview = { settings: { enabled: true }, endpoint: { path: "/mcp", url: null }, tools: [{ name: "query" }] };
    server.use(
      http.all("/api/agents/mcp", async ({ request }) => {
        seen.push({ method: request.method, body: request.method === "PUT" ? await request.json() : undefined });
        return HttpResponse.json({ success: true, data: overview });
      }),
    );
    expect(await getMcpOverview()).toEqual(overview);
    expect(await updateMcpSettings({ enabled: true, toolOverrides: { kill_query: true } })).toEqual(overview);
    expect(seen).toEqual([
      { method: "GET", body: undefined },
      { method: "PUT", body: { enabled: true, toolOverrides: { kill_query: true } } },
    ]);
  });

  it("looks after agents that sign people in to MCP", async () => {
    const seen: Array<{ method: string; path: string; body: unknown }> = [];
    const oauth = { clients: [{ id: "chc_1", name: "Atlas", status: "pending", returnsTo: ["agent.example"], clientUri: null, people: 0, createdAt: 1, lastUsedAt: null }], grants: [] };
    server.use(
      http.get("/api/agents/mcp/oauth", () => HttpResponse.json({ success: true, data: oauth })),
      http.put("/api/agents/mcp/oauth/clients/chc_1", async ({ request }) => {
        seen.push({ method: "PUT", path: new URL(request.url).pathname, body: await request.json() });
        return HttpResponse.json({ success: true, data: { id: "chc_1", status: "allowed" } });
      }),
      http.delete("/api/agents/mcp/oauth/grants/g%2F1", ({ request }) => {
        seen.push({ method: "DELETE", path: new URL(request.url).pathname, body: null });
        return HttpResponse.json({ success: true, data: { id: "g/1" } });
      }),
    );
    expect(await getMcpOAuth()).toEqual(oauth);
    expect((await setMcpOAuthClientStatus("chc_1", "allowed")).status).toBe("allowed");
    await revokeMcpOAuthGrant("g/1");
    expect(seen).toEqual([
      { method: "PUT", path: "/api/agents/mcp/oauth/clients/chc_1", body: { status: "allowed" } },
      { method: "DELETE", path: "/api/agents/mcp/oauth/grants/g%2F1", body: null },
    ]);
  });
});

