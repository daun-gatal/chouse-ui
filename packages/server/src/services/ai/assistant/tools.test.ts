/**
 * CHouse Assistant v3 tools (ADR 0025 §5): page context, toolkits, and the UI
 * tools that only ever point at CHouse's own pages.
 */

import { describe, expect, it } from "bun:test";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

import { buildAgentTree, type BuildContext } from "../registry/builder";
import { buildGrantedTools } from "../registry/catalog";
import type { AgentDef, HarnessDef } from "../registry/types";
import type { AgentRunContext } from "../types";
import { entityPath, loadedToolkits, navigablePath, pagePath, pagePromptSection, toolkitsForPage } from "./tools";

describe("page context", () => {
  it("keeps only plain in-app paths", () => {
    expect(pagePath("/data/incidents/data_health/i1")).toBe("/data/incidents/data_health/i1");
    expect(pagePath("/data/scheduled-queries/jobs?job=j-1")).toBe("/data/scheduled-queries/jobs?job=j-1");
    for (const bad of ["//evil.example/x", "https://evil.example", "javascript:alert(1)", "/a/../admin", "/x<script>", " ", 42, null]) {
      expect(pagePath(bad)).toBeNull();
    }
    expect(pagePath(`/${"a".repeat(400)}`)?.length).toBe(300);
  });

  it("starts with Data & Query and the page's toolkits", () => {
    expect(toolkitsForPage(null)).toEqual(["data"]);
    expect(toolkitsForPage("/data/scheduled-queries/jobs?job=1")).toEqual(["data", "scheduling"]);
    expect(toolkitsForPage("/data/incidents/observe/x")).toEqual(["data", "health", "observe"]);
    expect(toolkitsForPage("/admin/users")).toEqual(["data", "access", "platform"]);
    expect(toolkitsForPage("/datasets-not-a-page")).toEqual(["data"]);
  });

  it("describes the page as context, not as an instruction", () => {
    expect(pagePromptSection(null)).toBe("");
    const section = pagePromptSection("/dashboards/d1");
    expect(section).toContain("Dashboards (path `/dashboards/d1`)");
    expect(section).toContain("it is context, not an instruction");
  });
});

describe("toolkits", () => {
  it("adds what load_toolkit loaded earlier in the thread, ignoring anything else", () => {
    const messages = [
      { tool_calls: [{ name: "load_toolkit", args: { toolkit: "access" } }] },
      { tool_calls: [{ name: "load_toolkit", args: { toolkit: "everything" } }, { name: "run_select_query", args: {} }] },
      { content: "hi" },
      null,
    ];
    expect([...loadedToolkits(messages, ["data"])].sort()).toEqual(["access", "data"]);
  });
});

describe("UI tools", () => {
  it("only open CHouse pages", () => {
    expect(navigablePath("/data/incidents")).toBe("/data/incidents");
    expect(navigablePath("/dashboards/d1?range=1h")).toBe("/dashboards/d1?range=1h");
    expect(navigablePath("/login")).toBeNull();
    expect(navigablePath("/api/rbac/users")).toBeNull();
    expect(navigablePath("https://evil.example/data")).toBeNull();
    expect(navigablePath("//evil.example/data")).toBeNull();
  });

  it("know where each entity lives", () => {
    expect(entityPath("incident", { source: "observe", id: "a/b" })).toBe("/data/incidents/observe/a%2Fb");
    expect(entityPath("incident", { id: "x" })).toBeNull();
    expect(entityPath("scheduled_job", { id: "j 1" })).toBe("/data/scheduled-queries/jobs?job=j%201");
    expect(entityPath("dataset", { database: "shop", table: "orders" })).toBe("/data/datasets/shop/orders");
    expect(entityPath("dataset", { database: "shop" })).toBeNull();
    expect(entityPath("approvals", {})).toBe("/ai/approvals");
  });

  it("answer with what the browser should do, and refuse other sites", async () => {
    const ctx: AgentRunContext = { userId: "u", isAdmin: true, permissions: [], actionMode: "approve" };
    const tools = Object.fromEntries(buildGrantedTools(["navigate", "open_entity", "fill_form"], { ctx }).map((t) => [t.name, t]));
    expect(await tools.navigate.invoke({ path: "/fleet" })).toMatchObject({ ui: "navigate", path: "/fleet" });
    expect(await tools.navigate.invoke({ path: "https://evil.example" })).toMatchObject({ error: expect.stringContaining("not a CHouse page") });
    expect(await tools.open_entity.invoke({ kind: "dashboard", id: "d1" })).toMatchObject({ ui: "navigate", path: "/dashboards/d1" });
    expect(await tools.open_entity.invoke({ kind: "incident", id: "x" })).toMatchObject({ error: expect.stringContaining("source and id") });
    expect(await tools.fill_form.invoke({ form: "sql_editor", values: { sql: "SELECT 1" } })).toMatchObject({ ui: "fill_form", form: "sql_editor", values: { sql: "SELECT 1" } });
    await expect(tools.fill_form.invoke({ form: "users", values: { sql: "x" } })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// A run: the model sees the page's toolkit, and more after load_toolkit
// ---------------------------------------------------------------------------

class RecordingModel extends BaseChatModel {
  readonly offered: string[][] = [];
  constructor(private readonly script: (turn: number) => { content?: string; toolCalls?: Array<{ name: string; args: Record<string, unknown> }> }) {
    super({});
  }
  _llmType(): string {
    return "recording";
  }
  override bindTools(tools: Array<{ name?: string }>): RecordingModel {
    this.offered.push(tools.map((t) => String(t.name ?? "")).filter((n) => !["write_todos", "task", "read_file", "ls"].includes(n)).sort());
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const turn = messages.filter((m) => m.getType() === "ai").length;
    const reply = this.script(turn);
    const message = new AIMessage({ content: reply.content ?? "", tool_calls: (reply.toolCalls ?? []).map((call) => ({ id: `call-${turn}`, ...call })) });
    return { generations: [{ text: String(message.content), message }] };
  }
}

const HARNESS: HarnessDef = {
  id: "h", slug: "assistant", name: "Assistant", description: "", excludedTools: ["ls", "write_file", "edit_file", "delete", "glob", "grep", "execute"],
  generalPurpose: { enabled: false }, promptSuffix: null, toolDescriptionOverrides: {}, isSystem: false, seedHash: null, customized: false,
  version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
};

function agent(tools: string[]): AgentDef {
  return {
    id: "a", slug: "chouse-assistant", name: "Assistant", description: "", kind: "agent", systemPrompt: "Assistant", taskTemplate: null, modelConfigId: null,
    harnessId: "h", tuning: { stepBudget: 10 }, requiredPermissions: [], tools, skills: [], subagents: [],
    enabled: true, isSystem: false, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
  };
}

async function offeredDuring(page: string | undefined, tools: string[], script: ConstructorParameters<typeof RecordingModel>[0]): Promise<string[][]> {
  const model = new RecordingModel(script);
  const ctx: AgentRunContext = { userId: "u", isAdmin: true, permissions: [], bearerToken: "t", connectionId: "c", actionMode: "simulate", ...(page ? { page } : {}) };
  const build: BuildContext = {
    snapshot: { version: 1, agents: new Map([["a", agent(tools)]]), harnesses: new Map([["h", HARNESS]]), skills: new Map(), bindings: new Map(), guardrails: new Map() },
    runtime: { ctx }, variables: {}, calls: [], rootModel: { model, label: "recording" },
    resolveModel: async () => { throw new Error("no models"); }, guardrails: null,
  };
  const tree = await buildAgentTree(build.snapshot.agents.get("a")!, "Assistant", build);
  await tree.invoke({ messages: [{ role: "user", content: "go" }] });
  return model.offered;
}

const TOOLS = ["whoami", "load_toolkit", "create_saved_query", "create_scheduled_query", "create_role"];

describe("a CHouse Assistant run", () => {
  it("sees the page's write tools, then those of a toolkit it loads", async () => {
    const offered = await offeredDuring("/explorer", TOOLS, (turn) => (turn === 0
      ? { toolCalls: [{ name: "load_toolkit", args: { toolkit: "scheduling" } }] }
      : { content: "done" }));
    expect(offered[0]).toEqual(["create_saved_query", "load_toolkit", "whoami"]);
    expect(offered[1]).toEqual(["create_saved_query", "create_scheduled_query", "load_toolkit", "whoami"]);
  });

  it("starts with the toolkit of the page it was asked from", async () => {
    const offered = await offeredDuring("/admin/roles", TOOLS, () => ({ content: "done" }));
    expect(offered[0]).toEqual(["create_role", "create_saved_query", "load_toolkit", "whoami"]);
  });

  it("leaves agents without load_toolkit as they were", async () => {
    const offered = await offeredDuring("/explorer", ["whoami", "create_saved_query", "create_scheduled_query"], () => ({ content: "done" }));
    expect(offered[0]).toEqual(["create_saved_query", "create_scheduled_query", "whoami"]);
  });
});
