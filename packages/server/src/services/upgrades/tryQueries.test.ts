import { describe, expect, it } from "bun:test";

import { tryFindings } from "./match";
import { analyzerOn, copiedSettings, ExplainError, normalisePlan, shortError, targetSettings, triable, tryShapes, type Explain, type TryShape } from "./tryQueries";
import { visibleAssessment } from "../../routes/upgrades";

const shape = (over: Partial<TryShape> = {}): TryShape => ({
  hash: "h1", query: "SELECT sum(v) FROM shop.a HAVING id > 0", settings: {}, users: ["bi_reader"], clients: ["Metabase"], runs7d: 120, tables: ["shop.a"], ...over,
});

/**
 * A fake server: `HAVING id > 0` fails with the analyzer (as on a real 25.8),
 * `max_bytes_ratio` = 2 breaks the "ratio" query, "broken" fails always, and
 * "plans" differ between analyzers.
 */
function fakeExplain(log: Array<Record<string, string>> = []): Explain {
  return async (query, settings) => {
    log.push(settings);
    const analyzer = settings.enable_analyzer !== "0";
    if (settings.bad_setting) throw new ExplainError("UNKNOWN_SETTING", "Setting bad_setting is neither a builtin setting nor started with the prefix 'custom_'");
    if (query.includes("broken")) throw new ExplainError("UNKNOWN_TABLE", "Table shop.broken does not exist");
    if (query.includes("HAVING id > 0") && analyzer) throw new ExplainError("NOT_AN_AGGREGATE", "Column id is not under aggregate function");
    if (query.includes("ratio") && settings.max_bytes_ratio === "2") throw new ExplainError("BAD_ARGUMENTS", "ratio too high");
    return query.includes("changes") && settings.join_algorithm === "hash" ? "Expression\\n  Join (hash)" : "Expression\\n  ReadFromMergeTree";
  };
}

describe("pure helpers", () => {
  it("tries read-only shapes only", () => {
    expect(triable("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(true);
    expect(triable("  select 1")).toBe(true);
    expect(triable("INSERT INTO t SELECT 1")).toBe(false);
    expect(triable("SELECT * FROM system.parts")).toBe(false);
  });

  it("copies a shape's own settings, never CHouse's or the client's", () => {
    expect(copiedSettings({ enable_analyzer: "0", max_threads: "4", readonly: "1", log_comment: "x", max_execution_time: "5", output_format_json_quote_64bit_integers: "0", http_wait_end_of_query: "1", receive_timeout: "10" }))
      .toEqual({ enable_analyzer: "0", max_threads: "4" });
  });

  it("builds the target's settings: its own, the new defaults, the analyzer on", () => {
    const plan = { analyzer: "enable_analyzer", changed: { join_algorithm: "hash" } };
    expect(targetSettings({ enable_analyzer: "0", max_threads: "4" }, plan)).toEqual({ enable_analyzer: "1", max_threads: "4", join_algorithm: "hash" });
    // A pinned compatibility keeps the old defaults after the upgrade, but not the old analyzer.
    expect(targetSettings({ compatibility: "24.8", enable_analyzer: "0" }, plan)).toEqual({ compatibility: "24.8", enable_analyzer: "1" });
    // On a server that only knows the old name, that name is used.
    expect(targetSettings({ enable_analyzer: "0" }, { analyzer: "allow_experimental_analyzer", changed: {} })).toEqual({ allow_experimental_analyzer: "1" });
  });

  it("reads whether a shape ran with the analyzer", () => {
    expect(analyzerOn({}, "enable_analyzer")).toBe(true);
    expect(analyzerOn({ enable_analyzer: "0" }, "enable_analyzer")).toBe(false);
    expect(analyzerOn({ allow_experimental_analyzer: "false" }, "allow_experimental_analyzer")).toBe(false);
  });

  it("keeps errors short and free of query text", () => {
    expect(shortError("Code: 215. DB::Exception: Column id is not under aggregate function. In scope SELECT sum(v) FROM shop.a HAVING id > 0. (NOT_AN_AGGREGATE) (version 25.8.33.6 (official build))"))
      .toBe("Column id is not under aggregate function.");
    expect(shortError("Column 'shop.a.id' is not under aggregate function and not in GROUP BY keys. In query SELECT sum(v) FROM shop.a HAVING id > 1."))
      .toBe("Column 'shop.a.id' is not under aggregate function and not in GROUP BY keys.");
    expect(shortError("Different expressions with the same alias x: x + 1 AS x and id AS x : While processing x + 1 AS x. (MULTIPLE_EXPRESSIONS_FOR_ALIAS)"))
      .toBe("Different expressions with the same alias x: x + 1 AS x and id AS x :");
    expect(normalisePlan("  A\n\n   B  \n")).toBe("A\nB");
  });
});

describe("trying shapes", () => {
  it("finds a shape that only fails with the analyzer, and names the analyzer as the cause", async () => {
    const r = await tryShapes(fakeExplain(), [shape({ settings: { enable_analyzer: "0" } })], { analyzer: "enable_analyzer", changed: {} });
    expect(r.tried).toBe(1);
    expect(r.failing).toHaveLength(1);
    expect(r.failing[0].error).toEqual({ type: "NOT_AN_AGGREGATE", message: "Column id is not under aggregate function" });
    expect(r.failing[0].cause).toBe("enable_analyzer");
  });

  it("skips a shape that fails today too, and one that already fails with the analyzer on", async () => {
    const r = await tryShapes(fakeExplain(), [shape({ hash: "broken", query: "SELECT * FROM shop.broken" }), shape({ hash: "h2", settings: {} })], { analyzer: "enable_analyzer", changed: {} });
    expect(r).toMatchObject({ tried: 0, skipped: 2, failing: [] });
  });

  it("names a changed default as the cause when it alone breaks the shape", async () => {
    const r = await tryShapes(fakeExplain(), [shape({ hash: "r", query: "SELECT ratio FROM shop.a" })], { analyzer: "enable_analyzer", changed: { join_algorithm: "hash", max_bytes_ratio: "2" } });
    expect(r.failing[0].cause).toBe("max_bytes_ratio");
  });

  it("drops target settings this server refuses instead of failing every shape", async () => {
    const r = await tryShapes(fakeExplain(), [shape({ hash: "ok", query: "SELECT v FROM shop.a" })], { analyzer: "enable_analyzer", changed: { join_algorithm: "hash", bad_setting: "1" } });
    expect(r.dropped).toEqual(["bad_setting"]);
    expect(r.applied).toEqual({ join_algorithm: "hash" });
    expect(r.failing).toEqual([]);
  });

  it("compares plans only for shapes already on the analyzer", async () => {
    const shapes = [shape({ hash: "c1", query: "SELECT changes FROM shop.a" }), shape({ hash: "c2", query: "SELECT changes FROM shop.b", settings: { enable_analyzer: "0" } })];
    const r = await tryShapes(fakeExplain(), shapes, { analyzer: "enable_analyzer", changed: { join_algorithm: "hash" } });
    expect(r.compared).toBe(1);
    expect(r.planChanged.map((s) => s.hash)).toEqual(["c1"]);
  });

  it("stops at the time budget", async () => {
    let t = 0;
    const clock = (): number => (t += 40_000);
    const r = await tryShapes(fakeExplain(), [shape({ hash: "a", query: "SELECT v FROM a" }), shape({ hash: "b", query: "SELECT v FROM b" }), shape({ hash: "c", query: "SELECT v FROM c" })], { analyzer: null, changed: {} }, clock);
    expect(r.budgetExhausted).toBe(true);
    expect(r.tried).toBeLessThan(3);
  });

  it("never sends CHouse's own settings through the shape's", async () => {
    const log: Array<Record<string, string>> = [];
    await tryShapes(fakeExplain(log), [shape({ settings: copiedSettings({ enable_analyzer: "0", readonly: "1" }) })], { analyzer: "enable_analyzer", changed: {} });
    expect(log.every((s) => s.readonly === undefined)).toBe(true);
  });
});

describe("findings from trying", () => {
  const failing = { ...shape({ settings: { enable_analyzer: "0" } }), error: { type: "NOT_AN_AGGREGATE", message: "Column id is not under aggregate function" }, cause: "enable_analyzer" };
  const result = { readable: true, tried: 10, skipped: 1, failing: [failing], planChanged: [shape({ hash: "p" })], compared: 9, applied: {}, dropped: [], budgetExhausted: false };

  it("groups failures by cause, says the analyzer can't be turned off from 26.9, and lists plan changes", () => {
    const fs = tryFindings(result, "26.10.3.7", "26.10", []);
    expect(fs.map((f) => `${f.key}:${f.severity}`)).toEqual(["tried:enable_analyzer:blocker", "tried:plan-changed:info"]);
    expect(fs[0].title).toBe("1 query shape fails with 26.10.3.7's settings, with the new analyzer");
    expect(fs[0].detail).toContain("From 26.9 the analyzer can't be turned off");
    expect(fs[0].evidence.rows[0]).toMatchObject({ cells: ["NOT_AN_AGGREGATE", "bi_reader", "Metabase", "120"], tables: ["shop.a"], detail: "Column id is not under aggregate function" });
    expect(tryFindings(result, "26.8.36.3", "26.8", [])[0].detail).toContain("plan today only because");
  });

  it("hides rows on tables the reader can't see, and query text without query history access", () => {
    const fs = tryFindings(result, "26.10.3.7", "26.10", []);
    const a = { id: "a", connectionId: "c", currentVersion: "25.8.33.6", targetVersion: "26.10.3.7", status: "done" as const, createdAt: 0, finishedAt: 1,
      summary: { stage: "done" as const, mode: "notes" as const, target: { version: "26.10.3.7", line: "26.10" }, reference: null },
      findings: fs.map((f, i) => ({ ...f, id: `f${i}` })) };
    const noQuery = visibleAssessment(a, () => true, false);
    expect(noQuery.findings[0].evidence.rows[0].query).toBeUndefined();
    expect(visibleAssessment(a, () => true, true).findings[0].evidence.rows[0].query).toContain("HAVING");
    const noShop = visibleAssessment(a, (db) => db !== "shop", true);
    expect(noShop.findings[0].evidence.rows).toEqual([]);
    expect(noShop.hiddenRows).toBe(2);
  });
});
