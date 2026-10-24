/**
 * The analysis sandbox (ADR 0024 §Phase 5): js_eval computes in QuickJS,
 * bridges only read-only tools through the run's guardrails, keeps state for
 * one run and is released when the run ends.
 */
import { describe, expect, it } from "bun:test";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { z } from "zod";

import { createAgentTool } from "../langchainTools";
import { GuardrailRunner } from "../guardrails/runner";
import type { GuardrailDef } from "../guardrails/types";
import { buildAgentTree, type BuildContext } from "../registry/builder";
import type { AgentDef, HarnessDef } from "../registry/types";
import type { AgentRunContext } from "../types";
import { analysisPrompt, ANALYSIS_LIMITS, bridgedTool, buildAnalysisTool, camelCaseToolName } from "./analysis";

const rowsTool = createAgentTool("run_select_query", {
  description: "Run a SELECT",
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }: { query: string }) => JSON.stringify({ query, rows: [{ n: 4 }, { n: 6 }, { email: "ann@example.com" }] }),
});

function evalWith(tools = [rowsTool]) {
  const disposers: Array<() => void> = [];
  const tool = buildAnalysisTool(tools, (d) => disposers.push(d));
  const run = async (code: string): Promise<string> => String(await tool.invoke({ code }));
  return { run, dispose: () => disposers.forEach((d) => d()) };
}

describe("js_eval", () => {
  it("computes, and keeps state between calls of one run", async () => {
    const { run, dispose } = evalWith();
    expect(await run("var total = [1, 2, 3].reduce((a, b) => a + b, 0); total")).toContain("6");
    expect(await run("const doubled: number = total * 2; doubled")).toContain("12");
    dispose();
  });

  it("calls read-only tools as functions without sending their rows to the model", async () => {
    const { run, dispose } = evalWith();
    const out = await run("const r = JSON.parse(await tools.runSelectQuery({ query: 'SELECT n' })); r.rows.reduce((a, x) => a + (x.n ?? 0), 0)");
    expect(out).toContain("10");
    expect(out).not.toContain("ann@example.com");
    dispose();
  });

  it("has no network, modules or host process", async () => {
    const { run, dispose } = evalWith();
    expect(await run("[typeof fetch, typeof require, typeof process, typeof Bun].join(',')")).toContain("undefined,undefined,undefined,undefined");
    dispose();
  });

  it("stops runaway code", async () => {
    const { run, dispose } = evalWith();
    const out = await run("while (true) {}");
    expect(out.toLowerCase()).toContain("interrupted");
    dispose();
  }, ANALYSIS_LIMITS.timeoutMs + 10_000);

  it("starts fresh after the run is released", async () => {
    const { run, dispose } = evalWith();
    await run("var kept = 41");
    dispose();
    expect(await run("typeof kept")).toContain("undefined");
    dispose();
  });
});

const guardrail = (extra: Partial<GuardrailDef>): GuardrailDef => ({
  id: "g", slug: "g", name: "PII redaction", description: "", kind: "pattern", config: { detectors: ["email"], patterns: [], strategy: "placeholder" },
  stages: ["tool_result"], action: "redact", mode: "enforce", scope: { agents: "all", features: "all", mcp: true }, position: 1, enabled: true,
  isSystem: false, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0, ...extra,
});

function runner(guardrails: GuardrailDef[]): GuardrailRunner {
  return new GuardrailRunner(guardrails, { featureId: "chat", permissions: [], isAdmin: true, judge: async () => ({ violates: false, reason: "" }), estimateRows: null, record: () => undefined });
}

describe("bridged tools", () => {
  it("pass the run's tool-result guardrails", async () => {
    const bridged = bridgedTool(rowsTool, { runner: runner([guardrail({})]), agentId: "a", path: "sre" });
    const text = String(await bridged.invoke({ query: "SELECT *" }));
    expect(text).not.toContain("ann@example.com");
    expect(text).toContain("rows");
  });

  it("stop the evaluation when a guardrail blocks", async () => {
    const bridged = bridgedTool(rowsTool, { runner: runner([guardrail({ name: "No emails", action: "block" })]), agentId: "a", path: "sre" });
    const { run, dispose } = evalWith([bridged]);
    const out = await run("await tools.runSelectQuery({ query: 'SELECT *' })");
    expect(out).toContain("No emails");
    expect(out).not.toContain("ann@example.com");
    dispose();
  });

  it("are the original tool when no guardrail applies", () => {
    expect(bridgedTool(rowsTool, null)).toBe(rowsTool);
    expect(bridgedTool(rowsTool, { runner: runner([]), agentId: "a", path: "sre" })).toBe(rowsTool);
  });
});

describe("camelCaseToolName", () => {
  it("names tools as the sandbox does", async () => {
    const { toCamelCase } = await import("@langchain/quickjs");
    for (const name of ["run_select_query", "list_tables", "get_table_ddl", "query_node", "explain-query", "x"]) {
      expect(camelCaseToolName(name)).toBe(toCamelCase(name));
    }
  });
});

describe("analysisPrompt", () => {
  it("names the bridged tools in camelCase", () => {
    const prompt = analysisPrompt(["run_select_query", "list_tables"]);
    expect(prompt).toContain("## ANALYSIS");
    expect(prompt).toContain("await tools.runSelectQuery({...}) — same arguments as `run_select_query`");
    expect(prompt).toContain("await tools.listTables({...})");
    expect(analysisPrompt([])).not.toContain("tools.");
  });
});

// ---------------------------------------------------------------------------
// In an agent tree: only harnesses with analysis on get js_eval, and write
// tools are never bridged.
// ---------------------------------------------------------------------------

const systems: string[] = [];
const toolResults: string[] = [];

class ScriptedModel extends BaseChatModel {
  constructor(private readonly code: string) {
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
    if (system) systems.push(Array.isArray(system.content) ? system.content.map((b) => (typeof b === "string" ? b : "text" in b ? String(b.text) : "")).join("\n") : String(system.content));
    const tools = messages.filter((m) => m.getType() === "tool");
    if (tools.length > 0) {
      toolResults.push(...tools.map((m) => String(m.content)));
      return { generations: [{ text: "done", message: new AIMessage("done") }] };
    }
    const message = new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "js_eval", args: { code: this.code } }] });
    return { generations: [{ text: "", message }] };
  }
}

function harness(analysis: boolean): HarnessDef {
  return {
    id: "h", slug: "h", name: "H", description: "", excludedTools: ["task", "write_todos", "ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "execute"],
    generalPurpose: { enabled: false }, promptSuffix: null, toolDescriptionOverrides: {}, analysis, isSystem: false, seedHash: null, customized: false,
    version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
  };
}

const AGENT: AgentDef = {
  id: "a", slug: "analyst", name: "Analyst", description: "", kind: "agent", systemPrompt: "Analyst", taskTemplate: null, modelConfigId: null,
  harnessId: "h", tuning: { stepBudget: 6 }, requiredPermissions: [], tools: ["get_server_info", "kill_query"], skills: [], subagents: [],
  enabled: true, isSystem: false, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
};

async function runTree(analysis: boolean, code: string): Promise<{ disposed: number }> {
  let disposed = 0;
  const disposers: Array<() => void> = [];
  const ctx: AgentRunContext = { userId: "u", isAdmin: true, permissions: [], connectionId: "c1", clickhouseService: {} as never, bearerToken: "t", actionMode: "approve" };
  const build: BuildContext = {
    snapshot: { version: 1, agents: new Map([["a", AGENT]]), harnesses: new Map([["h", harness(analysis)]]), skills: new Map(), bindings: new Map(), guardrails: new Map() },
    runtime: { ctx },
    variables: {},
    calls: [],
    rootModel: { model: new ScriptedModel(code), label: "scripted" },
    resolveModel: async () => { throw new Error("no models"); },
    guardrails: null,
    onDispose: (d) => disposers.push(() => { disposed++; d(); }),
  };
  const tree = await buildAgentTree(AGENT, "Analyst", build);
  await tree.invoke({ messages: [{ role: "user", content: "analyze" }] });
  for (const d of disposers) d();
  return { disposed };
}

describe("js_eval in an agent tree", () => {
  it("is offered with analysis on, bridging read tools but not write tools", async () => {
    systems.length = 0;
    toolResults.length = 0;
    const { disposed } = await runTree(true, "[typeof tools.getServerInfo, typeof tools.killQuery].join(',')");
    expect(systems[0]).toContain("## ANALYSIS");
    expect(systems[0]).toContain("tools.getServerInfo");
    expect(systems[0]).not.toContain("killQuery");
    expect(toolResults.join("\n")).toContain("function,undefined");
    expect(disposed).toBe(1);
  });

  it("is not offered with analysis off", async () => {
    systems.length = 0;
    toolResults.length = 0;
    await runTree(false, "1 + 1");
    expect(systems[0]).not.toContain("## ANALYSIS");
    expect(toolResults.join("\n")).not.toContain("2");
  });
});
