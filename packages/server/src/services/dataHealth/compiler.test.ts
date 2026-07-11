import { describe, expect, it } from "bun:test";

import { compileDataHealthQuery } from "./compiler";
import type { DataHealthCheckDefinition } from "./types";

const checks: DataHealthCheckDefinition[] = [
  { checkKey: "rows", name: "Rows", type: "row_count", severity: "critical", enabled: true, config: { min: 1 } },
  { checkKey: "complete_customer", name: "Customer complete", type: "completeness", severity: "warning", enabled: true, config: { column: "customer_id", minRatio: 0.99 } },
  { checkKey: "schema", name: "Schema", type: "schema_contract", severity: "critical", enabled: true, config: { expectedColumns: [], allowAdditionalColumns: true } },
];

describe("compileDataHealthQuery", () => {
  it("folds compatible metrics into one read-only aggregate query", () => {
    const compiled = compileDataHealthQuery(
      { sourceType: "table", databaseName: "analytics", tableName: "orders", eventTimeColumn: "created_at" },
      checks,
    );
    expect(compiled.sql).toContain("FROM `analytics`.`orders` AS dh_source");
    expect(compiled.sql).toContain("countIf(`created_at` >= {{slot_start}}");
    expect(compiled.sql).toContain("WHERE (`created_at` >= {{slot_start}} AND `created_at` < {{slot_end}})");
    expect(compiled.sql).toContain("AS `complete_customer`");
    expect(compiled.metricCheckKeys).toEqual(["rows", "complete_customer"]);
    expect(compiled.schemaCheckKeys).toEqual(["schema"]);
  });

  it("rejects a windowed check without an event-time column", () => {
    expect(() => compileDataHealthQuery({ sourceType: "table", databaseName: "analytics", tableName: "orders" }, checks)).toThrow("event-time");
  });

  it("rejects write statements used as query sources", () => {
    expect(() => compileDataHealthQuery(
      { sourceType: "query", sourceQuery: "DROP TABLE orders", eventTimeColumn: "created_at" },
      checks,
    )).toThrow("read-only");
  });

  it("returns a bounded freshness breach when the scan contains no eligible event", () => {
    const compiled = compileDataHealthQuery(
      { sourceType: "table", databaseName: "analytics", tableName: "orders", eventTimeColumn: "created_at" },
      [{ checkKey: "freshness", name: "Freshness", type: "freshness", severity: "critical", enabled: true, config: { eventTimeColumn: "created_at", maxAgeSeconds: 3600 } }],
    );

    expect(compiled.sql).toContain("if(countIf(`created_at` < {{slot_end}}) = 0, toFloat64(3601)");
    expect(compiled.sql).not.toContain("ifNull(dateDiff");
  });
});
