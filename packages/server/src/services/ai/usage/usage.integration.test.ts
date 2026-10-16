/**
 * End to end through the real libraries: a deepagents root agent delegating to
 * a subagent that calls a guarded tool, which runs a query through the real
 * ClickHouseService (client mocked). Proves every model call is captured with
 * usage and agent, the query is tagged and measured, egress is recorded, and
 * the run lands in the RBAC database.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createDeepAgent, type CompiledSubAgent } from "deepagents";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { tool } from "@langchain/core/tools";
import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const queryCalls: Array<{ query: string; query_id?: string; clickhouse_settings?: Record<string, unknown> }> = [];
mock.module("@clickhouse/client", () => ({
  createClient: () => ({
    query: async (params: { query: string; query_id?: string; clickhouse_settings?: Record<string, unknown> }) => {
      queryCalls.push(params);
      return {
        query_id: params.query_id ?? "server-generated",
        json: async () => ({
          meta: [{ name: "id", type: "UInt64" }, { name: "amount", type: "Float64" }],
          data: [{ id: 1, amount: 9.5 }, { id: 2, amount: 3 }],
          statistics: { elapsed: 0.25, rows_read: 5_000, bytes_read: 80_000 },
          rows: 2,
        }),
      };
    },
    command: async () => ({ query_id: "cmd" }),
    ping: async () => ({ success: true }),
    close: async () => undefined,
  }),
}));

const { closeDatabase, initializeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const { rawAll } = await import("../../../rbac/db/raw");
const { ClickHouseService } = await import("../../clickhouse");
const { guardDuplicateTools } = await import("../registry/builder");
const { flushUsageWrites, persistUsageRun, pruneAiUsage, UsageCallbackHandler, withUsageRun } = await import("./index");
const { initializeDeepAgentModel } = await import("../../aiConfig");
type ModelRef = import("./run").ModelRef;

const PRICED: ModelRef = { modelConfigId: "m1", providerType: "anthropic", modelId: "claude-sonnet", pricing: { input: 3, output: 15 } };

type Reply = { content?: string; toolCall?: { name: string; args: Record<string, unknown> }; usage?: Record<string, unknown> | null; fail?: string };

/**
 * Answers by who is asking (system prompt marker) and how far the conversation got.
 * Like ChatOpenAI, `bindTools` returns a new instance built from the constructor
 * fields, so only callbacks passed to the constructor survive.
 */
class ScriptedModel extends BaseChatModel {
  constructor(private readonly script: (messages: BaseMessage[]) => Reply, private readonly fields: { callbacks?: BaseCallbackHandler[] } = {}) {
    super(fields);
  }
  _llmType(): string {
    return "scripted";
  }
  override bindTools(): ScriptedModel {
    return new ScriptedModel(this.script, this.fields);
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const reply = this.script(messages);
    if (reply.fail) throw new Error(reply.fail);
    const message = new AIMessage({
      content: reply.content ?? "",
      tool_calls: reply.toolCall ? [{ id: `call-${Math.random()}`, name: reply.toolCall.name, args: reply.toolCall.args }] : [],
    });
    if (reply.usage !== null) message.usage_metadata = (reply.usage ?? { input_tokens: 1_000, output_tokens: 100, total_tokens: 1_100 }) as AIMessage["usage_metadata"];
    return { generations: [{ text: String(message.content), message }] };
  }
}

function text(messages: BaseMessage[]): string {
  return JSON.stringify(messages.map((m) => m.content));
}

function hasToolResult(messages: BaseMessage[]): boolean {
  return messages.some((m) => m.getType() === "tool");
}

function buildAgents(model: ScriptedModel, service: InstanceType<typeof ClickHouseService>) {
  const calls: Parameters<typeof guardDuplicateTools>[1] = [];
  const runSelect = tool(
    async ({ sql: q }: { sql: string }) => {
      const result = await service.executeQuery(q);
      return JSON.stringify(result.data);
    },
    { name: "run_select_query", description: "Run a SELECT", schema: z.object({ sql: z.string() }) },
  );
  const [guarded] = guardDuplicateTools([runSelect as never], calls, "root › analyst", { model: PRICED, connectionId: "conn-1", defaultDatabase: "sales" });
  const sub = createDeepAgent({ model: model as never, tools: [guarded], systemPrompt: "SUBAGENT_PROMPT", name: "analyst" });
  const root = createDeepAgent({
    model: model as never,
    tools: [],
    systemPrompt: "ROOT_PROMPT",
    subagents: [{ name: "analyst", description: "Runs SQL", runnable: sub } as CompiledSubAgent],
    name: "root",
  });
  return { root, calls };
}

const happyScript = (messages: BaseMessage[]): Reply => {
  const t = text(messages);
  if (t.includes("STRUCTURED_FALLBACK")) return { content: "{}", usage: { input_tokens: 50, output_tokens: 5, total_tokens: 55 } };
  if (t.includes("SUBAGENT_PROMPT")) {
    return hasToolResult(messages)
      ? { content: "two orders", usage: { input_tokens: 2_000, output_tokens: 50, total_tokens: 2_050, input_token_details: { cache_read: 1_000 } } }
      : { toolCall: { name: "run_select_query", args: { sql: "SELECT id, amount FROM orders LIMIT 2" } } };
  }
  return hasToolResult(messages)
    ? { content: "final answer" }
    : { toolCall: { name: "task", args: { description: "count orders", subagent_type: "analyst" } } };
};

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  queryCalls.length = 0;
  for (const t of ["ai_usage_steps", "ai_usage_egress", "ai_usage_requests"]) await rawAll(sql.raw(`DELETE FROM ${t}`));
});

describe("AI usage capture through deepagents", () => {
  it("records every model call, the tool's query and the data sent, then writes the request", async () => {
    const service = new ClickHouseService({ url: "http://ch:8123", username: "u", password: "" }, { rbacUserId: "user-1" });
    let requestId = "";

    await withUsageRun({ featureId: "chat", source: "chat", userId: "user-1", connectionId: "conn-1" }, persistUsageRun, async (run) => {
      requestId = run.id;
      run.setAgent({ id: "agent-1", slug: "root", name: "Root" });
      run.registerAgentPath("root", "root");
      run.registerAgentPath("analyst", "root › analyst");
      const model = new ScriptedModel(happyScript, { callbacks: [new UsageCallbackHandler(run, PRICED)] });
      const { root } = buildAgents(model, service);
      await root.invoke({ messages: [{ role: "user", content: "how many orders?" }] }, { recursionLimit: 40 });
      // The structured-output fallback calls the model outside the graph, with no config.
      await model.invoke([{ role: "user", content: "STRUCTURED_FALLBACK" }]);
    });
    await flushUsageWrites();

    // The query was named for the run and tagged per query.
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].query_id).toBe(`chouse-ai-${requestId}-1`);
    expect(JSON.parse(String(queryCalls[0].clickhouse_settings?.log_comment))).toEqual({ rbac_user_id: "user-1", ai_request_id: requestId });

    const [req] = await rawAll(sql`SELECT * FROM ai_usage_requests WHERE id = ${requestId}`);
    expect(req).toMatchObject({ feature_id: "chat", source: "chat", status: "ok", user_id: "user-1", connection_id: "conn-1", agent_slug: "root" });
    // root (tool call) + subagent ×2 + root final + fallback
    expect(Number(req.llm_calls)).toBe(5);
    expect(Number(req.tool_calls)).toBe(1);
    expect(Number(req.input_tokens)).toBe(1_000 + 1_000 + 2_000 + 1_000 + 50);
    expect(Number(req.output_tokens)).toBe(100 + 100 + 50 + 100 + 5);
    expect(Number(req.cache_read_tokens)).toBe(1_000);
    expect(Number(req.incomplete_calls)).toBe(0);
    expect(Number(req.unpriced_calls)).toBe(0);
    // (5050 - 1000 cached) × $3 + 1000 cached × $3 + 355 × $15, per 1M
    expect(Number(req.cost_usd)).toBeCloseTo((5_050 * 3 + 355 * 15) / 1e6, 10);
    expect(Number(req.ch_queries)).toBe(1);
    expect(Number(req.ch_read_rows)).toBe(5_000);
    expect(Number(req.ch_read_bytes)).toBe(80_000);
    expect(Number(req.egress_rows)).toBe(2);

    const steps = await rawAll(sql`SELECT kind, name, agent_path, status, usage_reported, ch_queries, detail FROM ai_usage_steps WHERE request_id = ${requestId} ORDER BY seq`);
    expect(steps.map((s) => [s.kind, s.agent_path])).toEqual([
      ["llm", "root"],
      ["llm", "root › analyst"],
      ["tool", "root › analyst"],
      ["llm", "root › analyst"],
      ["llm", "root"],
      ["llm", "root"],
    ]);
    // Each LLM step keeps the tools it asked for: the hand-off, the query, then answers.
    const calls = steps.map((s) => (JSON.parse(String(s.detail)) as { calls?: unknown }).calls);
    expect(calls).toEqual([[{ tool: "task", agent: "analyst" }], [{ tool: "run_select_query" }], undefined, [], [], []]);
    const toolStep = steps[2];
    expect(toolStep).toMatchObject({ name: "run_select_query", status: "ok" });
    const detail = JSON.parse(String(toolStep.detail)) as { queries: Array<Record<string, unknown>> };
    expect(detail.queries[0]).toMatchObject({ queryId: `chouse-ai-${requestId}-1`, connectionId: "conn-1", tables: ["sales.orders"], readBytes: 80_000, elapsedMs: 250 });

    const egress = await rawAll(sql`SELECT kind, source, columns, row_count, provider_type, model_id, user_id FROM ai_usage_egress WHERE request_id = ${requestId}`);
    expect(egress).toHaveLength(1);
    expect(egress[0]).toMatchObject({ kind: "clickhouse", source: "sales.orders", provider_type: "anthropic", model_id: "claude-sonnet", user_id: "user-1" });
    expect(JSON.parse(String(egress[0].columns))).toEqual(["id", "amount"]);
    expect(Number(egress[0].row_count)).toBe(2);
  });

  it("records a failed call, an unreported call and the error status", async () => {
    let calls = 0;
    const script = (): Reply => {
      calls += 1;
      return calls === 1 ? { content: "hi", usage: null } : { fail: "Provider overloaded" };
    };
    let requestId = "";
    await expect(withUsageRun({ featureId: "optimize-query", source: "feature", userId: "user-2", connectionId: null }, persistUsageRun, async (run) => {
      requestId = run.id;
      const model = new ScriptedModel(script, { callbacks: [new UsageCallbackHandler(run, { ...PRICED, pricing: null })] });
      await model.invoke([{ role: "user", content: "a" }]);
      await model.invoke([{ role: "user", content: "b" }]);
    })).rejects.toThrow("Provider overloaded");
    await flushUsageWrites();

    const [req] = await rawAll(sql`SELECT status, error, llm_calls, incomplete_calls, unpriced_calls, cost_usd FROM ai_usage_requests WHERE id = ${requestId}`);
    expect(req).toMatchObject({ status: "error", error: "Provider overloaded" });
    expect(Number(req.llm_calls)).toBe(2);
    expect(Number(req.incomplete_calls)).toBe(2);
    expect(req.cost_usd).toBeNull();
    const steps = await rawAll(sql`SELECT status FROM ai_usage_steps WHERE request_id = ${requestId} ORDER BY seq`);
    expect(steps.map((s) => s.status)).toEqual(["incomplete", "error"]);
  });

  it("writes nothing for a run that made no calls", async () => {
    await withUsageRun({ featureId: "check-optimize", source: "feature", userId: "u", connectionId: null }, persistUsageRun, async () => "cached");
    await flushUsageWrites();
    expect(await rawAll(sql`SELECT id FROM ai_usage_requests`)).toHaveLength(0);
  });

  it("leaves queries outside a run untouched", async () => {
    const service = new ClickHouseService({ url: "http://ch:8123", username: "u", password: "" }, { rbacUserId: "user-1" });
    await service.executeQuery("SELECT 1");
    expect(queryCalls[0].query_id).toBeUndefined();
    expect(JSON.parse(String(queryCalls[0].clickhouse_settings?.log_comment))).toEqual({ rbac_user_id: "user-1" });
  });

  it("captures a real ChatOpenAI built by the provider registry through deepagents", async () => {
    // ChatOpenAI.bindTools rebuilds the model from its constructor fields: this
    // is the path that loses callbacks set on the instance afterwards.
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const body = (await req.json()) as { messages: Array<{ role: string }> };
        const done = body.messages.some((m) => m.role === "tool");
        return Response.json({
          id: "x", object: "chat.completion", created: 0, model: "fake",
          choices: [{
            index: 0, finish_reason: done ? "stop" : "tool_calls",
            message: done
              ? { role: "assistant", content: "two orders" }
              : { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "run_select_query", arguments: JSON.stringify({ sql: "SELECT id, amount FROM orders" }) } }] },
          }],
          usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940, prompt_tokens_details: { cached_tokens: 300 } },
        });
      },
    });
    try {
      const service = new ClickHouseService({ url: "http://ch:8123", username: "u", password: "" });
      let requestId = "";
      await withUsageRun({ featureId: "chat", source: "chat", userId: "user-9", connectionId: "conn-1" }, persistUsageRun, async (run) => {
        requestId = run.id;
        const config = {
          provider: { providerType: "openai-compatible", apiKey: "test-key", baseUrl: `http://localhost:${server.port}/v1` },
          model: { modelId: "fake", params: null },
        } as unknown as Parameters<typeof initializeDeepAgentModel>[0];
        const model = initializeDeepAgentModel(config, { callbacks: [new UsageCallbackHandler(run, PRICED)] });
        const calls: Parameters<typeof guardDuplicateTools>[1] = [];
        const runSelect = tool(async ({ sql: q }: { sql: string }) => JSON.stringify((await service.executeQuery(q)).data), {
          name: "run_select_query", description: "Run a SELECT", schema: z.object({ sql: z.string() }),
        });
        const [guarded] = guardDuplicateTools([runSelect as never], calls, "root", { model: PRICED, connectionId: "conn-1", defaultDatabase: "sales" });
        const agent = createDeepAgent({ model: model as never, tools: [guarded], systemPrompt: "ROOT", name: "root" });
        await agent.invoke({ messages: [{ role: "user", content: "orders?" }] }, { recursionLimit: 20 });
      });
      await flushUsageWrites();
      const [req] = await rawAll(sql`SELECT llm_calls, tool_calls, input_tokens, output_tokens, cache_read_tokens, incomplete_calls, cost_usd, ch_queries FROM ai_usage_requests WHERE id = ${requestId}`);
      expect(Number(req.llm_calls)).toBe(2);
      expect(Number(req.tool_calls)).toBe(1);
      expect(Number(req.input_tokens)).toBe(1_800);
      expect(Number(req.output_tokens)).toBe(80);
      expect(Number(req.cache_read_tokens)).toBe(600);
      expect(Number(req.incomplete_calls)).toBe(0);
      expect(Number(req.ch_queries)).toBe(1);
      expect(Number(req.cost_usd)).toBeCloseTo((1_800 * 3 + 80 * 15) / 1e6, 10);
    } finally {
      server.stop(true);
    }
  });

  it("prunes requests past retention with their steps, egress and orphans", async () => {
    const service = new ClickHouseService({ url: "http://ch:8123", username: "u", password: "" });
    await withUsageRun({ featureId: "chat", source: "chat", userId: "u", connectionId: "c" }, persistUsageRun, async (run) => {
      const model = new ScriptedModel(happyScript, { callbacks: [new UsageCallbackHandler(run, PRICED)] });
      await buildAgents(model, service).root.invoke({ messages: [{ role: "user", content: "q" }] }, { recursionLimit: 40 });
    });
    await flushUsageWrites();
    await rawAll(sql`INSERT INTO ai_usage_steps (id, request_id, seq, kind, name, started_at, status) VALUES ('orphan', 'gone', 0, 'llm', 'm', 1, 'ok')`);

    await pruneAiUsage(Date.now(), 30);
    expect(await rawAll(sql`SELECT id FROM ai_usage_requests`)).toHaveLength(1);
    expect(await rawAll(sql`SELECT id FROM ai_usage_steps WHERE id = 'orphan'`)).toHaveLength(0);

    await pruneAiUsage(Date.now() + 31 * 24 * 3600 * 1000, 30);
    for (const t of ["ai_usage_requests", "ai_usage_steps", "ai_usage_egress"]) {
      expect(await rawAll(sql.raw(`SELECT id FROM ${t}`))).toHaveLength(0);
    }
  });
});
