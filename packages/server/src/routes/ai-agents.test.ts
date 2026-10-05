/**
 * `/api/ai-agents` against a real in-memory RBAC database and real JWTs:
 * permission gates, registry read, CRUD with optimistic concurrency, bindings,
 * prompt preview, revisions + rollback, and audit entries (ADR 0019).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase, rawAll, rawRun } from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import { syncRegistrySeeds } from "../services/ai/registry/seedSync";
import aiAgents from "./ai-agents";

const USER = "ai-agents-user";
const VIEW = ["ai_agents:view"];
const MANAGE = ["ai_agents:view", "ai_agents:manage"];
let app: Hono;

async function token(permissions: string[]): Promise<string> {
  return generateAccessToken({ sub: USER, email: "a@test.local", username: "agents", roles: ["custom"], permissions, sessionId: "s1" });
}

async function call(method: string, path: string, permissions: string[], body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(permissions)}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data;
}

const agentBody = {
  slug: "orders-helper",
  name: "Orders helper",
  description: "Answers questions about the orders tables",
  kind: "agent",
  systemPrompt: "You help with orders. {{skill:clickhouse-playbook/reference.md}}",
  taskTemplate: null,
  modelConfigId: null,
  harnessId: "builtin-harness-focused",
  tuning: { stepBudget: 6 },
  requiredPermissions: [],
  tools: ["list_tables", "get_table_schema"],
  skills: [],
  subagents: [],
  enabled: true,
};

beforeAll(async () => {
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'a@test.local', 'agents', 'x', 1, unixepoch(), unixepoch())`);
  await syncRegistrySeeds();
  app = new Hono();
  app.onError(errorHandler);
  app.route("/ai-agents", aiAgents);
});

afterAll(async () => {
  await closeDatabase();
});

describe("permission gates", () => {
  it("needs ai_agents:view to read and ai_agents:manage to write or test", async () => {
    expect((await call("GET", "/ai-agents/registry", ["metrics:view"])).status).toBe(403);
    expect((await call("GET", "/ai-agents/registry", VIEW)).status).toBe(200);
    expect((await call("POST", "/ai-agents/agents", VIEW, agentBody)).status).toBe(403);
    expect((await call("PUT", "/ai-agents/bindings/chat", VIEW, { agentId: "x" })).status).toBe(403);
    expect((await call("POST", "/ai-agents/agents/builtin-agent-sql-optimizer/reset", VIEW)).status).toBe(403);
    expect((await call("POST", "/ai-agents/test", VIEW, { featureId: "chat" })).status).toBe(403);
  });
});

describe("registry", () => {
  it("lists every feature with its bound agent, the catalog and no problems", async () => {
    const data = await json<{
      features: Array<{ id: string; agentId: string | null; variables: Record<string, unknown> }>;
      agents: Array<{ id: string; usedBy: string[] }>;
      tools: Array<{ name: string; requires: string | null }>;
      builtinTools: Array<{ name: string }>;
      problems: unknown[];
    }>(await call("GET", "/ai-agents/registry", VIEW));
    expect(data.features).toHaveLength(22);
    expect(data.features.find((f) => f.id === "optimize-query")?.agentId).toBe("builtin-agent-sql-optimizer");
    expect(data.features.find((f) => f.id === "optimize-query")?.variables).toHaveProperty("query");
    expect(data.agents.find((a) => a.id === "builtin-agent-sql-optimizer")?.usedBy).toEqual(["feature 'Optimize query'"]);
    expect(data.tools.find((t) => t.name === "list_users")?.requires).toBe("userApi");
    expect(data.builtinTools.map((t) => t.name)).toContain("task");
    expect(data.problems).toEqual([]);
  });
});

describe("agents", () => {
  let id = "";

  it("creates, updates with optimistic concurrency, and audits", async () => {
    const created = await call("POST", "/ai-agents/agents", MANAGE, agentBody);
    expect(created.status).toBe(201);
    const agent = await json<{ id: string; version: number }>(created);
    id = agent.id;

    const stale = await call("PUT", `/ai-agents/agents/${id}`, MANAGE, { ...agentBody, name: "x", version: 9 });
    expect(stale.status).toBe(409);
    const updated = await call("PUT", `/ai-agents/agents/${id}`, MANAGE, { ...agentBody, name: "Orders assistant", version: agent.version });
    expect(updated.status).toBe(200);
    expect((await json<{ version: number }>(updated)).version).toBe(2);

    const audit = await rawAll(sql`SELECT action FROM rbac_audit_logs WHERE resource_id = ${id} ORDER BY created_at`);
    expect(audit.map((r) => String(r.action))).toEqual(["ai_agent.create", "ai_agent.update"]);
  });

  it("rejects invalid agents with the problems listed", async () => {
    const res = await call("POST", "/ai-agents/agents", MANAGE, { ...agentBody, slug: "bad-tools", tools: ["nope"] });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("not in the catalog");
  });

  it("lists revisions and rolls back", async () => {
    const revisions = await json<{ revisions: Array<{ id: string; version: number }> }>(await call("GET", `/ai-agents/revisions/agent/${id}`, VIEW));
    expect(revisions.revisions.map((r) => r.version)).toEqual([2, 1]);
    const first = revisions.revisions[1];
    expect((await call("POST", `/ai-agents/revisions/${first.id}/rollback`, MANAGE)).status).toBe(200);
    const registry = await json<{ agents: Array<{ id: string; name: string; version: number }> }>(await call("GET", "/ai-agents/registry", VIEW));
    expect(registry.agents.find((a) => a.id === id)).toMatchObject({ name: "Orders helper", version: 3 });
  });

  it("deletes with the current version only", async () => {
    expect((await call("DELETE", `/ai-agents/agents/${id}`, MANAGE)).status).toBe(400);
    expect((await call("DELETE", `/ai-agents/agents/${id}?version=3`, MANAGE)).status).toBe(200);
    expect((await call("DELETE", "/ai-agents/agents/builtin-agent-sql-optimizer?version=1", MANAGE)).status).toBe(400);
  });
});

describe("bindings and reset", () => {
  it("rebinds a feature and audits it", async () => {
    const copy = await json<{ id: string }>(await call("POST", "/ai-agents/agents", MANAGE, {
      ...agentBody,
      slug: "evaluator-terse",
      systemPrompt: "Decide fast.",
      taskTemplate: "Evaluate:\n{{ctx.query}}",
      tools: ["analyze_query"],
    }));
    const res = await call("PUT", "/ai-agents/bindings/check-optimize", MANAGE, { agentId: copy.id });
    expect(res.status).toBe(200);
    const audit = await rawAll(sql`SELECT action FROM rbac_audit_logs WHERE resource_id = 'check-optimize'`);
    expect(audit.map((r) => String(r.action))).toContain("ai_binding.update");
    expect((await call("PUT", "/ai-agents/bindings/check-optimize", MANAGE, { agentId: "builtin-agent-query-evaluator" })).status).toBe(200);
  });

  it("refuses an incompatible binding", async () => {
    const res = await call("PUT", "/ai-agents/bindings/fleet-scan", MANAGE, { agentId: "builtin-agent-clickhouse-data" });
    expect(res.status).toBe(400);
  });

  it("resets a built-in agent", async () => {
    const res = await call("POST", "/ai-agents/agents/builtin-agent-sql-debugger/reset", MANAGE);
    expect(res.status).toBe(200);
    expect((await json<{ customized: boolean }>(res)).customized).toBe(false);
  });
});

describe("prompt preview", () => {
  it("renders a feature agent with placeholder variables and every pinned skill", async () => {
    const registry = await json<{ agents: Array<Record<string, unknown> & { id: string }> }>(await call("GET", "/ai-agents/registry", VIEW));
    const doctor = registry.agents.find((a) => a.id === "builtin-agent-fleet-doctor")!;
    const { id: _id, isSystem: _s, seedHash: _h, customized: _c, version: _v, createdAt: _ca, updatedAt: _u, createdBy: _b, updateAvailable: _ua, usedBy: _ub, ...body } = doctor;
    const preview = await json<{ system: string; task: string; problems: string[] }>(
      await call("POST", "/ai-agents/preview", VIEW, { featureId: "fleet-scan", agentId: doctor.id, agent: body }),
    );
    expect(preview.problems).toEqual([]);
    expect(preview.system).toContain("fleet doctor");
    // needsPlaybook previews as true, so the playbook section is shown.
    expect(preview.system).toContain("argMax");
    expect(preview.task).toContain("«overview»");
  });

  it("reports problems in a draft", async () => {
    const preview = await json<{ problems: string[] }>(
      await call("POST", "/ai-agents/preview", VIEW, { featureId: "check-optimize", agentId: null, agent: { ...agentBody, slug: "draft-x", taskTemplate: "{{ctx.unknown}}" } }),
    );
    expect(preview.problems.join(" ")).toContain("ctx.unknown");
  });
});
