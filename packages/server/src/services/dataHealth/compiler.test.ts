import { describe, expect, it } from "bun:test";

import { compileDataHealthQuery, eventTimeExpression, timePartitionPredicate } from "./compiler";
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
    expect(string.sql).toContain("toTimeZone(parseDateTime64BestEffortOrNull(toString(`created_at`), 3, 'Asia/Jakarta'), 'UTC') >= {{slot_start}}");
  });

  it("compares native ClickHouse time columns directly with UTC slot parameters", () => {
    const compiled = compileDataHealthQuery(
      { sourceType: "table", databaseName: "analytics", tableName: "events", eventTimeColumn: "created_at", eventTimeType: "DateTime", eventTimeEncoding: "native", eventTimeTimezone: "Asia/Jakarta" },
      [{ checkKey: "rows", name: "Rows", type: "row_count", severity: "critical", enabled: true, config: { min: 1 } }],
    );
    expect(compiled.sql).toContain("`created_at` >= {{slot_start}}");
    expect(compiled.sql).not.toContain("parseDateTime64BestEffortOrNull");
  });

  it("adds automatic pruning for time-based partition styles", () => {
    expect(timePartitionPredicate("toYYYYMM(event_time)", [{ name: "event_time", type: "DateTime('Asia/Jakarta')" }])).toBe(
      "toYYYYMM(event_time) >= toYYYYMM({{slot_start - 1d}}) AND toYYYYMM(event_time) <= toYYYYMM({{slot_end + 1d}})",
    );
    expect(timePartitionPredicate("partition_date", [{ name: "partition_date", type: "Date" }])).toBe(
      "`partition_date` >= toDate({{slot_start - 1d}}) AND `partition_date` <= toDate({{slot_end + 1d}})",
    );
    expect(timePartitionPredicate("toDate(event_time, 'Asia/Jakarta')", [{ name: "event_time", type: "DateTime" }])).toBe(
      "toDate(event_time, 'Asia/Jakarta') >= toDate({{slot_start - 1d}}, 'Asia/Jakarta') AND toDate(event_time, 'Asia/Jakarta') <= toDate({{slot_end + 1d}}, 'Asia/Jakarta')",
    );
    expect(timePartitionPredicate("tenant_id", [{ name: "tenant_id", type: "String" }])).toBeNull();
  });

  it("keeps the UTC event predicate authoritative when applying local-date partition pruning", () => {
    const compiled = compileDataHealthQuery(
      {
        sourceType: "table",
        databaseName: "analytics",
        tableName: "events",
        eventTimeColumn: "event_time",
        partitionKey: "toDate(local_event_time)",
        partitionColumns: [{ name: "local_event_time", type: "DateTime('Asia/Jakarta')" }],
      },
      [{ checkKey: "rows", name: "Rows", type: "row_count", severity: "critical", enabled: true, config: { min: 1 } }],
    );
    expect(compiled.sql).toContain("`event_time` >= {{slot_start}} AND `event_time` < {{slot_end}}");
    expect(compiled.sql).toContain("toDate(local_event_time) >= toDate({{slot_start - 1d}})");
  });

  it("maps UTC windows to the configured calendar timezone for Date event time", () => {
    const compiled = compileDataHealthQuery(
      {
        sourceType: "table",
        databaseName: "analytics",
        tableName: "daily_orders",
        eventTimeColumn: "business_date",
        eventTimeType: "Date",
        eventTimeEncoding: "native",
        eventTimeTimezone: "Asia/Jakarta",
      },
      [{ checkKey: "rows", name: "Rows", type: "row_count", severity: "critical", enabled: true, config: { min: 1 } }],
    );
    expect(compiled.sql).toContain("`business_date` >= toDate({{slot_start}}, 'Asia/Jakarta') AND `business_date` < toDate({{slot_end}}, 'Asia/Jakarta')");
  });

  it("measures Date freshness from the end of the latest local calendar day", () => {
    const compiled = compileDataHealthQuery(
      {
        sourceType: "table",
        databaseName: "analytics",
        tableName: "daily_orders",
        eventTimeColumn: "business_date",
        eventTimeType: "Date32",
        eventTimeEncoding: "native",
        eventTimeTimezone: "Asia/Jakarta",
      },
      [{ checkKey: "freshness", name: "Freshness", type: "freshness", severity: "critical", enabled: true, config: { eventTimeColumn: "business_date", maxAgeSeconds: 86_400 } }],
    );
    expect(compiled.sql).toContain("`business_date` >= toDate({{slot_end - 86400s}}, 'Asia/Jakarta')");
    expect(compiled.sql).toContain("toTimeZone(toDateTime(addDays(max(`business_date`), 1), 'Asia/Jakarta'), 'UTC')");
  });

  it("rejects Date event time without a calendar timezone", () => {
    expect(() => compileDataHealthQuery(
      { sourceType: "table", databaseName: "analytics", tableName: "daily_orders", eventTimeColumn: "business_date", eventTimeType: "Date", eventTimeEncoding: "native" },
      [{ checkKey: "rows", name: "Rows", type: "row_count", severity: "critical", enabled: true, config: { min: 1 } }],
    )).toThrow("calendar timezone");
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
