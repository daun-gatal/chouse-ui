/**
 * Token callers (CLI, MCP) running panels pass agent governance exactly like
 * /api/query: a blocked query never reaches ClickHouse, and every run is
 * recorded on the agent's session — a cached one as reading nothing.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { AgentContext, GovernanceResult } from "../agents/governance";

const sent: string[] = [];
const signals: unknown[] = [];
let failNext = false;
mock.module("../scheduledQueries/chClient", () => ({
  clientForConnection: async () => ({
    query: async (args: { query: string; abort_signal?: unknown }) => {
      sent.push(args.query);
      signals.push(args.abort_signal);
      if (failNext) {
        failNext = false;
        throw new Error("connection reset");
      }
      return { response_headers: { "x-clickhouse-timezone": "UTC" }, json: async () => ({ meta: [{ name: "v", type: "UInt8" }], data: [{ v: 1 }], statistics: { elapsed: 0.001, rows_read: 1, bytes_read: 100 } }) };
    },
  }),
}));

let decision: GovernanceResult["decision"]["decision"] = "allow";
const recorded: Array<{ outcome: string; readBytes: number }> = [];
mock.module("../agents/governance", () => ({
  governAgentQuery: async (): Promise<GovernanceResult> => ({
    decision: { decision, reasons: decision === "block" ? ["daily budget exceeded"] : [], notices: [], estimatedBytes: 0 },
    sessionId: "session-1",
  } as unknown as GovernanceResult),
  recordAgentQuery: async (_ctx: AgentContext, _g: GovernanceResult, _sql: string, outcome: string, readBytes: number) => {
    recorded.push({ outcome, readBytes });
  },
}));

mock.module("./access", () => ({
  isAdmin: () => true,
  viewerConnections: async () => [{ id: "conn-1", name: "alpha", database: "default" }],
}));

const { clearPanelCache, queryError, REQUEST_TIMEOUT_MS, runPanel } = await import("./runner");

const viewer = { id: "u1", roles: ["admin"], permissions: [] };
const agent: AgentContext = { patId: "pat-1", userId: "u1", roles: ["admin"], source: "mcp", clientName: "Claude Code", tool: "run_dashboard_panel", connectionId: "conn-1" };
const query = { sql: "SELECT 1 AS v", variables: [], values: {}, range: { kind: "relative" as const, value: "1h" as const }, dashboardId: "d1", panelId: "p1" };

beforeEach(() => {
  sent.length = 0;
  recorded.length = 0;
  decision = "allow";
  failNext = false;
  clearPanelCache();
});

describe("request deadline", () => {
  it("gives every panel query its own deadline", async () => {
    signals.length = 0;
    await runPanel(viewer, "conn-1", query, () => null);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect((signals[0] as AbortSignal).aborted).toBe(false);
  });

  it("says ClickHouse did not answer when the deadline passed, whatever the client threw", () => {
    const error = queryError(new Error("The user aborted a request."), 10_000, true);
    expect(error.message).toBe(`ClickHouse did not answer within ${REQUEST_TIMEOUT_MS / 1000} s; the server may be down or unreachable.`);
    expect(error.statusCode).toBe(503);
    expect(queryError(new Error("socket hang up"), 10_000, false).message).toContain("socket hang up");
  });
});

describe("runPanel for token callers", () => {
  it("refuses a query the agent policy blocks, before ClickHouse", async () => {
    decision = "block";
    await expect(runPanel(viewer, "conn-1", query, () => agent)).rejects.toThrow("daily budget exceeded");
    expect(sent).toEqual([]);
  });

  it("records the run, and a cached run as reading nothing", async () => {
    await runPanel(viewer, "conn-1", query, () => agent);
    await runPanel(viewer, "conn-1", query, () => agent);
    expect(sent).toHaveLength(1);
    expect(recorded).toEqual([{ outcome: "ok", readBytes: 100 }, { outcome: "ok", readBytes: 0 }]);
  });

  it("records a failed run as an error", async () => {
    failNext = true;
    await expect(runPanel(viewer, "conn-1", query, () => agent)).rejects.toThrow("connection reset");
    expect(recorded).toEqual([{ outcome: "error", readBytes: 0 }]);
  });

  it("skips governance for browser sessions", async () => {
    decision = "block";
    const run = await runPanel(viewer, "conn-1", query, () => null);
    expect(run.data.rows).toEqual([{ v: 1 }]);
    expect(recorded).toEqual([]);
  });
});
