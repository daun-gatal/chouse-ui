import { describe, expect, it } from "bun:test";

import { buildFailingRowsQuery } from "./diagnostics";
import type { DataHealthPromiseRow } from "./types";

const promise: DataHealthPromiseRow = {
  id: "p", scheduledQueryId: "j", name: "orders", description: null, connectionId: "c", sourceType: "table",
  databaseName: "analytics", tableName: "orders", sourceQuery: null, eventTimeColumn: "created_at", rowFilter: "environment = 'production'",
  ownerId: "u", ownerDisplayName: null, criticality: "critical", timezone: "UTC", runbookUrl: null, enabled: true, status: "unhealthy",
  graceSecs: 0, breachAfter: 1, recoverAfter: 1, retentionDays: 90, schemaSnapshot: null, lastEvaluatedAt: 10, lastHealthyAt: 1,
  createdBy: "u", createdAt: 1, updatedAt: 2,
};

describe("Data Health diagnostics", () => {
  it("builds a bounded completeness query with the promise window and filter", () => {
    const query = buildFailingRowsQuery(promise, { checkKey: "email_ok", name: "Email", type: "completeness", severity: "warning", enabled: true, config: { column: "email", minRatio: 0.99 } }, 500);
    expect(query).toContain("`analytics`.`orders`");
    expect(query).toContain("`email` IS NULL");
    expect(query).toContain("environment = 'production'");
    expect(query).toContain("LIMIT 100");
  });

  it("builds a grouped uniqueness diagnostic", () => {
    const query = buildFailingRowsQuery(promise, { checkKey: "order_key", name: "Key", type: "uniqueness", severity: "critical", enabled: true, config: { columns: ["order_id"], maxDuplicateRatio: 0 } }, 20);
    expect(query).toContain("GROUP BY `order_id`");
    expect(query).toContain("HAVING duplicate_count > 1");
  });

  it("returns null for aggregate-only checks", () => {
    expect(buildFailingRowsQuery(promise, { checkKey: "rows", name: "Rows", type: "row_count", severity: "critical", enabled: true, config: { min: 1 } }, 20)).toBeNull();
  });
});
