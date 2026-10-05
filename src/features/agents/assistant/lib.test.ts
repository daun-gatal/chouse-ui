import { describe, expect, it } from "vitest";

import type { AiAgent, AiFeature, AiRegistry, CatalogTool } from "@/api/aiAgents";
import {
  agentOrigin,
  agentSubtree,
  agentTree,
  blankAgent,
  compatibleAgents,
  duplicateAgent,
  formatDuration,
  groupFeatures,
  groupTools,
  insertAt,
  parseJsonInput,
  parseOverrides,
  problemsFor,
  revisionLabel,
  sampleInput,
  slugify,
  uniqueSlug,
  variablesFor,
} from "./lib";

const meta = { isSystem: false, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0, updateAvailable: false, usedBy: [] };

function agent(overrides: Partial<AiAgent>): AiAgent {
  return {
    id: "a", slug: "a", name: "A", description: "", kind: "agent", systemPrompt: "", taskTemplate: null, modelConfigId: null,
    harnessId: "h", tuning: { stepBudget: 5 }, requiredPermissions: [], tools: [], skills: [], subagents: [], enabled: true,
    ...meta,
    ...overrides,
  };
}

function feature(overrides: Partial<AiFeature>): AiFeature {
  return {
    id: "f", title: "F", description: "", surface: "sql-editor", delivery: "structured", permission: "ai:optimize",
    contexts: [], variables: {}, background: false, agentId: null,
    ...overrides,
  };
}

const tools: CatalogTool[] = [
  { name: "list_tables", title: "List tables", domain: "clickhouse", category: "schema", access: "read", requires: "session", permissions: [], description: "" },
  { name: "query_node", title: "Query node", domain: "clickhouse", category: "fleet", access: "read", requires: "fleet", permissions: [], description: "" },
  { name: "list_users", title: "List users", domain: "chouse", category: "access", access: "read", requires: "userApi", permissions: ["users:view"], description: "" },
];

function registry(agents: AiAgent[], features: AiFeature[] = []): AiRegistry {
  return {
    version: 1, features, agents,
    harnesses: [{ id: "h-focused", slug: "focused", name: "Focused", description: "", excludedTools: [], generalPurpose: { enabled: false }, promptSuffix: null, toolDescriptionOverrides: {}, ...meta }],
    skills: [], tools, builtinTools: [], contexts: ["session", "fleet", "userApi"],
    limits: { stepBudget: { min: 1, max: 100 }, recursionLimit: { min: 8, max: 1000 }, timeoutMs: { min: 5000, max: 1800000 }, maxOutputTokens: { min: 256, max: 200000 } },
    problems: [],
  };
}

describe("assistant lib", () => {
  it("groups features by surface in product order", () => {
    const groups = groupFeatures([feature({ id: "b", title: "B", surface: "dataops" }), feature({ id: "c", surface: "chat", title: "Chat" }), feature({ id: "a", title: "A", surface: "dataops" })]);
    expect(groups.map((g) => [g.label, g.features.map((f) => f.id)])).toEqual([["Chat", ["c"]], ["DataOps", ["a", "b"]]]);
  });

  it("labels where an agent came from", () => {
    expect(agentOrigin({ isSystem: true, customized: false })).toBe("built-in");
    expect(agentOrigin({ isSystem: true, customized: true })).toBe("customized");
    expect(agentOrigin({ isSystem: false, customized: false })).toBe("custom");
  });

  it("previews which agents a feature can use", () => {
    const reg = registry([
      agent({ id: "chat", taskTemplate: null, tools: ["list_users"], name: "Chat" }),
      agent({ id: "sql", taskTemplate: "x", tools: ["list_tables"], name: "Sql" }),
      agent({ id: "fleet", taskTemplate: "x", tools: ["query_node"], name: "Fleet" }),
      agent({ id: "off", taskTemplate: "x", enabled: false }),
      agent({ id: "parent", taskTemplate: "x", subagents: ["child"], name: "Parent" }),
      agent({ id: "child", tools: ["list_tables"] }),
    ]);
    expect(compatibleAgents(feature({ contexts: ["fleet"] }), reg).map((a) => a.id)).toEqual(["fleet"]);
    expect(compatibleAgents(feature({ contexts: ["session"] }), reg).map((a) => a.id)).toEqual(["parent", "sql"]);
    // Chat agents have no task template; sorted by name ("A" is the child's default name).
    expect(compatibleAgents(feature({ delivery: "invoke", contexts: ["session", "userApi"] }), reg).map((a) => a.id)).toEqual(["child", "chat"]);
    expect(compatibleAgents(feature({ delivery: "invoke", contexts: ["session"] }), reg).map((a) => a.id)).toEqual(["child"]);
  });

  it("builds the agent tree from roots and survives cycles", () => {
    const reg = registry([
      agent({ id: "router", kind: "router", name: "Router", subagents: ["admin"] }),
      agent({ id: "admin", name: "Admin", subagents: ["auditor", "router"] }),
      agent({ id: "auditor", name: "Auditor" }),
      agent({ id: "solo", name: "Solo" }),
    ]);
    const tree = agentTree(reg);
    expect(tree.map((n) => n.agent.id)).toEqual(["solo"]);
    expect(agentSubtree("router", reg).map((a) => a.id)).toEqual(["router", "admin", "auditor"]);
    const acyclic = registry([
      agent({ id: "router", kind: "router", name: "Router", subagents: ["admin"] }),
      agent({ id: "admin", name: "Admin", subagents: ["auditor"] }),
      agent({ id: "auditor", name: "Auditor" }),
    ]);
    const roots = agentTree(acyclic);
    expect(roots.map((n) => n.agent.id)).toEqual(["router"]);
    expect(roots[0].children[0].children[0].agent.id).toBe("auditor");
  });

  it("groups tools by domain and category", () => {
    expect(groupTools(tools).map((g) => g.label)).toEqual(["CHouse (read-only) · access", "ClickHouse · fleet", "ClickHouse · schema"]);
  });

  it("makes slugs and keeps them unique", () => {
    expect(slugify("  My Orders Agent! ")).toBe("my-orders-agent");
    expect(uniqueSlug("Orders", ["orders", "orders-2"])).toBe("orders-3");
    expect(uniqueSlug("!!!", [])).toBe("agent");
  });

  it("drafts a blank agent on the focused harness and duplicates with a free slug", () => {
    const reg = registry([agent({ id: "x", slug: "sql-optimizer", name: "SQL Optimizer", isSystem: true, tools: ["list_tables"] })]);
    expect(blankAgent(reg)).toMatchObject({ harnessId: "h-focused", taskTemplate: null, enabled: true });
    const copy = duplicateAgent(reg.agents[0], reg);
    expect(copy.slug).toBe("sql-optimizer-copy");
    expect(copy.name).toBe("SQL Optimizer (copy)");
    copy.tools.push("y");
    expect(reg.agents[0].tools).toEqual(["list_tables"]);
  });

  it("offers only the variables every bound feature supplies", () => {
    const reg = registry([agent({ id: "x" })], [
      feature({ id: "f1", agentId: "x", variables: { query: { type: "string", description: "" }, extra: { type: "string", description: "" } } }),
      feature({ id: "f2", agentId: "x", variables: { query: { type: "string", description: "" } } }),
    ]);
    expect(Object.keys(variablesFor("x", reg))).toEqual(["query"]);
    expect(variablesFor(null, reg)).toEqual({});
  });

  it("parses test inputs and formats results", () => {
    expect(parseJsonInput("")).toEqual({ ok: true, value: {} });
    expect(parseJsonInput('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonInput("{").ok).toBe(false);
    expect(sampleInput("diagnose-parts")).toEqual({ database: "default", table: "events" });
    expect(sampleInput("unknown")).toEqual({});
    expect(formatDuration(450)).toBe("450 ms");
    expect(formatDuration(12_340)).toBe("12.3 s");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
    expect(revisionLabel("seed-upgrade")).toBe("Upgraded with CHouse");
    expect(revisionLabel("other")).toBe("other");
  });

  it("filters problems per entity and inserts text at the caret", () => {
    expect(problemsFor([{ entity: "agent", id: "a", message: "m1" }, { entity: "skill", id: "a", message: "m2" }], "agent", "a")).toEqual(["m1"]);
    expect(insertAt("Hello world", 6, 11, "{{ctx.name}}")).toEqual({ value: "Hello {{ctx.name}}", caret: 18 });
  });

  it("parses harness description overrides", () => {
    expect(parseOverrides("ls: List skills.\nbroken line\n read_file :  Open a skill \n:empty")).toEqual({ ls: "List skills.", read_file: "Open a skill" });
  });
});
