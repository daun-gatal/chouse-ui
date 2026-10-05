/**
 * Registry persistence, seed sync, validation and management operations
 * against a real in-memory SQLite metadata DB (ADR 0019).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase, initializeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const { run } = await import("../../observe/db");
const { syncRegistrySeeds } = await import("./seedSync");
const store = await import("./store");
const service = await import("./service");
const { getRegistrySnapshot, resetRegistryCache } = await import("./cache");
const { validateGraph } = await import("./validation");
const { SEED_AGENTS, SEED_BINDINGS, SEED_HARNESSES, SEED_SKILLS } = await import("../seeds");

import type { AgentDef } from "./types";

const ACTOR = "admin-1";

async function wipeRegistry(): Promise<void> {
  for (const table of ["ai_agents", "ai_harnesses", "ai_skills", "ai_feature_bindings", "ai_registry_revisions"]) {
    await run(sql.raw(`DELETE FROM ${table}`));
  }
  resetRegistryCache();
}

function agentInput(overrides: Partial<service.AgentInput> = {}): service.AgentInput {
  return {
    slug: "my-agent",
    name: "My Agent",
    description: "Answers questions about orders",
    kind: "agent",
    systemPrompt: "You help with orders.",
    taskTemplate: null,
    modelConfigId: null,
    harnessId: "builtin-harness-focused",
    tuning: { stepBudget: 6, recursionLimit: null, timeoutMs: null, maxOutputTokens: null },
    requiredPermissions: [],
    tools: ["list_tables"],
    skills: [],
    subagents: [],
    enabled: true,
    ...overrides,
  };
}

function inputOf(agent: AgentDef): service.AgentInput {
  const { id: _i, isSystem: _s, seedHash: _h, customized: _c, version: _v, createdAt: _ca, updatedAt: _u, createdBy: _b, ...input } = agent;
  return input;
}

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
});

afterAll(async () => {
  await closeDatabase();
});

// ============================================
// Seed sync
// ============================================

describe("seed sync", () => {
  beforeEach(wipeRegistry);

  it("inserts every built-in harness, skill, agent and binding", async () => {
    const result = await syncRegistrySeeds();
    expect(result.inserted).toBe(SEED_HARNESSES.length + SEED_SKILLS.length + SEED_AGENTS.length);
    expect(result.bindingsRestored).toBe(Object.keys(SEED_BINDINGS).length);
    const snapshot = await store.loadSnapshot();
    expect(snapshot.agents.size).toBe(SEED_AGENTS.length);
    expect(snapshot.skills.size).toBe(14);
    expect([...snapshot.agents.values()].every((a) => a.isSystem && !a.customized)).toBe(true);
  });

  it("produces a registry with no validation problems", async () => {
    await syncRegistrySeeds();
    expect(validateGraph(await store.loadSnapshot())).toEqual([]);
  });

  it("is a no-op on the second run", async () => {
    await syncRegistrySeeds();
    const version = await store.getRegistryVersion();
    const again = await syncRegistrySeeds();
    expect(again).toEqual({ inserted: 0, upgraded: 0, updateAvailable: 0, bindingsRestored: 0 });
    expect(await store.getRegistryVersion()).toBe(version);
  });

  it("upgrades uncustomized built-ins whose shipped definition changed, keeping the enable switch", async () => {
    await syncRegistrySeeds();
    await run(sql`UPDATE ai_agents SET seed_hash = 'old', system_prompt = 'stale', enabled = 0 WHERE id = 'builtin-agent-sql-optimizer'`);
    const result = await syncRegistrySeeds();
    expect(result.upgraded).toBe(1);
    const agent = (await store.loadSnapshot()).agents.get("builtin-agent-sql-optimizer")!;
    expect(agent.systemPrompt).not.toBe("stale");
    expect(agent.enabled).toBe(false);
  });

  it("never overwrites a customized built-in and reports the available update", async () => {
    await syncRegistrySeeds();
    await run(sql`UPDATE ai_agents SET seed_hash = 'old', system_prompt = 'mine', customized = 1 WHERE id = 'builtin-agent-sql-debugger'`);
    const result = await syncRegistrySeeds();
    expect(result.updateAvailable).toBe(1);
    expect((await store.loadSnapshot()).agents.get("builtin-agent-sql-debugger")!.systemPrompt).toBe("mine");
  });

  it("restores a missing or dangling feature binding", async () => {
    await syncRegistrySeeds();
    await run(sql`DELETE FROM ai_feature_bindings WHERE feature_id = 'fleet-scan'`);
    await run(sql`UPDATE ai_feature_bindings SET agent_id = 'gone' WHERE feature_id = 'chat'`);
    const result = await syncRegistrySeeds();
    expect(result.bindingsRestored).toBe(2);
    const snapshot = await store.loadSnapshot();
    expect(snapshot.bindings.get("fleet-scan")!.agentId).toBe("builtin-agent-fleet-doctor");
    expect(snapshot.bindings.get("chat")!.agentId).toBe("builtin-agent-clickhouse-data");
  });
});

// ============================================
// Store
// ============================================

describe("store", () => {
  beforeEach(async () => {
    await wipeRegistry();
    await syncRegistrySeeds();
  });

  it("bumps the registry version and records a revision on every write", async () => {
    const before = await store.getRegistryVersion();
    const created = await service.createAgent(agentInput(), ACTOR);
    expect(await store.getRegistryVersion()).toBe(before + 1);
    const revisions = await store.listRevisions("agent", created.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ action: "create", actor: ACTOR, version: 1 });
  });

  it("rejects a stale write (optimistic concurrency)", async () => {
    const created = await service.createAgent(agentInput(), ACTOR);
    await service.updateAgent(created.id, { ...inputOf(created), name: "First" }, 1, ACTOR);
    await expect(service.updateAgent(created.id, { ...inputOf(created), name: "Second" }, 1, ACTOR)).rejects.toThrow("changed by someone else");
  });

  it("serves a fresh snapshot after any write", async () => {
    const first = await getRegistrySnapshot();
    const created = await service.createAgent(agentInput(), ACTOR);
    const second = await getRegistrySnapshot();
    expect(first.agents.has(created.id)).toBe(false);
    expect(second.agents.has(created.id)).toBe(true);
    expect(await getRegistrySnapshot()).toBe(second);
  });
});

// ============================================
// Management operations and validation
// ============================================

describe("agents", () => {
  beforeEach(async () => {
    await wipeRegistry();
    await syncRegistrySeeds();
  });

  it("creates a valid agent", async () => {
    const agent = await service.createAgent(agentInput(), ACTOR);
    expect(agent).toMatchObject({ slug: "my-agent", isSystem: false, customized: false, version: 1 });
  });

  it("rejects unknown tools, duplicate slugs and bad tuning", async () => {
    await expect(service.createAgent(agentInput({ tools: ["drop_everything"] }), ACTOR)).rejects.toThrow("not in the catalog");
    await expect(service.createAgent(agentInput({ slug: "sql-optimizer" }), ACTOR)).rejects.toThrow("already used");
    await expect(service.createAgent(agentInput({ tuning: { stepBudget: 0, recursionLimit: null, timeoutMs: null, maxOutputTokens: null } }), ACTOR)).rejects.toThrow("stepBudget");
    await expect(service.createAgent(agentInput({ slug: "general-purpose" }), ACTOR)).rejects.toThrow("reserved");
  });

  it("rejects subagents under a harness that hides the task tool, and cycles", async () => {
    const child = await service.createAgent(agentInput({ slug: "child" }), ACTOR);
    await expect(service.createAgent(agentInput({ slug: "parent", subagents: [child.id] }), ACTOR)).rejects.toThrow("hides the task tool");
    const parent = await service.createAgent(agentInput({ slug: "parent", harnessId: "builtin-harness-delegating", subagents: [child.id] }), ACTOR);
    await expect(service.updateAgent(child.id, { ...inputOf(child), harnessId: "builtin-harness-delegating", subagents: [parent.id] }, child.version, ACTOR)).rejects.toThrow("cycle");
  });

  it("rejects template variables on chat agents and unknown skill tokens", async () => {
    await expect(service.createAgent(agentInput({ systemPrompt: "Hi {{ctx.query}}" }), ACTOR)).rejects.toThrow("task template");
    await expect(service.createAgent(agentInput({ systemPrompt: "{{skill:nope}}" }), ACTOR)).rejects.toThrow("unknown or disabled skill");
  });

  it("marks a built-in as customized on content edits but not on the enable switch", async () => {
    const snapshot = await store.loadSnapshot();
    const builtin = snapshot.agents.get("builtin-agent-chouse-admin")!;
    const toggled = await service.updateAgent(builtin.id, { ...inputOf(builtin), enabled: false }, builtin.version, ACTOR);
    expect(toggled.customized).toBe(false);
    const edited = await service.updateAgent(builtin.id, { ...inputOf(toggled), systemPrompt: `${builtin.systemPrompt}\nBe brief.` }, toggled.version, ACTOR);
    expect(edited.customized).toBe(true);
    const reset = await service.resetAgent(builtin.id, ACTOR);
    expect(reset).toMatchObject({ customized: false, systemPrompt: builtin.systemPrompt, enabled: false });
  });

  it("refuses to delete built-ins and agents still in use", async () => {
    await expect(service.deleteAgent("builtin-agent-sql-optimizer", 1, ACTOR)).rejects.toThrow("cannot be deleted");
    const child = await service.createAgent(agentInput({ slug: "child" }), ACTOR);
    await service.createAgent(agentInput({ slug: "parent", harnessId: "builtin-harness-delegating", subagents: [child.id] }), ACTOR);
    await expect(service.deleteAgent(child.id, child.version, ACTOR)).rejects.toThrow("still used");
  });

  it("rolls an agent back to an earlier revision, and recreates a deleted one", async () => {
    const created = await service.createAgent(agentInput(), ACTOR);
    const updated = await service.updateAgent(created.id, { ...inputOf(created), name: "Renamed" }, created.version, ACTOR);
    const [latest, original] = await store.listRevisions("agent", created.id);
    expect(latest.version).toBe(2);
    await service.rollback(original.id, ACTOR);
    expect((await store.loadSnapshot()).agents.get(created.id)!.name).toBe("My Agent");

    await service.deleteAgent(created.id, updated.version + 1, ACTOR);
    expect((await store.loadSnapshot()).agents.has(created.id)).toBe(false);
    await service.rollback(original.id, ACTOR);
    expect((await store.loadSnapshot()).agents.get(created.id)!.name).toBe("My Agent");
  });
});

describe("bindings", () => {
  beforeEach(async () => {
    await wipeRegistry();
    await syncRegistrySeeds();
  });

  it("rebinds a feature to a compatible agent", async () => {
    const snapshot = await store.loadSnapshot();
    const seeded = snapshot.agents.get("builtin-agent-sql-optimizer")!;
    const copy = await service.createAgent({ ...inputOf(seeded), slug: "sql-optimizer-terse", name: "Terse optimizer" }, ACTOR);
    const binding = await service.bindFeature("optimize-query", copy.id, ACTOR);
    expect(binding.agentId).toBe(copy.id);
  });

  it("refuses a chat agent for a structured feature and a feature agent for the chat", async () => {
    await expect(service.bindFeature("optimize-query", "builtin-agent-clickhouse-data", ACTOR)).rejects.toThrow("task template");
    await expect(service.bindFeature("chat", "builtin-agent-sql-optimizer", ACTOR)).rejects.toThrow("chat agent");
  });

  it("refuses an agent whose tools need a context the feature does not provide", async () => {
    // The fleet doctor scans in the background: no ClickHouse session tools.
    const snapshot = await store.loadSnapshot();
    const doctor = snapshot.agents.get("builtin-agent-fleet-doctor")!;
    const copy = await service.createAgent({ ...inputOf(doctor), slug: "doctor-with-sql", tools: ["query_node", "run_select_query"] }, ACTOR);
    await expect(service.bindFeature("fleet-scan", copy.id, ACTOR)).rejects.toThrow("session context");
  });

  it("refuses a task template that uses variables the feature does not supply", async () => {
    const snapshot = await store.loadSnapshot();
    const seeded = snapshot.agents.get("builtin-agent-query-evaluator")!;
    const copy = await service.createAgent({ ...inputOf(seeded), slug: "evaluator-copy", taskTemplate: "Evaluate {{ctx.query}} on {{ctx.node.id}}" }, ACTOR);
    await expect(service.bindFeature("check-optimize", copy.id, ACTOR)).rejects.toThrow("ctx.node.id");
  });
});

describe("harnesses and skills", () => {
  beforeEach(async () => {
    await wipeRegistry();
    await syncRegistrySeeds();
  });

  it("validates harness tool names", async () => {
    await expect(service.createHarness({ slug: "x-harness", name: "X", description: "", excludedTools: ["rm_rf"], generalPurpose: { enabled: false }, promptSuffix: null, toolDescriptionOverrides: {} }, ACTOR)).rejects.toThrow("not a built-in");
    const harness = await service.createHarness({ slug: "x-harness", name: "X", description: "", excludedTools: ["write_todos"], generalPurpose: { enabled: false }, promptSuffix: "Be terse.", toolDescriptionOverrides: { list_tables: "List tables." } }, ACTOR);
    expect(harness.version).toBe(1);
    await expect(service.deleteHarness("builtin-harness-focused", 1, ACTOR)).rejects.toThrow("cannot be deleted");
  });

  it("derives a skill's name and description from its SKILL.md and rejects mismatches", async () => {
    const skill = await service.createSkill({ path: "custom/orders", skillMd: "---\nname: orders-glossary\ndescription: Order terms\n---\n\nBody", files: { "reference.md": "# Terms" }, enabled: true }, ACTOR);
    expect(skill).toMatchObject({ name: "orders-glossary", description: "Order terms" });
    await expect(service.createSkill({ path: "custom/orders", skillMd: "---\nname: other\ndescription: x\n---\n", files: {}, enabled: true }, ACTOR)).rejects.toThrow("already used");
    await expect(service.createSkill({ path: "custom/bad", skillMd: "no front matter", files: {}, enabled: true }, ACTOR)).rejects.toThrow("front matter");
  });

  it("keeps a skill that an agent inlines from being deleted or disabled", async () => {
    const skill = await service.createSkill({ path: "custom/glossary", skillMd: "---\nname: glossary\ndescription: Terms\n---\n\nBody", files: {}, enabled: true }, ACTOR);
    await service.createAgent(agentInput({ systemPrompt: "Use: {{skill:glossary}}" }), ACTOR);
    await expect(service.deleteSkill(skill.id, skill.version, ACTOR)).rejects.toThrow("still used");
    await expect(service.updateSkill(skill.id, { path: skill.path, skillMd: skill.skillMd, files: {}, enabled: false }, skill.version, ACTOR)).rejects.toThrow("unknown or disabled skill");
  });

  it("resets a customized built-in skill", async () => {
    const snapshot = await store.loadSnapshot();
    const builtin = snapshot.skills.get("builtin-skill-clickhouse-playbook")!;
    const edited = await service.updateSkill(builtin.id, { path: builtin.path, skillMd: builtin.skillMd, files: { ...builtin.files, "reference.md": "trimmed" }, enabled: true }, builtin.version, ACTOR);
    expect(edited.customized).toBe(true);
    const reset = await service.resetSkill(builtin.id, ACTOR);
    expect(reset.customized).toBe(false);
    expect(reset.files["reference.md"]).toBe(builtin.files["reference.md"]);
  });
});
