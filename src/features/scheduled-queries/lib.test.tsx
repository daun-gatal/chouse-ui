import { describe, expect, it } from "vitest";

import type { ScheduledQuery } from "@/api/scheduledQueries";
import { scheduledQueryToInput } from "./lib";

const JOB: ScheduledQuery = {
  id: "job-1",
  name: "Daily orders",
  description: "Materialize daily orders",
  connectionId: "connection-1",
  query: "SELECT * FROM orders",
  enabled: true,
  frequency: "daily",
  hour: 2,
  dayOfWeek: 1,
  dayOfMonth: 1,
  cronExpr: null,
  timezone: "UTC",
  outputMode: "append",
  destDatabase: "analytics",
  destTable: "daily_orders",
  outputConfig: { createIfMissing: true },
  maxRows: 1_000,
  timeoutSecs: 60,
  useFinal: false,
  seqConsistency: true,
  lastRunAt: 0,
  maxAttempts: 2,
  retentionDays: 30,
  createdBy: "user-1",
  createdAt: 1,
  updatedAt: 1,
  channelIds: ["channel-1"],
};

describe("scheduledQueryToInput", () => {
  it("preserves editable fields and applies overrides", () => {
    const input = scheduledQueryToInput(JOB, { enabled: false });

    expect(input).toMatchObject({
      name: JOB.name,
      connectionId: JOB.connectionId,
      query: JOB.query,
      enabled: false,
      outputMode: JOB.outputMode,
      destDatabase: JOB.destDatabase,
      destTable: JOB.destTable,
      maxAttempts: JOB.maxAttempts,
      channelIds: JOB.channelIds,
    });
    expect(input).not.toHaveProperty("id");
    expect(input).not.toHaveProperty("lastRun");
  });
});
