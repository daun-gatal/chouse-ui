import { describe, expect, it } from "bun:test";

import { compileDataHealthQuery, eventTimeExpression } from "./compiler";
import type { DataHealthCheckDefinition } from "./types";

const checks: DataHealthCheckDefinition[] = [
  { checkKey: "rows", name: "Rows", type: "row_count", severity: "critical", enabled: true, config: { min: 1 } },
  { checkKey: "complete_customer", name: "Customer complete", type: "completeness", severity: "warning", enabled: true, config: { column: "customer_id", minRatio: 0.99 } },
  { checkKey: "schema", name: "Schema", type: "schema_contract", severity: "critical", enabled: true, config: { expectedColumns: [], allowAdditionalColumns: true } },
];

describe("compileDataHealthQuery", () => {
  it("normalizes every explicit Unix precision to a UTC DateTime", () => {
    expect(eventTimeExpression("ts", "UInt64", "unix_seconds")).toBe("toDateTime64(toInt64(`ts`), 3, 'UTC')");
    expect(eventTimeExpression("ts", "UInt64", "unix_milliseconds")).toBe("fromUnixTimestamp64Milli(toInt64(`ts`), 'UTC')");
    expect(eventTimeExpression("ts", "UInt64", "unix_microseconds")).toBe("fromUnixTimestamp64Micro(toInt64(`ts`), 'UTC')");
    expect(eventTimeExpression("ts", "UInt64", "unix_nanoseconds")).toBe("fromUnixTimestamp64Nano(toInt64(`ts`), 'UTC')");
  });

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

    expect(compiled.sql).toContain("if(count() = 0, toFloat64(3601)");
    expect(compiled.sql).toContain("WHERE (`created_at` >= {{slot_end - 3600s}} AND `created_at` < {{slot_end}})");
    expect(compiled.sql).not.toContain("ifNull(dateDiff");
  });

  it("keeps custom metrics on the cadence window when freshness needs a lookback", () => {
    const compiled = compileDataHealthQuery(
      { sourceType: "table", databaseName: "analytics", tableName: "orders", eventTimeColumn: "created_at" },
      [
        { checkKey: "freshness", name: "Freshness", type: "freshness", severity: "critical", enabled: true, config: { eventTimeColumn: "created_at", maxAgeSeconds: 3600 } },
        { checkKey: "paid", name: "Paid", type: "custom_metric", severity: "warning", enabled: true, config: { expression: "countIf(status = 'paid')", operator: "gte", threshold: 1 } },
      ],
    );

    expect(compiled.sql).toContain("{{slot_end - 3600s}}");
    expect(compiled.sql).toContain("FROM `analytics`.`orders` AS dh_source\nWHERE (`created_at` >= {{slot_start}} AND `created_at` < {{slot_end}})");
    expect(compiled.sql).not.toContain("{{slot_start - 3600s}}");
  });

  it("converts Unix and string event-time columns before applying windows", () => {
    const unix = compileDataHealthQuery(
      { sourceType: "table", databaseName: "analytics", tableName: "events", eventTimeColumn: "timestamp_ms", eventTimeType: "UInt64", eventTimeEncoding: "unix_milliseconds" },
      [{ checkKey: "rows", name: "Rows", type: "row_count", severity: "critical", enabled: true, config: { min: 1 } }],
    );
    expect(unix.sql).toContain("fromUnixTimestamp64Milli(toInt64(`timestamp_ms`), 'UTC')");

    const string = compileDataHealthQuery(
      { sourceType: "table", databaseName: "analytics", tableName: "events", eventTimeColumn: "created_at", eventTimeType: "Nullable(String)", eventTimeEncoding: "string", eventTimeTimezone: "Asia/Jakarta" },
      [{ checkKey: "rows", name: "Rows", type: "row_count", severity: "critical", enabled: true, config: { min: 1 } }],
    );
    expect(string.sql).toContain("parseDateTime64BestEffortOrNull(toString(`created_at`), 3, 'Asia/Jakarta') >= {{slot_start}}");
  });

  it("reinterprets naïve native wall-clock values in their declared timezone", () => {
    const compiled = compileDataHealthQuery(
      { sourceType: "table", databaseName: "analytics", tableName: "events", eventTimeColumn: "created_at", eventTimeType: "DateTime", eventTimeEncoding: "native", eventTimeTimezone: "Asia/Jakarta" },
      [{ checkKey: "rows", name: "Rows", type: "row_count", severity: "critical", enabled: true, config: { min: 1 } }],
    );
    expect(compiled.sql).toContain("parseDateTime64BestEffortOrNull(toString(`created_at`), 3, 'Asia/Jakarta')");
  });

  it("compiles independent multi-column rules and composite uniqueness keys", () => {
    const multiChecks: DataHealthCheckDefinition[] = [
      { checkKey: "complete_customer", name: "Customer", type: "completeness", severity: "warning", enabled: true, config: { column: "customer_id", minRatio: 0.99 } },
      { checkKey: "complete_email", name: "Email", type: "completeness", severity: "warning", enabled: true, config: { column: "email", minRatio: 0.95 } },
      { checkKey: "unique_order_line", name: "Order line key", type: "uniqueness", severity: "critical", enabled: true, config: { columns: ["order_id", "line_id"], maxDuplicateRatio: 0 } },
      { checkKey: "valid_amount", name: "Valid amount", type: "validity", severity: "warning", enabled: true, config: { predicate: "amount >= 0", minRatio: 1 } },
      { checkKey: "paid_orders", name: "Paid orders", type: "custom_metric", severity: "warning", enabled: true, config: { expression: "countIf(status = 'paid')", operator: "gte", threshold: 1 } },
      { checkKey: "refunds", name: "Refunds", type: "custom_metric", severity: "warning", enabled: true, config: { expression: "countIf(status = 'refunded')", operator: "lte", threshold: 10 } },
    ];
    const compiled = compileDataHealthQuery(
      { sourceType: "table", databaseName: "analytics", tableName: "orders", eventTimeColumn: "created_at" },
      multiChecks,
    );

    expect(compiled.sql).toContain("tuple(`order_id`, `line_id`)");
    for (const check of multiChecks) expect(compiled.sql).toContain(`AS \`${check.checkKey}\``);
    expect(compiled.metricCheckKeys).toEqual(multiChecks.map((check) => check.checkKey));
  });
});
