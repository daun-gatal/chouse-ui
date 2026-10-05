import { describe, expect, it } from "bun:test";

import { compareVersions, isMissingObject, matchRules, replayable, replayQuery, replayShape, RULES, stripFormat } from "./assess";

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
    // HTTP clients append a FORMAT clause; it is stripped, not a reason to skip the shape.
    expect(replayable("SELECT sum(number) FROM numbers(10) FORMAT JSONEachRow")).toBe(true);
    expect(replayQuery("SELECT sum(number) FROM numbers(10) FORMAT JSONEachRow")).toBe("SELECT count() AS c, sum(cityHash64(*)) AS h FROM (SELECT sum(number) FROM numbers(10))");
  });
});

describe("replay outcomes", () => {
  const ok = (hash: string, ms = 10) => async (): Promise<{ hash: string; ms: number }> => ({ hash, ms });
  const fail = (message: string, code?: string) => async (): Promise<never> => {
    throw Object.assign(new Error(message), code ? { code } : {});
  };
  const never = async (): Promise<never> => {
    throw new Error("canary must not run");
  };

  it("skips a shape the baseline can no longer run, without touching the canary", async () => {
    const r = await replayShape(fail("Database e2e_sq does not exist.", "81"), never);
    expect(r.outcome).toBe("skipped");
    expect(r.canary).toBeNull();
    expect(r.error).toContain("e2e_sq");
  });

  it("reports an object missing only on the canary as missing", async () => {
    const r = await replayShape(ok("1:2", 3), fail("Unknown table expression identifier 'public.test_2' in scope SELECT * FROM public.test_2 LIMIT 100.", "60"));
    expect(r.outcome).toBe("missing");
    expect(r.baseline?.ms).toBe(3);
  });

  it("keeps other canary failures as errors", async () => {
    expect((await replayShape(ok("1:2"), fail("Timeout exceeded: elapsed 60 seconds", "159"))).outcome).toBe("error");
  });

  it("compares hashes and latency", async () => {
    expect((await replayShape(ok("1:2"), ok("1:2"))).outcome).toBe("same");
    expect((await replayShape(ok("1:2"), ok("1:3"))).outcome).toBe("differs");
    expect((await replayShape(ok("1:2", 100), ok("1:2", 200))).outcome).toBe("slower");
    // Tiny queries are noisy; under 50 ms is never "slower".
    expect((await replayShape(ok("1:2", 5), ok("1:2", 20))).outcome).toBe("same");
  });

  it("recognises missing objects by code or message", () => {
    expect(isMissingObject(Object.assign(new Error("x"), { code: "60" }))).toBe(true);
    expect(isMissingObject(Object.assign(new Error("x"), { code: "81" }))).toBe(true);
    expect(isMissingObject(Object.assign(new Error("x"), { code: "47" }))).toBe(true);
    expect(isMissingObject(new Error("Table analytics.orders does not exist."))).toBe(true);
    expect(isMissingObject(new Error("Unknown table expression identifier 't'"))).toBe(true);
    expect(isMissingObject(Object.assign(new Error("Memory limit exceeded"), { code: "241" }))).toBe(false);
    expect(isMissingObject("not an error")).toBe(false);
  });

  it("displays the replayed text without the logged FORMAT clause", () => {
    expect(stripFormat("SELECT * FROM public.test_2 LIMIT 100 FORMAT JSON")).toBe("SELECT * FROM public.test_2 LIMIT 100");
  });
});
