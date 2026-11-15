/**
 * The statement-log hooks must not send their statement for a person who may
 * not read those tables, and must leave the rest of a mixed statement intact.
 */

import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRbacStore } from "@/stores";
import {
  useBlockedTaskSummary,
  useCrashLog,
  useQueryPercentiles,
  useQueryTimeline,
  useServerErrors,
  useServerMemoryBreakdown,
  useTopMemoryQueries,
} from "./useMonitoringTimeline";

const executeQuery = vi.fn<(sql: string) => Promise<{ data: Array<Record<string, unknown>> }>>();

vi.mock("@/api", () => ({
  queryApi: { executeQuery: (sql: string) => executeQuery(sql) },
}));

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function sentSql(): string {
  return executeQuery.mock.calls.map(([sql]) => sql).join("\n");
}

describe("statement-log hooks without query:history:view:all", () => {
  beforeEach(() => {
    executeQuery.mockReset();
    executeQuery.mockResolvedValue({ data: [{}] });
    useRbacStore.setState({ roles: ["analyst"], permissions: [] });
  });

  it("does not send the query_log and crash_log statements", async () => {
    const timeline = renderHook(() => useQueryTimeline(), { wrapper });
    const top = renderHook(() => useTopMemoryQueries(1, 10, undefined, { enabled: true }), { wrapper });
    const crashes = renderHook(() => useCrashLog({ enabled: true }), { wrapper });

    // A read that stays open proves the client was reachable in this render.
    const errors = renderHook(() => useServerErrors(), { wrapper });
    await waitFor(() => expect(errors.result.current.isSuccess).toBe(true));

    expect(timeline.result.current.fetchStatus).toBe("idle");
    expect(top.result.current.fetchStatus).toBe("idle");
    expect(crashes.result.current.fetchStatus).toBe("idle");
    expect(sentSql()).toContain("system.errors");
    expect(sentSql()).not.toMatch(/query_log|crash_log/);
  });

  it("sends nothing on an explicit refetch either", async () => {
    const timeline = renderHook(() => useQueryTimeline(), { wrapper });
    const percentiles = renderHook(() => useQueryPercentiles("duration"), { wrapper });
    const crashes = renderHook(() => useCrashLog(), { wrapper });

    expect((await timeline.result.current.refetch()).data).toEqual([]);
    expect((await percentiles.result.current.refetch()).data).toEqual({ p50: 0, p95: 0, p99: 0, max: 0 });
    expect((await crashes.result.current.refetch()).data).toEqual([]);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("leaves system.processes out of the mixed statements and reports those values as unknown", async () => {
    executeQuery.mockResolvedValue({ data: [{ long_running_merges: 2, total_bytes: 64, mark_cache_bytes: 8 }] });
    const blocked = renderHook(() => useBlockedTaskSummary(), { wrapper });
    const memory = renderHook(() => useServerMemoryBreakdown(), { wrapper });
    await waitFor(() => expect(blocked.result.current.isSuccess && memory.result.current.isSuccess).toBe(true));

    expect(sentSql()).not.toContain("system.processes");
    expect(sentSql()).toContain("system.merges");
    expect(sentSql()).toContain("system.asynchronous_metrics");
    expect(blocked.result.current.data?.long_running_queries).toBeNull();
    expect(blocked.result.current.data?.long_running_merges).toBe(2);
    expect(memory.result.current.data?.active_queries_bytes).toBeNull();
    expect(memory.result.current.data?.mark_cache_bytes).toBe(8);
  });
});

describe("statement-log hooks with the permission", () => {
  beforeEach(() => {
    executeQuery.mockReset();
    executeQuery.mockResolvedValue({ data: [{ long_running_queries: 3, active_queries_bytes: 16 }] });
  });

  it.each([
    ["query:history:view:all", { roles: ["analyst"], permissions: ["query:history:view:all"] }],
    ["the admin role", { roles: ["admin"], permissions: [] }],
  ])("sends the statements for a person with %s", async (_label, state) => {
    useRbacStore.setState(state);
    const timeline = renderHook(() => useQueryTimeline(), { wrapper });
    const blocked = renderHook(() => useBlockedTaskSummary(), { wrapper });
    const memory = renderHook(() => useServerMemoryBreakdown(), { wrapper });
    await waitFor(() =>
      expect(timeline.result.current.isSuccess && blocked.result.current.isSuccess && memory.result.current.isSuccess).toBe(true),
    );

    expect(sentSql()).toContain("FROM system.query_log");
    expect(sentSql()).toContain("FROM system.processes WHERE elapsed > 60");
    expect(sentSql()).toContain("sum(memory_usage) FROM system.processes");
    expect(blocked.result.current.data?.long_running_queries).toBe(3);
    expect(memory.result.current.data?.active_queries_bytes).toBe(16);
  });

  it("still honours a caller that switches the query off", () => {
    useRbacStore.setState({ roles: ["admin"], permissions: [] });
    const timeline = renderHook(() => useQueryTimeline(6, "minute", undefined, undefined, { enabled: false }), { wrapper });
    expect(timeline.result.current.fetchStatus).toBe("idle");
    expect(executeQuery).not.toHaveBeenCalled();
  });
});
