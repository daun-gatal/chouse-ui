/**
 * Incident titles from summaries that end in a whole ClickHouse error: every
 * place that shows a title shortens it, and the stored summary stays complete.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase, initializeDatabase } = await import("../../rbac/db");
const { runMigrations } = await import("../../rbac/db/migrations");
const h = await import("../../rbac/db/migrationTestHarness");
const { incidentTitle } = await import("./incidents");
const views = await import("./views");
const { getStoredRca } = await import("./rcaService");
const { loadAnnotations } = await import("../dashboards/annotations");

const ERROR = `Hourly join: 1 errors in the last 3 samples: Identifier 'q.hostname' cannot be resolved from table with name q. In scope SELECT q.hostname AS hostname, ${"sum(q.read_rows) AS read_rows, ".repeat(30)}FROM system.query_log AS q`;
const MULTILINE = "Code: 241. DB::Exception: Memory limit exceeded\nStack trace:\n0. DB::Exception::Exception";
const T0 = 1_000_000;
const allowAll = new Map([["c1", (): boolean => true]]);

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
  const ts = sql`unixepoch()`;
  await h.rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, created_at, updated_at) VALUES ('c1', 'node-a', 'localhost', 8123, 'default', ${ts}, ${ts})`);
  await h.rawRun(sql`INSERT INTO scheduled_queries (id, name, connection_id, query) VALUES ('q1', 'Daily orders', 'c1', 'SELECT count() FROM orders')`);
  await h.rawRun(sql`INSERT INTO data_health_promises (id, scheduled_query_id, name, connection_id, database_name, table_name) VALUES ('p1', 'q1', 'Orders fresh', 'c1', 'sales', 'orders')`);
  await h.rawRun(sql`INSERT INTO data_health_incidents (id, promise_id, status, severity, summary, opened_at, last_event_at) VALUES ('dh1', 'p1', 'open', 'critical', ${`upstream pipeline failed: ${ERROR}`}, ${T0}, ${T0})`);
  await h.rawRun(sql`INSERT INTO obs_incidents (id, connection_id, kind, subject_ref, severity, summary, opened_at, last_event_at) VALUES
    ('ob-long', 'c1', 'engine', 'engine', 'critical', ${ERROR}, ${T0 + 1}, ${T0 + 1}),
    ('ob-multi', 'c1', 'engine', 'engine-2', 'warning', ${MULTILINE}, ${T0 + 2}, ${T0 + 2}),
    ('ob-short', 'c1', 'engine', 'engine-3', 'warning', 'Kafka lag rising', ${T0 + 3}, ${T0 + 3})`);
  await h.rawRun(sql`INSERT INTO incident_rca (incident_source, incident_id, computed_at, signature, chain, root_cause, related)
    VALUES ('observe', 'ob-short', ${T0}, 'sig', '[]', NULL, ${JSON.stringify([{ source: "observe", id: "ob-long", reason: "same root-cause chain" }, { source: "data_health", id: "dh1", reason: "same root-cause chain" }])})`);
}, 60_000);

afterAll(async () => {
  await closeDatabase();
});

describe("incidentTitle", () => {
  it("keeps a short summary as it is", () => {
    expect(incidentTitle("Kafka lag rising")).toBe("Kafka lag rising");
    expect(incidentTitle("No rows for 3h", "Orders fresh")).toBe("Orders fresh: No rows for 3h");
  });

  it("shortens a long summary to a 160-character headline", () => {
    const title = incidentTitle(ERROR);
    expect(Array.from(title).length).toBeLessThanOrEqual(160);
    expect(title.endsWith("…")).toBe(true);
    expect(ERROR.startsWith(title.slice(0, -1))).toBe(true);
  });

  it("keeps only the first line of a multi-line error", () => {
    expect(incidentTitle(MULTILINE)).toBe("Code: 241. DB::Exception: Memory limit exceeded");
  });
});

describe("incident views", () => {
  it("lists every incident with a short title", async () => {
    const list = await views.listIncidents(["c1"], allowAll, { status: "active" });
    const byId = new Map(list.map((i) => [i.id, i.title]));
    expect(byId.get("ob-short")).toBe("Kafka lag rising");
    expect(byId.get("ob-multi")).toBe("Code: 241. DB::Exception: Memory limit exceeded");
    for (const id of ["ob-long", "dh1"]) {
      expect(Array.from(byId.get(id) ?? "").length).toBeLessThanOrEqual(160);
      expect(byId.get(id)?.endsWith("…")).toBe(true);
    }
    expect(byId.get("dh1")?.startsWith("Orders fresh: upstream pipeline failed: Hourly join")).toBe(true);
  });

  it("shortens the detail title and keeps the full text alongside", async () => {
    const observe = await views.incidentDetail("observe", "ob-long");
    expect(Array.from(String(observe?.title)).length).toBeLessThanOrEqual(160);
    expect(observe?.summary).toBe(ERROR);
    expect(observe?.fullTitle).toBe(ERROR);
    const health = await views.incidentDetail("data_health", "dh1");
    expect(Array.from(String(health?.title)).length).toBeLessThanOrEqual(160);
    expect(health?.fullTitle).toBe(`Orders fresh: upstream pipeline failed: ${ERROR}`);
  });

  it("shortens the titles of related incidents", async () => {
    const rca = await getStoredRca("observe", "ob-short");
    expect(rca?.related.map((r) => r.title)).toEqual([incidentTitle(ERROR), incidentTitle(`upstream pipeline failed: ${ERROR}`, "Orders fresh")]);
  });

  it("shortens incident annotations on dashboards", async () => {
    const [result] = await loadAnnotations(
      { viewer: { id: "admin", roles: ["super_admin"], permissions: [] }, connectionId: "c1", dashboardId: "d1", fromMs: 0, toMs: T0 + 10 },
      ["incidents"],
    );
    expect(result.ok).toBe(true);
    const titles = result.ok ? result.events.map((e) => e.title) : [];
    expect(titles).toContain(`Incident (critical): ${incidentTitle(ERROR)}`);
    expect(titles).toContain("Incident (warning): Kafka lag rising");
    for (const title of titles) expect(title.length).toBeLessThan(200);
  });
});
