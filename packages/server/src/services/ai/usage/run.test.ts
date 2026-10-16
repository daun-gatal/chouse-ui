import { describe, expect, it } from "bun:test";

import { activeQueryObserver, observeQueries, reportQuery, type ObservedQuery } from "../../queryObserver";
import {
  currentToolStep,
  currentUsageRun,
  isTimeoutError,
  MAX_QUERIES_PER_STEP,
  recordChouseSource,
  runInToolStep,
  UsageRun,
  withUsageRun,
  type ModelRef,
  type UsageRunMeta,
} from "./run";

const META: UsageRunMeta = { featureId: "chat", source: "chat", userId: "u1", connectionId: "c1" };
const PRICED: ModelRef = { modelConfigId: "m1", providerType: "anthropic", modelId: "claude-sonnet", pricing: { input: 3, output: 15 } };
const UNPRICED: ModelRef = { modelConfigId: "m2", providerType: "openai", modelId: "gpt-x", pricing: null };

function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function query(overrides: Partial<ObservedQuery> = {}): ObservedQuery {
  return {
    queryId: "q1",
    sql: "SELECT id, amount FROM sales.orders LIMIT 10",
    elapsedMs: 12,
    readRows: 1_000,
    readBytes: 64_000,
    resultRows: 10,
    resultBytes: 400,
    columns: ["id", "amount"],
    ...overrides,
  };
}

describe("UsageRun · LLM steps", () => {
  it("records usage, duration and cost of a finished call", () => {
    const c = clock();
    const run = new UsageRun(META, c.now);
    const step = run.beginLlm(PRICED, "chouse-assistant");
    c.advance(250);
    run.endLlm(step, { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 });
    expect(step).toMatchObject({ kind: "llm", name: "claude-sonnet", agentPath: "chouse-assistant", status: "ok", usageReported: true, durationMs: 250 });
    expect(step.costUsd).toBeCloseTo(3 + 1.5, 10);
  });

  it("keeps cost null for an unpriced model", () => {
    const run = new UsageRun(META);
    const step = run.beginLlm(UNPRICED, null);
    run.endLlm(step, { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 });
    expect(step.status).toBe("ok");
    expect(step.costUsd).toBeNull();
  });

  it("marks a call without reported usage incomplete", () => {
    const run = new UsageRun(META);
    const step = run.beginLlm(PRICED, null);
    run.endLlm(step, null);
    expect(step).toMatchObject({ status: "incomplete", usageReported: false, costUsd: null });
  });

  it("records a failed call as an error with a bounded message", () => {
    const run = new UsageRun(META);
    const step = run.beginLlm(PRICED, null);
    run.failLlm(step, new Error("x".repeat(1_000)));
    expect(step.status).toBe("error");
    expect(step.error?.length).toBe(300);
    run.endLlm(step, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
    expect(step.status).toBe("error");
  });

  it("falls back to the run's agent when the call carries no agent name", () => {
    const run = new UsageRun(META);
    run.setAgent({ id: "a1", slug: "sql-assistant", name: "SQL assistant" });
    run.setAgent({ id: "a2", slug: "other", name: "Other" });
    expect(run.agent?.slug).toBe("sql-assistant");
    expect(run.beginLlm(PRICED, null).agentPath).toBe("sql-assistant");
  });

  it("places an LLM call at its agent's path in the tree and keeps the tools it asked for", () => {
    const run = new UsageRun(META);
    run.registerAgentPath("chouse-assistant", "chouse-assistant");
    run.registerAgentPath("access-auditor", "chouse-assistant › chouse-admin › access-auditor");
    run.registerAgentPath("access-auditor", "elsewhere › access-auditor");
    const step = run.beginLlm(PRICED, "access-auditor");
    expect(step.agentPath).toBe("chouse-assistant › chouse-admin › access-auditor");
    expect(step.calls).toBeNull();
    run.endLlm(step, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, [{ tool: "list_users" }]);
    expect(step.calls).toEqual([{ tool: "list_users" }]);
    const unknown = run.beginLlm(PRICED, "not-registered");
    expect(unknown.agentPath).toBe("not-registered");
    run.endLlm(unknown, null);
    expect(unknown.calls).toEqual([]);
  });

  it("closes calls still open at finish as incomplete", () => {
    const c = clock();
    const run = new UsageRun(META, c.now);
    const open = run.beginLlm(PRICED, null);
    c.advance(40);
    run.finish("timeout", new Error("Run timed out"));
    expect(open).toMatchObject({ status: "incomplete", usageReported: false, durationMs: 40, ended: true });
    expect(run).toMatchObject({ status: "timeout", error: "Run timed out", durationMs: 40 });
    run.finish("ok");
    expect(run.status).toBe("timeout");
  });
});

describe("UsageRun · tool steps and egress", () => {
  const ctx = { model: PRICED, connectionId: "c1", defaultDatabase: "sales" };

  it("records each query, its tables and the rows sent to the provider", () => {
    const run = new UsageRun(META);
    const tool = run.beginTool("run_select_query", "chouse-assistant", ctx);
    tool.observer.onQuery(query({ sql: "SELECT a.id FROM orders a JOIN crm.customers c ON a.cid = c.id" }));
    tool.end({ result: { rows: [[1]] } });

    expect(tool.step).toMatchObject({ kind: "tool", name: "run_select_query", status: "ok" });
    expect(tool.step.queries).toHaveLength(1);
    expect(tool.step.queries[0]).toMatchObject({ connectionId: "c1", tables: ["crm.customers", "sales.orders"], readBytes: 64_000 });
    expect(tool.step.resultBytes).toBeGreaterThan(0);
    expect(run.egress).toHaveLength(1);
    expect(run.egress[0]).toMatchObject({
      kind: "clickhouse", source: "crm.customers, sales.orders", rows: 10, bytes: 400,
      columns: ["id", "amount"], providerType: "anthropic", modelId: "claude-sonnet", stepId: tool.step.id,
    });
    expect({ q: run.chQueries, rows: run.chReadRows, bytes: run.chReadBytes }).toEqual({ q: 1, rows: 1_000, bytes: 64_000 });
  });

  it("counts failed and empty queries but sends nothing for them", () => {
    const run = new UsageRun(META);
    const tool = run.beginTool("run_select_query", null, ctx);
    tool.observer.onQuery(query({ error: "Code: 60. Table does not exist", resultRows: 0, readRows: 0, readBytes: 0 }));
    tool.observer.onQuery(query({ resultRows: 0 }));
    expect(tool.step.queries).toHaveLength(2);
    expect(tool.step.queries[0].error).toContain("Table does not exist");
    expect(run.egress).toHaveLength(0);
  });

  it("names a table-less query's data 'query result' and prefers the query's own connection", () => {
    const run = new UsageRun(META);
    const tool = run.beginTool("query_node", null, ctx);
    tool.observer.onQuery(query({ sql: "SELECT version()", connectionId: "node-2" }));
    expect(run.egress[0]).toMatchObject({ source: "query result", connectionId: "node-2" });
  });

  it("keeps at most MAX_QUERIES_PER_STEP queries in detail but counts all of them", () => {
    const run = new UsageRun(META);
    const tool = run.beginTool("run_select_query", null, ctx);
    for (let i = 0; i < MAX_QUERIES_PER_STEP + 5; i += 1) tool.observer.onQuery(query({ queryId: `q${i}` }));
    expect(tool.step.queries).toHaveLength(MAX_QUERIES_PER_STEP);
    expect(run.chQueries).toBe(MAX_QUERIES_PER_STEP + 5);
    expect(run.egress).toHaveLength(MAX_QUERIES_PER_STEP + 5);
  });

  it("records CHouse records with their top-level fields", () => {
    const run = new UsageRun(META);
    const tool = run.beginTool("list_users", "chouse-admin", ctx);
    tool.addChouseSource("Users", [{ email: "a@x", roles: ["admin"] }, { email: "b@x", roles: [] }]);
    tool.addChouseSource("Profile", { id: "u1", email: "a@x" });
    tool.addChouseSource("Audit log", { total: 2, rows: [{ action: "login", username: "a" }, { action: "logout", username: "a" }] });
    tool.addChouseSource("Nothing", []);
    tool.addChouseSource("Missing", null);
    expect(run.egress.map((e) => [e.kind, e.source, e.rows, e.columns])).toEqual([
      ["chouse", "Users", 2, ["email", "roles"]],
      ["chouse", "Profile", 1, ["id", "email"]],
      ["chouse", "Audit log", 2, ["action", "username"]],
    ]);
  });

  it("marks duplicate and failed tool calls", () => {
    const run = new UsageRun(META);
    const dup = run.beginTool("list_tables", null, ctx);
    dup.end({ result: { repeated: true }, duplicate: true });
    const failed = run.beginTool("list_tables", null, ctx);
    failed.end({ error: new Error("boom") });
    expect(dup.step.status).toBe("duplicate");
    expect(failed.step).toMatchObject({ status: "error", error: "boom" });
  });

  it("gives queries ids unique to the run and tags them with the request", () => {
    const run = new UsageRun(META);
    const tool = run.beginTool("x", null, ctx);
    const a = tool.observer.nextQueryId();
    const b = tool.observer.nextQueryId();
    expect(a).not.toBe(b);
    expect(a.startsWith(`chouse-ai-${run.id}-`)).toBe(true);
    expect(tool.observer.logTags()).toEqual({ ai_request_id: run.id });
  });
});

describe("withUsageRun", () => {
  it("runs fn inside the run and finishes it ok", async () => {
    const finished: UsageRun[] = [];
    const result = await withUsageRun(META, (r) => finished.push(r), async (run) => {
      expect(currentUsageRun()).toBe(run);
      return 42;
    });
    expect(result).toBe(42);
    expect(finished).toHaveLength(1);
    expect(finished[0].status).toBe("ok");
    expect(currentUsageRun()).toBeUndefined();
  });

  it("joins an active run instead of opening a nested one", async () => {
    const finished: UsageRun[] = [];
    await withUsageRun(META, (r) => finished.push(r), async (outer) => {
      await withUsageRun({ ...META, featureId: "optimize-query" }, (r) => finished.push(r), async (inner) => {
        expect(inner).toBe(outer);
      });
    });
    expect(finished).toHaveLength(1);
    expect(finished[0].meta.featureId).toBe("chat");
  });

  it("records failures and timeouts, and still hands the run over", async () => {
    const finished: UsageRun[] = [];
    await expect(withUsageRun(META, (r) => finished.push(r), async () => { throw new Error("bad request"); })).rejects.toThrow("bad request");
    const timeout = new Error("The operation timed out.");
    timeout.name = "TimeoutError";
    await expect(withUsageRun(META, (r) => finished.push(r), async () => { throw timeout; })).rejects.toBe(timeout);
    expect(finished.map((r) => [r.status, r.error])).toEqual([["error", "bad request"], ["timeout", "The operation timed out."]]);
  });

  it("keeps concurrent runs apart", async () => {
    const seen: string[] = [];
    await Promise.all(["a", "b"].map((featureId) => withUsageRun({ ...META, featureId }, () => undefined, async () => {
      await new Promise((r) => setTimeout(r, featureId === "a" ? 20 : 5));
      seen.push(`${featureId}:${currentUsageRun()?.meta.featureId}`);
    })));
    expect(seen.sort()).toEqual(["a:a", "b:b"]);
  });
});

describe("tool step context", () => {
  it("routes CHouse sources and queries to the step that is running", async () => {
    const run = new UsageRun(META);
    const tool = run.beginTool("list_users", null, { model: null, connectionId: "c1", defaultDatabase: null });
    await runInToolStep(tool, () => observeQueries(tool.observer, async () => {
      expect(currentToolStep()).toBe(tool);
      recordChouseSource("Users", [{ id: 1 }]);
      reportQuery(activeQueryObserver(), query());
    }));
    recordChouseSource("Outside", [{ id: 2 }]);
    expect(run.egress.map((e) => e.source)).toEqual(["Users", "sales.orders"]);
  });

  it("never lets an observer error escape into the query path", () => {
    expect(() => reportQuery({ nextQueryId: () => "q", logTags: () => ({}), onQuery: () => { throw new Error("bug"); } }, query())).not.toThrow();
  });
});

describe("isTimeoutError", () => {
  it("recognizes timeouts and aborts only", () => {
    const named = (name: string, message = "x"): Error => Object.assign(new Error(message), { name });
    expect(isTimeoutError(named("TimeoutError"))).toBe(true);
    expect(isTimeoutError(named("AbortError"))).toBe(true);
    expect(isTimeoutError(new Error("Request timed out after 120s"))).toBe(true);
    expect(isTimeoutError(new Error("Invalid API key"))).toBe(false);
    expect(isTimeoutError("timeout")).toBe(false);
  });
});
