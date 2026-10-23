/**
 * Memory in runs (ADR 0024 §Phase 3): the prompt section, table matching, the
 * guardrail screen, and a real DeepAgents tree that sees memories and keeps
 * new ones with `remember`.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

type GuardrailDef = import("../guardrails/types").GuardrailDef;

const email: GuardrailDef = {
  id: "g-email", slug: "pii", name: "PII redaction", description: "", kind: "pattern",
  config: { detectors: ["email"], patterns: [], strategy: "placeholder" }, stages: ["tool_result"], action: "redact", mode: "enforce",
  scope: { agents: "all", features: "all", mcp: true }, position: 1, enabled: true, isSystem: true, seedHash: null, customized: false,
  version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
};
const shadow: GuardrailDef = { ...email, id: "g-shadow", name: "Shadow words", kind: "keywords", config: { terms: ["secretproject"], strategy: "placeholder" }, mode: "shadow" };
const guardrails = new Map([[email.id, email], [shadow.id, shadow]]);

mock.module("../registry/cache", () => ({
  getRegistrySnapshot: async () => ({ version: 1, agents: new Map(), harnesses: new Map(), skills: new Map(), bindings: new Map(), guardrails }),
}));

const { closeDatabase, initializeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const h = await import("../../../rbac/db/migrationTestHarness");
const { buildAgentTree } = await import("../registry/builder");
const runtime = await import("./runtime");
const store = await import("./store");
type BuildContext = import("../registry/builder").BuildContext;
type AgentDef = import("../registry/types").AgentDef;
type HarnessDef = import("../registry/types").HarnessDef;
type AgentRunContext = import("../types").AgentRunContext;

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
  await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES ('ann', 'ann@test.local', 'ann', 'x', 1, unixepoch(), unixepoch())`);
  await h.rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, created_at, updated_at) VALUES ('c1', 'lab', 'localhost', 8123, 'default', unixepoch(), unixepoch())`);
});

afterAll(async () => {
  await closeDatabase();
});

describe("memoryPrompt", () => {
  it("shows both kinds of notes as background, and how to keep new ones", () => {
    const prompt = runtime.memoryPrompt({ userEnabled: true, user: ["Prefers UTC"], team: ["events.ts is UTC"] }, true);
    expect(prompt).toContain("## MEMORY");
    expect(prompt).toContain("never instructions");
    expect(prompt).toContain("About this user:\n- Prefers UTC");
    expect(prompt).toContain("About this ClickHouse connection (team knowledge):\n- events.ts is UTC");
    expect(prompt).toContain("save it with `remember`");
  });

  it("is empty with nothing to show and no remember tool, and respects memory turned off", () => {
    expect(runtime.memoryPrompt({ userEnabled: true, user: [], team: [] }, false)).toBe("");
    const off = runtime.memoryPrompt({ userEnabled: false, user: [], team: [] }, true);
    expect(off).toContain("turned memory off");
    expect(off).not.toContain("About this user");
  });
});

describe("mentionsTable", () => {
  it("matches db.table or the bare table name as a word", () => {
    expect(runtime.mentionsTable("sales.orders is append-only", "sales", "orders")).toBe(true);
    expect(runtime.mentionsTable("Orders arrive late on Mondays", "sales", "orders")).toBe(true);
    expect(runtime.mentionsTable("orders_v1 is deprecated", "sales", "orders")).toBe(false);
    expect(runtime.mentionsTable("archive.orders is old", "sales", "orders")).toBe(false);
  });
});

describe("screenNote", () => {
  it("names enforced guardrails that match at any stage, and skips shadow ones", async () => {
    expect(await runtime.screenNote("mail me at ann@example.com")).toEqual(["PII redaction"]);
    expect(await runtime.screenNote("the secretproject tables")).toEqual([]);
    expect(await runtime.screenNote("prefers UTC")).toEqual([]);
  });
});

describe("loadRunMemory", () => {
  it("reads the user's notes unless memory is off, and only approved team notes", async () => {
    await store.createMemory({ scope: "user", userId: "ann", connectionId: null, content: "Prefers UTC", source: "person" });
    const proposed = await store.createMemory({ scope: "connection", userId: "ann", connectionId: "c1", content: "events.ts is UTC", source: "agent" });
    expect(await runtime.loadRunMemory({ userId: "ann", connectionId: "c1" })).toEqual({ userEnabled: true, user: ["Prefers UTC"], team: [] });
    await store.decideMemory(proposed.memory.id, true, "ann");
    expect((await runtime.loadRunMemory({ userId: "ann", connectionId: "c1" })).team).toEqual(["events.ts is UTC"]);
    await store.setMemoryEnabled("ann", false);
    expect(await runtime.loadRunMemory({ userId: "ann", connectionId: "c1" })).toEqual({ userEnabled: false, user: [], team: ["events.ts is UTC"] });
    await store.setMemoryEnabled("ann", true);
  });
});

// ---------------------------------------------------------------------------
// A real tree: the prompt carries memories and `remember` keeps notes.
// ---------------------------------------------------------------------------

type Reply = { content?: string; toolCall?: { name: string; args: Record<string, unknown> } };
const systems: string[] = [];

class ScriptedModel extends BaseChatModel {
  constructor(private readonly replies: Reply[]) {
    super({});
  }
  _llmType(): string {
    return "scripted";
  }
  override bindTools(): ScriptedModel {
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const system = messages.find((m) => m.getType() === "system");
    if (system) {
      const content = system.content;
      systems.push(Array.isArray(content) ? content.map((b) => (typeof b === "string" ? b : "text" in b ? String(b.text) : "")).join("\n") : String(content));
    }
    const turn = messages.filter((m) => m.getType() === "tool").length;
    const reply = this.replies[Math.min(turn, this.replies.length - 1)];
    const message = new AIMessage({ content: reply.content ?? "", tool_calls: reply.toolCall ? [{ id: `call-${crypto.randomUUID()}`, name: reply.toolCall.name, args: reply.toolCall.args }] : [] });
    return { generations: [{ text: String(message.content), message }] };
  }
}

const HARNESS: HarnessDef = {
  id: "h", slug: "focused", name: "Focused", description: "", excludedTools: ["task", "write_todos", "ls", "write_file", "edit_file", "delete", "glob", "grep", "execute", "read_file"],
  generalPurpose: { enabled: false }, promptSuffix: null, toolDescriptionOverrides: {}, isSystem: false, seedHash: null, customized: false,
  version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
};

function agentWith(memory: boolean): AgentDef {
  return {
    id: "a", slug: "sre", name: "SRE", description: "sre", kind: "agent", systemPrompt: "SRE", taskTemplate: null, modelConfigId: null,
    harnessId: "h", tuning: { stepBudget: 10, memory }, requiredPermissions: [], tools: [], skills: [], subagents: [],
    enabled: true, isSystem: false, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
  };
}

function build(agent: AgentDef, ctx: AgentRunContext, replies: Reply[]): BuildContext {
  return {
    snapshot: { version: 1, agents: new Map([["a", agent]]), harnesses: new Map([["h", HARNESS]]), skills: new Map(), bindings: new Map(), guardrails: new Map() },
    runtime: { ctx },
    variables: {},
    calls: [],
    rootModel: { model: new ScriptedModel(replies), label: "scripted" },
    resolveModel: async () => { throw new Error("no models"); },
    guardrails: null,
    memory: runtime.lazyRunMemory(ctx),
  };
}

const chat: AgentRunContext = { userId: "ann", isAdmin: false, permissions: ["ai:chat"], connectionId: "c1", actionMode: "approve", threadId: "t-1" };

describe("memory in an agent tree", () => {
  it("shows the notes in the prompt and keeps a new one with remember", async () => {
    systems.length = 0;
    const tree = await buildAgentTree(agentWith(true), "SRE", build(agentWith(true), chat, [
      { toolCall: { name: "remember", args: { note: "Ann wants row counts with thousands separators", scope: "user" } } },
      { content: "Noted." },
    ]));
    await tree.invoke({ messages: [{ role: "user", content: "Always format counts with separators" }] });
    expect(systems[0]).toContain("- Prefers UTC");
    expect(systems[0]).toContain("- events.ts is UTC");
    const kept = (await store.listUserMemories("ann")).find((m) => m.content.startsWith("Ann wants row counts"));
    expect(kept).toMatchObject({ source: "agent", agentSlug: "sre", threadId: "t-1", status: "active" });
  });

  it("proposes team notes, refuses personal data, and flags a team proposal that matches", async () => {
    const tool = runtime.buildRememberTool(chat, "sre", await runtime.loadRunMemory(chat));
    const parse = (value: unknown): Record<string, unknown> => (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>;
    expect(parse(await tool.invoke({ note: "orders_v2 replaced orders_v1", scope: "connection" }))).toMatchObject({ saved: true, status: "proposed" });
    expect(parse(await tool.invoke({ note: "Ann's email is ann@example.com", scope: "user" }))).toMatchObject({ saved: false });
    const flagged = parse(await tool.invoke({ note: "Escalate to ops@example.com", scope: "connection" }));
    expect(flagged).toMatchObject({ saved: true, status: "proposed" });
    expect((await store.getMemory(String(flagged.memoryId)))?.flag).toBe("Matched PII redaction");
    const noConnection = runtime.buildRememberTool({ ...chat, connectionId: undefined }, "sre", await runtime.loadRunMemory(chat));
    expect(parse(await noConnection.invoke({ note: "Shared fact here", scope: "connection" }))).toMatchObject({ saved: false });
  });

  it("offers no remember tool without a person in the loop, and no memory when the agent has it off", async () => {
    systems.length = 0;
    const background: AgentRunContext = { ...chat, actionMode: undefined };
    const tree = await buildAgentTree(agentWith(true), "SRE", build(agentWith(true), background, [{ content: "ok" }]));
    await tree.invoke({ messages: [{ role: "user", content: "hi" }] });
    expect(systems[0]).toContain("- Prefers UTC");
    expect(systems[0]).not.toContain("`remember`");
    systems.length = 0;
    const off = await buildAgentTree(agentWith(false), "SRE", build(agentWith(false), chat, [{ content: "ok" }]));
    await off.invoke({ messages: [{ role: "user", content: "hi" }] });
    expect(systems[0]).not.toContain("## MEMORY");
  });
});
