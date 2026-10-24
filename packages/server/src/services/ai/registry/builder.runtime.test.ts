/**
 * ADR 0024 runtime settings through real DeepAgents trees: skill-scoped tools
 * stay hidden until the skill is read, a forked subagent sees the parent's
 * conversation, the fallback model answers when the primary fails, and tool
 * events report every call.
 */
import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { tool, type StructuredTool } from "@langchain/core/tools";

mock.module("./catalog", () => ({
  catalogTool: () => undefined,
  buildGrantedTools: (names: string[]) => names.map((name) => tool(async () => `${name} result`, { name, description: `the ${name} tool`, schema: z.object({}) }) as unknown as StructuredTool),
}));

const { buildAgentTree } = await import("./builder");
type BuildContext = import("./builder").BuildContext;
type ToolEvent = import("./builder").ToolEvent;
type AgentDef = import("./types").AgentDef;
type HarnessDef = import("./types").HarnessDef;
type SkillDef = import("./types").SkillDef;

type Reply = { content?: string; toolCall?: { name: string; args: Record<string, unknown> } };
type Script = (messages: BaseMessage[], tools: string[]) => Reply;

class ScriptedModel extends BaseChatModel {
  seenTools: string[][] = [];
  constructor(private readonly script: Script, private readonly fail = false, private bound: string[] = []) {
    super({});
  }
  _llmType(): string {
    return "scripted";
  }
  override bindTools(tools: Array<{ name?: string }>): ScriptedModel {
    const next = new ScriptedModel(this.script, this.fail, tools.map((t) => t.name ?? ""));
    next.seenTools = this.seenTools;
    return next;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    if (this.fail) throw new Error("503 Service Unavailable");
    this.seenTools.push(this.bound);
    const reply = this.script(messages, this.bound);
    const message = new AIMessage({ content: reply.content ?? "", tool_calls: reply.toolCall ? [{ id: `call-${crypto.randomUUID()}`, name: reply.toolCall.name, args: reply.toolCall.args }] : [] });
    return { generations: [{ text: String(message.content), message }] };
  }
}

const textOf = (content: unknown): string => (Array.isArray(content)
  ? content.map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text: unknown }).text) : "")).join("")
  : String(content));
const toolResults = (messages: BaseMessage[]): string[] => messages.filter((m) => m.getType() === "tool").map((m) => textOf(m.content));

const HARNESS: HarnessDef = {
  id: "h", slug: "open", name: "Open", description: "", excludedTools: ["write_todos", "write_file", "edit_file", "delete", "execute"],
  generalPurpose: { enabled: false }, promptSuffix: null, toolDescriptionOverrides: {}, isSystem: false, seedHash: null, customized: false,
  version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
};

function agent(overrides: Partial<AgentDef>): AgentDef {
  return {
    id: "root", slug: "root", name: "Root", description: "root agent", kind: "agent", systemPrompt: "ROOT", taskTemplate: null,
    modelConfigId: null, harnessId: "h", tuning: { stepBudget: 10 }, requiredPermissions: [], tools: [], skills: [], subagents: [],
    enabled: true, isSystem: false, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

const SKILL: SkillDef = {
  id: "s1", name: "tuning", path: "ai-chat/tuning", description: "Tune queries",
  skillMd: "---\nname: tuning\ndescription: Tune queries\nmetadata:\n  include_tools: explain_query\n---\nUse explain_query.\n",
  files: {}, enabled: true, isSystem: false, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
};

function context(agents: AgentDef[], model: BaseChatModel, extra: Partial<BuildContext> = {}): BuildContext {
  return {
    snapshot: {
      version: 1,
      agents: new Map(agents.map((a) => [a.id, a])),
      harnesses: new Map([["h", HARNESS]]),
      skills: new Map([["s1", SKILL]]),
      bindings: new Map(),
      guardrails: new Map(),
    },
    runtime: { ctx: {} },
    variables: {},
    calls: [],
    rootModel: { model, label: "primary" },
    resolveModel: async () => { throw new Error("no other models"); },
    guardrails: null,
    ...extra,
  };
}

describe("skill-scoped tools", () => {
  it("hides a skill's tools until the agent reads the skill, then runs them", async () => {
    const script: Script = (messages, tools) => {
      const results = toolResults(messages);
      if (results.some((r) => r.includes("explain_query result"))) return { content: "done" };
      if (results.some((r) => r.includes("Use explain_query"))) return { toolCall: { name: "explain_query", args: {} } };
      return { toolCall: { name: "read_file", args: { file_path: "/skills/ai-chat/tuning/SKILL.md" } } };
    };
    const model = new ScriptedModel(script);
    const events: ToolEvent[] = [];
    const root = agent({ tools: ["list_tables", "explain_query"], skills: [{ skillId: "s1", mode: "progressive", pinnedFile: null }] });
    const build = context([root], model, { onToolEvent: (e) => events.push(e) });
    const tree = await buildAgentTree(root, "ROOT", build);
    const result = await tree.invoke({ messages: [{ role: "user", content: "tune this" }] });

    expect(String((result as { messages: BaseMessage[] }).messages.at(-1)?.content)).toBe("done");
    expect(model.seenTools[0]).toContain("list_tables");
    expect(model.seenTools[0]).not.toContain("explain_query");
    expect(model.seenTools.at(-1)).toContain("explain_query");
    expect(build.calls.map((c) => c.name)).toEqual(["explain_query"]);
    expect(events.map((e) => [e.type, e.name])).toEqual([["tool_start", "explain_query"], ["tool_end", "explain_query"]]);
    expect(events[1]).toMatchObject({ ok: true, summary: "20 characters" });
  });
});

describe("forked subagents", () => {
  it("gives a forked child the parent's conversation, and an isolated child only its task", async () => {
    const seen: Record<string, string[]> = { forked: [], isolated: [] };
    const childScript = (who: "forked" | "isolated"): Script => (messages) => {
      seen[who] = messages.map((m) => String(m.content));
      return { content: `${who} done` };
    };
    const rootScript: Script = (messages) => {
      const results = toolResults(messages);
      if (results.length === 0) return { toolCall: { name: "task", args: { description: "look", subagent_type: "forked" } } };
      if (results.length === 1) return { toolCall: { name: "task", args: { description: "look", subagent_type: "isolated" } } };
      return { content: results.join(" + ") };
    };
    const forked = agent({ id: "forked", slug: "forked", description: "forked child", modelConfigId: "m-forked" });
    const isolated = agent({ id: "isolated", slug: "isolated", description: "isolated child", modelConfigId: "m-isolated" });
    const root = agent({ subagents: ["forked", "isolated"], tuning: { stepBudget: 10, forkedSubagents: ["forked"] } });
    const models: Record<string, ScriptedModel> = { "m-forked": new ScriptedModel(childScript("forked")), "m-isolated": new ScriptedModel(childScript("isolated")) };
    const build = context([root, forked, isolated], new ScriptedModel(rootScript), {
      resolveModel: async (id) => ({ model: models[id], label: id }),
    });
    const tree = await buildAgentTree(root, "ROOT", build);
    const result = await tree.invoke({ messages: [{ role: "user", content: "THE ORIGINAL QUESTION" }] });

    expect(String((result as { messages: BaseMessage[] }).messages.at(-1)?.content)).toBe("forked done + isolated done");
    expect(seen.forked.some((c) => c.includes("THE ORIGINAL QUESTION"))).toBe(true);
    expect(seen.isolated.some((c) => c.includes("THE ORIGINAL QUESTION"))).toBe(false);
  });
});

describe("fallback model", () => {
  it("answers with the fallback when the primary model fails", async () => {
    const fallback = new ScriptedModel(() => ({ content: "from the fallback" }));
    const root = agent({ tuning: { stepBudget: 10, fallbackModelConfigId: "m-fallback" } });
    const build = context([root], new ScriptedModel(() => ({ content: "never" }), true), {
      resolveModel: async () => ({ model: fallback, label: "fallback" }),
    });
    const tree = await buildAgentTree(root, "ROOT", build);
    const result = await tree.invoke({ messages: [{ role: "user", content: "hi" }] });
    expect(String((result as { messages: BaseMessage[] }).messages.at(-1)?.content)).toBe("from the fallback");
  });

  it("runs without a fallback that no longer resolves", async () => {
    const root = agent({ tuning: { stepBudget: 10, fallbackModelConfigId: "deleted" } });
    const build = context([root], new ScriptedModel(() => ({ content: "primary answer" })));
    const tree = await buildAgentTree(root, "ROOT", build);
    const result = await tree.invoke({ messages: [{ role: "user", content: "hi" }] });
    expect(String((result as { messages: BaseMessage[] }).messages.at(-1)?.content)).toBe("primary answer");
  });
});
