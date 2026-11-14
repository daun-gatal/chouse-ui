/**
 * The agent tools that list queries. Every CHouse user runs as the
 * connection's one ClickHouse user, so "your own queries" has to be decided
 * from the CHouse account recorded on each query, not from the ClickHouse user.
 */

import { describe, expect, it } from "bun:test";

import { createCoreTools, type AgentToolContext } from "./agentTools";
import type { ClickHouseService } from "./clickhouse";

interface Harness {
  tools: ReturnType<typeof createCoreTools>;
  sent: string[];
}

function harness(overrides: Partial<AgentToolContext> = {}): Harness {
  const sent: string[] = [];
  const clickhouseService = {
    executeQuery: async (sql: string) => {
      sent.push(sql);
      return { data: [], meta: [], statistics: {}, rows: 0 };
    },
  } as unknown as ClickHouseService;
  const tools = createCoreTools({ userId: "user-1", isAdmin: false, permissions: [], clickhouseService, ...overrides });
  return { tools, sent };
}

describe("get_running_queries", () => {
  it("limits a non-admin to queries recorded for their own CHouse account", async () => {
    const { tools, sent } = harness();

    await tools.get_running_queries.invoke({});

    expect(sent[0]).toContain("JSONExtractString(Settings['log_comment'], 'rbac_user_id') = 'user-1'");
    expect(sent[0]).not.toContain("currentUser()");
  });

  it("gives an admin every running query", async () => {
    const { tools, sent } = harness({ isAdmin: true });

    await tools.get_running_queries.invoke({});

    expect(sent[0]).not.toContain("rbac_user_id");
    expect(sent[0]).not.toContain("WHERE");
  });

  it("quotes the account id as a string literal", async () => {
    const { tools, sent } = harness({ userId: "o'brien\\" });

    await tools.get_running_queries.invoke({});

    expect(sent[0]).toContain("= 'o\\'brien\\\\'");
  });
});

describe("get_slow_queries", () => {
  it("limits a non-admin to queries recorded for their own CHouse account", async () => {
    const { tools, sent } = harness();

    await tools.get_slow_queries.invoke({ limit: 5, minDurationMs: 10 });

    expect(sent[0]).toContain("AND JSONExtractString(log_comment, 'rbac_user_id') = 'user-1'");
    expect(sent[0]).not.toContain("currentUser()");
  });

  it("gives an admin everyone's slow queries", async () => {
    const { tools, sent } = harness({ isAdmin: true });

    await tools.get_slow_queries.invoke({});

    expect(sent[0]).not.toContain("rbac_user_id");
  });
});
