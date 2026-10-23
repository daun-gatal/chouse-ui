/**
 * Approved actions end to end through real DeepAgents trees (ADR 0024
 * §Phase 2): a chat run pauses before a write tool, the approved (or edited)
 * call reaches the CHouse route once, a rejected one never does; runs with no
 * person in the loop only record a pending action.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { Command } from "@langchain/langgraph";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase, initializeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const { registerInProcessApi } = await import("../registry/inProcessApi");
const { buildAgentTree } = await import("../registry/builder");
const { ChouseCheckpointSaver } = await import("../runtime/checkpointer");
const store = await import("./store");
type BuildContext = import("../registry/builder").BuildContext;
type AgentDef = import("../registry/types").AgentDef;
type HarnessDef = import("../registry/types").HarnessDef;
type AgentRunContext = import("../types").AgentRunContext;

const kills: Array<{ queryId: string; userAgent: string | undefined }> = [];
const api = new Hono();
api.post("/api/live-queries/kill", async (c) => {
  const body = (await c.req.json()) as { queryId: string };
  kills.push({ queryId: body.queryId, userAgent: c.req.header("User-Agent") });
  return c.json({ success: true, data: { killed: true, message: `Killed ${body.queryId}` } });
});

type Reply = { content?: string; toolCall?: { name: string; args: Record<string, unknown> } };

class ScriptedModel extends BaseChatModel {
  constructor(private readonly script: (messages: BaseMessage[]) => Reply) {
    super({});
  }
  _llmType(): string {
    return "scripted";
  }
  override bindTools(): ScriptedModel {
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const reply = this.script(messages);
    const message = new AIMessage({ content: reply.content ?? "", tool_calls: reply.toolCall ? [{ id: `call-${crypto.randomUUID()}`, name: reply.toolCall.name, args: reply.toolCall.args }] : [] });
    return { generations: [{ text: String(message.content), message }] };
  }
}

const textOf = (content: unknown): string => (Array.isArray(content)
  ? content.map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : "")).join("")
  : String(content));
const toolResults = (messages: BaseMessage[]): string[] => messages.filter((m) => m.getType() === "tool").map((m) => textOf(m.content));

const killScript = (messages: BaseMessage[]): Reply => {
  const results = toolResults(messages);
  return results.length > 0 ? { content: `result: ${results.join(" | ")}` } : { toolCall: { name: "kill_query", args: { queryId: "q-7" } } };
};

const HARNESS: HarnessDef = {
  id: "h", slug: "focused", name: "Focused", description: "", excludedTools: ["task", "write_todos", "ls", "write_file", "edit_file", "delete", "glob", "grep", "execute"],
  generalPurpose: { enabled: false }, promptSuffix: null, toolDescriptionOverrides: {}, isSystem: false, seedHash: null, customized: false,
  version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
};

const AGENT: AgentDef = {
  id: "a", slug: "sre", name: "SRE", description: "sre", kind: "agent", systemPrompt: "SRE", taskTemplate: null, modelConfigId: null,
  harnessId: "h", tuning: { stepBudget: 10 }, requiredPermissions: [], tools: ["kill_query"], skills: [], subagents: [],
  enabled: true, isSystem: false, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
};

function build(ctx: AgentRunContext, checkpointer = true): BuildContext {
  return {
    snapshot: { version: 1, agents: new Map([["a", AGENT]]), harnesses: new Map([["h", HARNESS]]), skills: new Map(), bindings: new Map(), guardrails: new Map() },
    runtime: { ctx },
    variables: {},
    calls: [],
    rootModel: { model: new ScriptedModel(killScript), label: "scripted" },
    resolveModel: async () => { throw new Error("no models"); },
    guardrails: null,
    ...(checkpointer ? { checkpointer: new ChouseCheckpointSaver() } : {}),
  };
}

function chatCtx(runId: string, extra: Partial<AgentRunContext> = {}): AgentRunContext {
  return { userId: "alice", isAdmin: false, permissions: ["ai:act", "live_queries:kill"], connectionId: "conn-1", bearerToken: "token", actionMode: "approve", runId, ...extra };
}

async function pause(runId: string, ctx: AgentRunContext): Promise<{ id: string; args: Record<string, unknown> }> {
  const tree = await buildAgentTree(AGENT, "SRE", build(ctx));
  const state = await tree.invoke({ messages: [{ role: "user", content: "kill the runaway query" }] }, { configurable: { thread_id: runId } });
  const interrupts = (state as { __interrupt__?: Array<{ id: string; value: { name: string; args: Record<string, unknown>; description: string } }> }).__interrupt__ ?? [];
  expect(interrupts.map((i) => i.value.name)).toEqual(["kill_query"]);
  expect(interrupts[0].value.description).toBe(`KILL QUERY WHERE query_id = "q-7"`);
  return { id: interrupts[0].id, args: interrupts[0].value.args };
}

async function resume(runId: string, ctx: AgentRunContext, decision: unknown): Promise<string> {
  const tree = await buildAgentTree(AGENT, "SRE", build(ctx));
  const state = await tree.invoke(new Command({ resume: decision }), { configurable: { thread_id: runId } });
  return textOf((state as { messages: BaseMessage[] }).messages.at(-1)?.content);
}

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
  registerInProcessApi(api);
});

afterAll(async () => {
  await closeDatabase();
});

describe("approved actions in a chat run", () => {
  it("pauses before the call, then runs it once as the user after approval", async () => {
    kills.length = 0;
    await pause("run-approve", chatCtx("run-approve"));
    expect(kills).toEqual([]);
    const action = await store.createAction({ source: "chat", runId: "run-approve", userId: "alice", tool: "kill_query", args: { queryId: "q-7" }, description: "kill" });
    await store.decideAction(action.id, "approved", "alice");
    const answer = await resume("run-approve", chatCtx("run-approve"), { type: "approve" });
    expect(kills).toEqual([{ queryId: "q-7", userAgent: "chouse-assistant/1" }]);
    expect(answer).toContain("Killed q-7");
    expect(await store.getAction(action.id)).toMatchObject({ status: "executed", result: { killed: true, message: "Killed q-7" } });
  });

  it("runs the edited call instead of the proposed one", async () => {
    kills.length = 0;
    await pause("run-edit", chatCtx("run-edit"));
    await resume("run-edit", chatCtx("run-edit"), { type: "edit", edited_action: { name: "kill_query", args: { queryId: "q-8" } } });
    expect(kills.map((k) => k.queryId)).toEqual(["q-8"]);
  });

  it("never runs a rejected call and tells the agent why", async () => {
    kills.length = 0;
    await pause("run-reject", chatCtx("run-reject"));
    const answer = await resume("run-reject", chatCtx("run-reject"), { type: "reject", message: "Not during the backfill." });
    expect(kills).toEqual([]);
    expect(answer).toContain("Not during the backfill.");
  });

  it("refuses to run an approved call for a user without ai:act", async () => {
    kills.length = 0;
    const ctx = chatCtx("run-noact", { permissions: ["live_queries:kill"] });
    await pause("run-noact", ctx);
    const answer = await resume("run-noact", ctx, { type: "approve" });
    expect(kills).toEqual([]);
    expect(answer).toContain("ai:act");
  });
});

describe("write tools without a person in the loop", () => {
  it("records a pending background action and never calls the route", async () => {
    kills.length = 0;
    const tree = await buildAgentTree(AGENT, "SRE", build({ userId: "alice", isAdmin: true, connectionId: "conn-1" }, false));
    const state = await tree.invoke({ messages: [{ role: "user", content: "kill it" }] });
    expect((state as { __interrupt__?: unknown[] }).__interrupt__).toBeUndefined();
    expect(kills).toEqual([]);
    expect(textOf((state as { messages: BaseMessage[] }).messages.at(-1)?.content)).toContain("Waiting for approval");
    const pending = await store.listActions({ userId: "alice", source: "background", status: "pending" });
    expect(pending.map((a) => [a.tool, a.args])).toEqual([["kill_query", { queryId: "q-7" }]]);
  });

  it("records an auto-triage proposal for the rule's owner when the run has no user", async () => {
    kills.length = 0;
    const tree = await buildAgentTree(AGENT, "SRE", build({ isAdmin: false, permissions: ["live_queries:kill"], connectionId: "conn-1", proposeAs: "rule-owner" }, false));
    await tree.invoke({ messages: [{ role: "user", content: "kill it" }] });
    expect(kills).toEqual([]);
    const pending = await store.listActions({ userId: "rule-owner", source: "background", status: "pending" });
    expect(pending.map((a) => [a.tool, a.connectionId])).toEqual([["kill_query", "conn-1"]]);
  });

  it("offers no write tool to a run with neither a user nor an owner", async () => {
    const tree = await buildAgentTree(AGENT, "SRE", build({ isAdmin: true, connectionId: "conn-1" }, false));
    const state = await tree.invoke({ messages: [{ role: "user", content: "kill it" }] });
    expect(textOf((state as { messages: BaseMessage[] }).messages.at(-1)?.content)).not.toContain("Waiting for approval");
  });
});
