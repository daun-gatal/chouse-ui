import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import {
  agentInputOf,
  bindFeature,
  createAgent,
  createHarness,
  createSkill,
  deleteAgent,
  deleteHarness,
  deleteSkill,
  getAiRegistry,
  harnessInputOf,
  listRevisions,
  previewAgent,
  resetAgent,
  resetHarness,
  resetSkill,
  rollbackRevision,
  runAgentTest,
  skillInputOf,
  updateAgent,
  updateHarness,
  updateSkill,
  type AgentInput,
  type AiAgent,
  type AiHarness,
  type AiSkill,
} from "./aiAgents";

const agentInput: AgentInput = {
  slug: "orders",
  name: "Orders",
  description: "Orders questions",
  kind: "agent",
  systemPrompt: "Help",
  taskTemplate: null,
  modelConfigId: null,
  harnessId: "h1",
  tuning: { stepBudget: 6 },
  requiredPermissions: [],
  tools: ["list_tables"],
  skills: [{ skillId: "s1", mode: "progressive", pinnedFile: null }],
  subagents: [],
  enabled: true,
};

const meta = { id: "x", isSystem: false, seedHash: null, customized: false, version: 2, createdBy: null, createdAt: 0, updatedAt: 0, updateAvailable: false, usedBy: [] };

describe("AI agents API", () => {
  it("calls every registry endpoint with the right method, path and body", async () => {
    const seen: Array<{ method: string; path: string; query: Record<string, string>; body: unknown }> = [];
    server.use(
      http.all("/api/ai-agents/*", async ({ request }) => {
        const url = new URL(request.url);
        const body = ["POST", "PUT"].includes(request.method) ? await request.json().catch(() => null) : undefined;
        seen.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
        return HttpResponse.json({ success: true, data: { revisions: [{ id: "r1" }], restored: "agent", agents: [] } });
      }),
    );
    const harness = { slug: "h", name: "H", description: "", excludedTools: [], generalPurpose: { enabled: false }, promptSuffix: null, toolDescriptionOverrides: {} };
    const skill = { path: "custom/x", skillMd: "---\nname: x\ndescription: y\n---\n", files: {}, enabled: true };

    await getAiRegistry();
    expect(await listRevisions("agent", "a/1")).toEqual([{ id: "r1" }]);
    await rollbackRevision("r1");
    await previewAgent("check-optimize", null, agentInput);
    await createAgent(agentInput);
    await updateAgent("a1", agentInput, 3);
    await deleteAgent("a1", 4);
    await resetAgent("a1");
    await createHarness(harness);
    await updateHarness("h1", harness, 1);
    await deleteHarness("h1", 2);
    await resetHarness("h1");
    await createSkill(skill);
    await updateSkill("s1", skill, 1);
    await deleteSkill("s1", 2);
    await resetSkill("s1");
    await bindFeature("optimize-query", "a1");
    await runAgentTest({ featureId: "chat", messages: [{ role: "user", content: "hi" }] });

    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "GET /api/ai-agents/registry",
      "GET /api/ai-agents/revisions/agent/a%2F1",
      "POST /api/ai-agents/revisions/r1/rollback",
      "POST /api/ai-agents/preview",
      "POST /api/ai-agents/agents",
      "PUT /api/ai-agents/agents/a1",
      "DELETE /api/ai-agents/agents/a1",
      "POST /api/ai-agents/agents/a1/reset",
      "POST /api/ai-agents/harnesses",
      "PUT /api/ai-agents/harnesses/h1",
      "DELETE /api/ai-agents/harnesses/h1",
      "POST /api/ai-agents/harnesses/h1/reset",
      "POST /api/ai-agents/skills",
      "PUT /api/ai-agents/skills/s1",
      "DELETE /api/ai-agents/skills/s1",
      "POST /api/ai-agents/skills/s1/reset",
      "PUT /api/ai-agents/bindings/optimize-query",
      "POST /api/ai-agents/test",
    ]);
    expect(seen[3].body).toEqual({ featureId: "check-optimize", agentId: null, agent: agentInput });
    expect(seen[5].body).toEqual({ ...agentInput, version: 3 });
    expect(seen[6].query).toEqual({ version: "4" });
    expect(seen[16].body).toEqual({ agentId: "a1" });
  });

  it("surfaces validation problems as errors", async () => {
    server.use(
      http.post("/api/ai-agents/agents", () => HttpResponse.json({ success: false, error: { message: "Tool 'x' is not in the catalog", code: "BAD_REQUEST" } }, { status: 400 })),
    );
    await expect(createAgent(agentInput)).rejects.toThrow("not in the catalog");
  });

  it("extracts editable inputs without row metadata", () => {
    const agent: AiAgent = { ...agentInput, ...meta };
    const input = agentInputOf(agent);
    expect(input).toEqual(agentInput);
    input.tools.push("x");
    expect(agent.tools).toEqual(["list_tables"]);

    const harness: AiHarness = { slug: "h", name: "H", description: "", excludedTools: ["task"], generalPurpose: { enabled: false }, promptSuffix: "s", toolDescriptionOverrides: { ls: "l" }, ...meta };
    expect(harnessInputOf(harness)).toEqual({ slug: "h", name: "H", description: "", excludedTools: ["task"], generalPurpose: { enabled: false }, promptSuffix: "s", toolDescriptionOverrides: { ls: "l" } });

    const skill: AiSkill = { path: "a/b", skillMd: "md", files: { "r.md": "r" }, enabled: true, name: "b", description: "d", ...meta };
    expect(skillInputOf(skill)).toEqual({ path: "a/b", skillMd: "md", files: { "r.md": "r" }, enabled: true });
  });
});
