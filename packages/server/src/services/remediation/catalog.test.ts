import { describe, expect, it } from "bun:test";

import { ACTION_TYPES, CONTEXT_ONLY_TYPES, actionParamsSchema, buildAction, compare, mergeSettingsList, quoteIdent, quoteString, REQUIRED_GRANTS, rollupPanelSql } from "./catalog";

const ROLLUP = {
  dashboardId: "0b6f3c1e-7a51-4f2e-9a43-5d8e6f1b2c3d",
  panelId: "1c7e4d2f-8b62-4a3f-8b54-6e9f7a2c3d4e",
  database: "shop",
  table: "orders",
  timeColumn: "ts",
  bucketAlias: "t",
  target: "chouse_rollup_0123456789ab",
  groups: [{ column: "status", alias: "status" }],
  aggregates: [{ fn: "count", column: null, alias: "n" }, { fn: "sum", column: "bytes", alias: "b" }],
  filters: [{ column: "env", op: "=", value: "it's prod" }],
  backfillDays: 7,
  cluster: null,
};
const TYPES = { bucket: "DateTime", g_status: "LowCardinality(String)", a_n: "AggregateFunction(count)", a_b: "AggregateFunction(sum, UInt64)" };

describe("actionParamsSchema", () => {
  it("rejects free-form SQL in identifiers and expressions", () => {
    expect(actionParamsSchema.safeParse({ type: "restart_replica", database: "shop; DROP TABLE x", table: "t" }).success).toBe(false);
    expect(actionParamsSchema.safeParse({ type: "modify_ttl", database: "d", table: "t", ttl: "ts + INTERVAL 7 DAY; DROP TABLE x" }).success).toBe(false);
    expect(actionParamsSchema.safeParse({ type: "modify_ttl", database: "d", table: "t", ttl: "ts + INTERVAL 7 DAY -- x" }).success).toBe(false);
    expect(actionParamsSchema.safeParse({ type: "kill_query", queryId: "x' OR 1=1" }).success).toBe(false);
  });

  it("accepts every catalog type with valid parameters", () => {
    const samples: Record<string, unknown> = {
      kill_query: { queryId: "7f3a-e1" },
      pause_scheduled_job: { jobId: "job-1" },
      resume_scheduled_job: { jobId: "job-1" },
      delay_scheduled_job: { jobId: "job-1", until: 1_800_000_000_000 },
      set_profile_setting: { targetKind: "user", targetName: "vector", setting: "async_insert", value: 1 },
      optimize_partition: { database: "logs", table: "app_errors", partitionId: "202610" },
      restart_replica: { database: "d", table: "t" },
      add_skip_index: { database: "d", table: "t", name: "idx_user", expression: "user_id", indexType: "bloom_filter(0.01)" },
      modify_ttl: { database: "d", table: "t", ttl: "ts + INTERVAL 7 DAY" },
      modify_column_codec: { database: "d", table: "t", column: "c", codec: "ZSTD(6)" },
      restart_engine_table: { database: "d", table: "q" },
      reload_dictionary: { database: "d", name: "dict" },
      refresh_view: { database: "d", view: "v" },
      flush_distributed: { database: "d", table: "dist" },
      create_panel_rollup: ROLLUP,
    };
    for (const type of ACTION_TYPES) {
      const parsed = actionParamsSchema.safeParse({ type, ...(samples[type] as object) });
      expect(parsed.success).toBe(true);
      expect(type in REQUIRED_GRANTS).toBe(true);
    }
  });
});

describe("buildAction", () => {
  it("quotes identifiers and literals", () => {
    const built = buildAction({ type: "optimize_partition", database: "logs", table: "app_errors", partitionId: "202610", final: true });
    expect(built.statements).toEqual(["OPTIMIZE TABLE `logs`.`app_errors` PARTITION ID '202610' FINAL"]);
    expect(built.windowOnly).toBe(true);
    expect(() => quoteIdent("a`b")).toThrow();
    expect(quoteString("it's")).toBe("'it\\'s'");
  });

  it("set_profile_setting replaces the full SETTINGS list and rolls back to the prior list", () => {
    const built = buildAction(
      { type: "set_profile_setting", targetKind: "user", targetName: "vector", setting: "async_insert", value: 1 },
      { settingsList: "max_threads = 8, async_insert = 0 MIN 0 MAX 1" },
    );
    expect(built.statements).toEqual(["ALTER USER `vector` SETTINGS max_threads = 8, async_insert = 1"]);
    expect(built.rollback).toEqual(["ALTER USER `vector` SETTINGS max_threads = 8, async_insert = 0 MIN 0 MAX 1"]);
    const fresh = buildAction({ type: "set_profile_setting", targetKind: "profile", targetName: "bi", setting: "max_threads", value: 16 });
    expect(fresh.statements[0]).toBe("ALTER SETTINGS PROFILE `bi` SETTINGS max_threads = 16");
    expect(fresh.rollback).toEqual(["ALTER SETTINGS PROFILE `bi` SETTINGS NONE"]);
  });

  it("generates reversible schema actions with approval class 2", () => {
    const idx = buildAction({ type: "add_skip_index", database: "events", table: "page_views", name: "idx_user", expression: "user_id", indexType: "bloom_filter", granularity: 4 });
    expect(idx.approvalClass).toBe(2);
    expect(idx.rollback).toEqual(["ALTER TABLE `events`.`page_views` DROP INDEX `idx_user`"]);
    const ttl = buildAction({ type: "modify_ttl", database: "logs", table: "debug", ttl: "ts + INTERVAL 7 DAY" }, { ttl: "" });
    expect(ttl.rollback).toEqual(["ALTER TABLE `logs`.`debug` REMOVE TTL"]);
    const codec = buildAction({ type: "modify_column_codec", database: "m", table: "s", column: "ts", codec: "Delta, ZSTD(1)" }, { codec: "CODEC(LZ4)" });
    expect(codec.rollback).toEqual(["ALTER TABLE `m`.`s` MODIFY COLUMN `ts` CODEC(LZ4)"]);
  });

  it("covers every pipeline kind with a source-neutral recovery action", () => {
    expect(buildAction({ type: "restart_engine_table", database: "shop", table: "orders_queue" }).statements).toEqual(["DETACH TABLE `shop`.`orders_queue`", "ATTACH TABLE `shop`.`orders_queue`"]);
    expect(buildAction({ type: "reload_dictionary", database: "d", name: "customers" }).statements[0]).toBe("SYSTEM RELOAD DICTIONARY `d`.`customers`");
    expect(buildAction({ type: "refresh_view", database: "ref", view: "fx" }).statements[0]).toBe("SYSTEM REFRESH VIEW `ref`.`fx`");
    expect(buildAction({ type: "flush_distributed", database: "d", table: "dist" }).statements[0]).toBe("SYSTEM FLUSH DISTRIBUTED `d`.`dist`");
  });

  it("scheduled-job actions are internal, not SQL", () => {
    const built = buildAction({ type: "delay_scheduled_job", jobId: "j1", until: 1_800_000_000_000 });
    expect(built.statements).toEqual([]);
    expect(built.internal).toEqual({ kind: "job_delay", jobId: "j1", until: 1_800_000_000_000 });
  });
});

describe("helpers", () => {
  it("mergeSettingsList keeps constraints of other settings", () => {
    expect(mergeSettingsList("", "a", 1)).toBe("a = 1");
    expect(mergeSettingsList("PROFILE 'base', b = 'x'", "a", "y")).toBe("PROFILE 'base', b = 'x', a = 'y'");
  });

  it("compare implements every comparator", () => {
    expect(compare(0, "eq", 0)).toBe(true);
    expect(compare(1, "lt", 2)).toBe(true);
    expect(compare(2, "lte", 2)).toBe(true);
    expect(compare(3, "gt", 2)).toBe(true);
    expect(compare(2, "gte", 3)).toBe(false);
  });
});

describe("create_panel_rollup", () => {
  const params = actionParamsSchema.parse({ type: "create_panel_rollup", ...ROLLUP });

  it("builds the table, view and backfill from typed parameters and the types read at proposal", () => {
    const built = buildAction(params, { rollup: { panelSql: "x", types: TYPES } });
    expect(built.statements).toEqual([
      "CREATE TABLE `shop`.`chouse_rollup_0123456789ab` (`bucket` DateTime, `g_status` LowCardinality(String), `a_n` AggregateFunction(count), `a_b` AggregateFunction(sum, UInt64)) ENGINE = AggregatingMergeTree ORDER BY (`g_status`, bucket)",
      "CREATE MATERIALIZED VIEW `shop`.`chouse_rollup_0123456789ab_mv` TO `shop`.`chouse_rollup_0123456789ab` AS SELECT toStartOfMinute(`ts`) AS `bucket`, `status` AS `g_status`, countState() AS `a_n`, sumState(`bytes`) AS `a_b` FROM `shop`.`orders` WHERE `env` = 'it\\'s prod' GROUP BY `bucket`, `g_status`",
      "INSERT INTO `shop`.`chouse_rollup_0123456789ab` SELECT toStartOfMinute(`ts`) AS `bucket`, `status` AS `g_status`, countState() AS `a_n`, sumState(`bytes`) AS `a_b` FROM `shop`.`orders` WHERE `env` = 'it\\'s prod' AND `ts` >= toStartOfMinute(now()) - INTERVAL 7 DAY AND `ts` < toStartOfMinute(now()) GROUP BY `bucket`, `g_status`",
    ]);
    expect(built).toMatchObject({ approvalClass: 2, windowOnly: true, rollback: ["DROP TABLE IF EXISTS `shop`.`chouse_rollup_0123456789ab_mv` SYNC", "DROP TABLE IF EXISTS `shop`.`chouse_rollup_0123456789ab` SYNC"] });
    expect(built.verification).toMatchObject({ comparator: "eq", threshold: 0 });
    expect(built.verification.sql).toContain("EXCEPT");
    // An empty rollup compares nothing, rather than the source table's whole history.
    expect(built.verification.sql).toContain("minOrNull(bucket)");
    expect(built.verification.probeSeconds).toBe(280);
    expect(rollupPanelSql(params)).toBe("SELECT toStartOfInterval(bucket, toIntervalSecond(greatest({{interval_s}}, 60))) AS `t`, `g_status` AS `status`, countMerge(`a_n`) AS `n`, sumMerge(`a_b`) AS `b`\nFROM `shop`.`chouse_rollup_0123456789ab`\nWHERE bucket >= toStartOfMinute({{from}}) AND bucket < {{to}}\nGROUP BY `t`, `status`\nORDER BY `t`");
  });

  it("goes ON CLUSTER with a replicated engine on a cluster", () => {
    const built = buildAction({ ...params, cluster: "main" }, { rollup: { panelSql: "x", types: TYPES } });
    expect(built.statements[0]).toContain("ON CLUSTER `main`");
    expect(built.statements[0]).toContain("ReplicatedAggregatingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')");
    expect(built.statements[1]).toContain("ON CLUSTER `main`");
    expect(built.rollback?.every((s) => s.includes("ON CLUSTER `main`"))).toBe(true);
  });

  it("refuses to build without usable types, and is never proposed from the generic catalog", () => {
    expect(() => buildAction(params)).toThrow("A rollup is built from the column types read when it was proposed");
    expect(() => buildAction(params, { rollup: { panelSql: "x", types: { ...TYPES, a_b: "AggregateFunction(sum, UInt64); DROP TABLE x" } } })).toThrow("The rollup column a_b has no usable type");
    expect(CONTEXT_ONLY_TYPES.has("create_panel_rollup")).toBe(true);
    expect(actionParamsSchema.safeParse({ type: "create_panel_rollup", ...ROLLUP, target: "orders" }).success).toBe(false);
    expect(actionParamsSchema.safeParse({ type: "create_panel_rollup", ...ROLLUP, backfillDays: 90 }).success).toBe(false);
  });
});
