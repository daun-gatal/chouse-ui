import { describe, expect, it } from "bun:test";

import { compareVersions, matchRules, replayable, replayQuery, RULES } from "./assess";

const facts = {
  columnTypes: [{ table: "events.raw", column: "payload", type: "Object('json')" }],
  databaseEngines: [{ database: "crm", engine: "MaterializedPostgreSQL" }, { database: "shop", engine: "Atomic" }],
  profileSettings: [{ target: "bi", setting: "compatibility", value: "23.8" }, { target: "legacy", setting: "enable_analyzer", value: "0" }],
  querySettings: [{ setting: "allow_experimental_object_type", value: "1", shapes: 3 }],
  functions: [],
};

describe("upgrade rules", () => {
  it("compares dotted versions numerically", () => {
    expect(compareVersions("25.3.1.2", "24.11")).toBeGreaterThan(0);
    expect(compareVersions("24.8", "24.8.0")).toBe(0);
    expect(compareVersions("9.1", "10.0")).toBeLessThan(0);
  });

  it("matches the workload and respects each rule's version", () => {
    const findings = matchRules(RULES, facts, "25.3");
    const ids = findings.map((f) => f.evidence.ruleId);
    expect(ids).toContain("legacy-object-json-type");
    expect(ids).toContain("old-analyzer-pinned");
    expect(ids).toContain("compatibility-pinned");
    expect(ids).toContain("experimental-database-engines");
    expect(ids).toContain("experimental-settings-in-queries");
    expect(ids).not.toContain("ordinary-database-engine");
    expect(matchRules(RULES, facts, "24.1").map((f) => f.evidence.ruleId)).not.toContain("legacy-object-json-type");
  });
});

describe("workload replay", () => {
  it("only replays deterministic read-only shapes", () => {
    expect(replayable("SELECT day, sum(revenue) FROM analytics.orders_daily GROUP BY day")).toBe(true);
    expect(replayable("SELECT * FROM t WHERE day = today()")).toBe(false);
    expect(replayable("SELECT * FROM system.parts")).toBe(false);
    expect(replayable("INSERT INTO t SELECT 1")).toBe(false);
  });

  it("wraps a query in an order-insensitive result hash", () => {
    expect(replayQuery("SELECT 1;")).toBe("SELECT count() AS c, sum(cityHash64(*)) AS h FROM (SELECT 1)");
  });
});
