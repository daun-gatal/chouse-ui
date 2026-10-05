import { afterEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { PERMISSIONS } from "../../../rbac/schema/base";
import { buildGrantedTools, catalogTool, describeCatalog, runtimeProvides, TOOL_CATALOG, userMayUseTool, type ToolRuntime } from "./catalog";
import { applyDescriptionOverrides, applyPromptSuffix, BUILTIN_TOOL_NAMES, generalPurposeSubagent, harnessToolMiddleware } from "./harness";
import { chatAgentCandidates, userMayUseAgent } from "./chatAgents";
import { InProcessApiClient, registerInProcessApi } from "./inProcessApi";
import type { AgentDef, HarnessDef, RegistrySnapshot } from "./types";

const session = {} as never;

describe("tool catalog", () => {
  it("has unique names that never collide with DeepAgents built-ins, and only read tools", () => {
    const names = TOOL_CATALOG.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(BUILTIN_TOOL_NAMES.has(name)).toBe(false);
    expect(TOOL_CATALOG.every((t) => t.access === "read")).toBe(true);
  });

  it("describes every entry for the UI", () => {
    for (const entry of describeCatalog()) {
      expect(entry.description.length).toBeGreaterThan(10);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });

  it("knows which contexts a runtime provides", () => {
    const runtime: ToolRuntime = { ctx: { clickhouseService: session, bearerToken: "t" }, fleetNodes: [] };
    expect(runtimeProvides(runtime, "session")).toBe(true);
    expect(runtimeProvides(runtime, "userApi")).toBe(true);
    expect(runtimeProvides(runtime, "fleet")).toBe(false);
  });

  it("builds granted tools in grant order and drops those whose context is missing", () => {
    const grants = ["render_chart", "list_databases", "query_node", "whoami", "generate_query"];
    const withSession = buildGrantedTools(grants, { ctx: { clickhouseService: session } });
    expect(withSession.map((t) => t.name)).toEqual(["render_chart", "list_databases", "generate_query"]);
    const fleetOnly = buildGrantedTools(grants, { ctx: {}, fleetNodes: [{ id: "n1", name: "node 1" }] });
    expect(fleetOnly.map((t) => t.name)).toEqual(["query_node", "generate_query"]);
    expect(buildGrantedTools(["unknown_tool"], { ctx: {} })).toEqual([]);
  });

  it("offers CHouse tools only to users holding one of their permissions", () => {
    const listUsers = catalogTool("list_users")!;
    expect(userMayUseTool(listUsers, { permissions: [] })).toBe(false);
    expect(userMayUseTool(listUsers, { permissions: [PERMISSIONS.USERS_VIEW] })).toBe(true);
    expect(userMayUseTool(listUsers, { isAdmin: true })).toBe(true);
    expect(userMayUseTool(catalogTool("whoami")!, { permissions: [] })).toBe(true);
    const built = buildGrantedTools(["whoami", "list_users"], { ctx: { bearerToken: "t", permissions: [] } });
    expect(built.map((t) => t.name)).toEqual(["whoami"]);
  });
});

describe("CHouse management tools call the API as the user", () => {
  afterEach(() => registerInProcessApi(new Hono()));

  it("forwards the bearer token and connection, unwraps the envelope, caps rows and redacts secrets", async () => {
    const seen: Array<{ path: string; auth: string | undefined; xrw: string | undefined; conn: string | undefined }> = [];
    const app = new Hono();
    app.get("/api/rbac/users", (c) => {
      seen.push({ path: c.req.url, auth: c.req.header("Authorization"), xrw: c.req.header("X-Requested-With"), conn: c.req.header("X-Connection-Id") });
      const users = Array.from({ length: 150 }, (_, i) => ({ id: `u${i}`, apiKey: "sk-secret-value-123" }));
      return c.json({ success: true, data: { users, total: 150 } });
    });
    registerInProcessApi(app);
    const [listUsers] = buildGrantedTools(["list_users"], { ctx: { bearerToken: "jwt-token", connectionId: "c1", isAdmin: true } });
    const result = (await listUsers.invoke({ search: "ann" })) as { truncated?: boolean; data?: { rows: Array<{ apiKey: string }>; total: number } };
    expect(seen[0].auth).toBe("Bearer jwt-token");
    expect(seen[0].xrw).toBe("XMLHttpRequest");
    expect(seen[0].conn).toBe("c1");
    expect(seen[0].path).toContain("search=ann");
    expect(seen[0].path).toContain("limit=50");
    expect(result.truncated).toBe(true);
    expect(result.data!.rows).toHaveLength(100);
    expect(result.data!.total).toBe(150);
    expect(result.data!.rows[0].apiKey).toBe("sk-***");
  });

  it("returns the route's refusal as a tool error instead of throwing", async () => {
    const app = new Hono();
    app.get("/api/rbac/roles", (c) => c.json({ success: false, error: { message: "Permission 'roles:view' required" } }, 403));
    registerInProcessApi(app);
    const [listRoles] = buildGrantedTools(["list_roles"], { ctx: { bearerToken: "t", isAdmin: true } });
    expect(await listRoles.invoke({})).toEqual({ error: "Permission 'roles:view' required" });
  });

  it("refuses to run without a registered app", async () => {
    registerInProcessApi(null as never);
    await expect(new InProcessApiClient("t").get("/api/x")).rejects.toThrow("not available");
  });
});

function harness(overrides: Partial<HarnessDef> = {}): HarnessDef {
  return {
    id: "h", slug: "h-1", name: "H", description: "", excludedTools: [], generalPurpose: { enabled: false }, promptSuffix: null,
    toolDescriptionOverrides: {}, isSystem: false, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

describe("harness", () => {
  it("filters excluded tools and rewrites descriptions on every model call", async () => {
    const middleware = harnessToolMiddleware(harness({ excludedTools: ["task"], toolDescriptionOverrides: { ls: "List skills." } })) as unknown as {
      name: string;
      wrapModelCall: (request: { tools: Array<{ name: string; description: string }> }, handler: (r: unknown) => Promise<unknown>) => Promise<unknown>;
    };
    expect(middleware.name).toBe("ChouseHarness_h_1");
    let received: { tools: Array<{ name: string; description: string }> } | null = null;
    await middleware.wrapModelCall(
      { tools: [{ name: "task", description: "d" }, { name: "ls", description: "old" }, { name: "read_file", description: "r" }] },
      async (r) => {
        received = r as typeof received;
        return null;
      },
    );
    expect(received!.tools.map((t) => [t.name, t.description])).toEqual([["ls", "List skills."], ["read_file", "r"]]);
  });

  it("adds no middleware when there is nothing to change", () => {
    expect(harnessToolMiddleware(harness())).toBeNull();
  });

  it("appends the prompt suffix and rewrites catalog descriptions", () => {
    expect(applyPromptSuffix("Prompt", harness({ promptSuffix: "  Suffix " }))).toBe("Prompt\n\nSuffix");
    expect(applyPromptSuffix("Prompt", harness({ promptSuffix: "  " }))).toBe("Prompt");
    const [tool] = buildGrantedTools(["generate_query"], { ctx: {} });
    const [overridden] = applyDescriptionOverrides([tool], harness({ toolDescriptionOverrides: { generate_query: "Draft SQL." } }));
    expect(overridden.description).toBe("Draft SQL.");
    expect(tool.description).not.toBe("Draft SQL.");
  });

  it("builds the general-purpose subagent only when enabled", () => {
    expect(generalPurposeSubagent(harness(), [], [])).toBeNull();
    const gp = generalPurposeSubagent(harness({ generalPurpose: { enabled: true, systemPrompt: "Help." } }), [], ["/skills/x"]);
    expect(gp).toMatchObject({ name: "general-purpose", systemPrompt: "Help.", skills: ["/skills/x"] });
  });
});

function agent(overrides: Partial<AgentDef>): AgentDef {
  return {
    id: "a", slug: "a", name: "A", description: "d", kind: "agent", systemPrompt: "", taskTemplate: null, modelConfigId: null,
    harnessId: "h", tuning: { stepBudget: 5 }, requiredPermissions: [], tools: [], skills: [], subagents: [], enabled: true,
    isSystem: false, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

describe("chat agent candidates", () => {
  const agents = [
    agent({ id: "router", slug: "router", name: "Router", kind: "router", subagents: ["data", "admin"] }),
    agent({ id: "data", slug: "data", name: "Data" }),
    agent({ id: "admin", slug: "admin", name: "Admin", subagents: ["auditor"] }),
    agent({ id: "auditor", slug: "auditor", name: "Auditor" }),
    agent({ id: "feature", slug: "feature", name: "Feature", taskTemplate: "x" }),
    agent({ id: "off", slug: "off", name: "Off", enabled: false }),
    agent({ id: "secret", slug: "secret", name: "Secret", requiredPermissions: [PERMISSIONS.USERS_VIEW] }),
  ];
  const snapshot: RegistrySnapshot = {
    version: 1,
    agents: new Map(agents.map((a) => [a.id, a])),
    harnesses: new Map(),
    skills: new Map(),
    bindings: new Map([["chat", { featureId: "chat", agentId: "data", updatedBy: null, updatedAt: 0 }]]),
  };

  it("lists routers first, then top-level chat agents the user may use", () => {
    expect(chatAgentCandidates(snapshot, { permissions: [] }).map((a) => a.id)).toEqual(["router", "admin", "data"]);
    expect(chatAgentCandidates(snapshot, { permissions: [PERMISSIONS.USERS_VIEW] }).map((a) => a.id)).toEqual(["router", "admin", "data", "secret"]);
  });

  it("gates agents on their required permissions", () => {
    expect(userMayUseAgent(agents[6], { permissions: [] })).toBe(false);
    expect(userMayUseAgent(agents[6], { isAdmin: true })).toBe(true);
  });
});
