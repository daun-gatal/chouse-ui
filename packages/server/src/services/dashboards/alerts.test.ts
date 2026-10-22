/**
 * Panel alerts: the state machine, and the evaluator end to end against a
 * real RBAC database with ClickHouse and channel delivery faked.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";

let rows: Array<Record<string, unknown>> = [{ v: 10 }];
let queries = 0;
mock.module("../scheduledQueries/chClient", () => ({
  clientForConnection: async () => ({
    query: async () => {
      queries += 1;
      return { response_headers: { "x-clickhouse-timezone": "UTC" }, json: async () => ({ meta: [{ name: "t", type: "DateTime" }, { name: "v", type: "UInt64" }], data: rows.map((r) => ({ t: "2026-10-17 00:00:00", ...r })), statistics: { elapsed: 0, rows_read: 1, bytes_read: 1 } }) };
    },
  }),
}));

const sentMessages: Array<{ title: string; text: string }> = [];
mock.module("../alerting/deliver", () => ({
  sendChannelMessage: async (_type: string, _config: Record<string, unknown>, message: { title: string; text: string }) => {
    sentMessages.push(message);
    return true;
  },
  sendChannelTest: async () => true,
}));

const { closeDatabase } = await import("../../rbac/db");
const { runMigrations } = await import("../../rbac/db/migrations");
const { freshDatabase, rawAll, rawRun } = await import("../../rbac/db/migrationTestHarness");
const { createChannel } = await import("../alerting/store");
const { ChannelType } = await import("../alerting/types");
const alertStore = await import("./alertStore");
const { clearPanelCache } = await import("./runner");
const store = await import("./store");
const { DashboardAlertEvaluator, isDue, nextStatus, noticeMessage, reduceValues } = await import("./alerts");

type Status = import("./alertStore").AlertStatus;
const OK: Status = { state: "ok", breaches: 0, since: 0, lastEvalAt: null, lastValue: null, lastError: null };
const CONFIG = { op: ">" as const, value: 5, forEvaluations: 2 };

describe("nextStatus", () => {
  it("goes pending, then fires once, then stays quiet while firing", () => {
    const a = nextStatus(OK, { kind: "value", value: 9, breached: 9 > CONFIG.value }, CONFIG, 1);
    expect(a).toEqual({ status: { state: "pending", breaches: 1, since: 1, lastEvalAt: 1, lastValue: 9, lastError: null }, notice: null });
    const b = nextStatus(a.status, { kind: "value", value: 8, breached: 8 > CONFIG.value }, CONFIG, 2);
    expect(b.status.state).toBe("firing");
    expect(b.status.since).toBe(2);
    expect(b.notice).toBe("firing");
    const c = nextStatus(b.status, { kind: "value", value: 7, breached: 7 > CONFIG.value }, CONFIG, 3);
    expect(c.status).toMatchObject({ state: "firing", breaches: 3, since: 2 });
    expect(c.notice).toBeNull();
  });

  it("resolves when the value drops back, and a pending breach just clears", () => {
    const firing: Status = { ...OK, state: "firing", breaches: 2, since: 5 };
    expect(nextStatus(firing, { kind: "value", value: 1, breached: 1 > CONFIG.value }, CONFIG, 9)).toEqual({ status: { state: "ok", breaches: 0, since: 9, lastEvalAt: 9, lastValue: 1, lastError: null }, notice: "resolved" });
    const pending: Status = { ...OK, state: "pending", breaches: 1, since: 5 };
    expect(nextStatus(pending, { kind: "value", value: 1, breached: 1 > CONFIG.value }, CONFIG, 9).notice).toBeNull();
  });

  it("notifies once when it starts failing, and when it recovers", () => {
    const failing = nextStatus(OK, { kind: "error", reason: "boom" }, CONFIG, 1);
    expect(failing).toEqual({ status: { state: "error", breaches: 0, since: 1, lastEvalAt: 1, lastValue: null, lastError: "boom" }, notice: "error" });
    expect(nextStatus(failing.status, { kind: "error", reason: "still" }, CONFIG, 2).notice).toBeNull();
    expect(nextStatus(failing.status, { kind: "value", value: 1, breached: 1 > CONFIG.value }, CONFIG, 3).notice).toBe("recovered");
    expect(nextStatus(failing.status, { kind: "value", value: 9, breached: 9 > CONFIG.value }, { ...CONFIG, forEvaluations: 1 }, 3).notice).toBe("firing");
  });

  it("treats no rows as not breaching, resolving a firing alert", () => {
    const firing: Status = { ...OK, state: "firing", breaches: 2, since: 5 };
    expect(nextStatus(firing, { kind: "no_data", reason: "no rows" }, CONFIG, 6)).toEqual({
      status: { state: "no_data", breaches: 0, since: 6, lastEvalAt: 6, lastValue: null, lastError: "no rows" },
      notice: "resolved",
    });
    expect(nextStatus(OK, { kind: "no_data", reason: "no rows" }, CONFIG, 6).notice).toBeNull();
  });
});

describe("reduceValues and isDue", () => {
  it("reduces", () => {
    expect(reduceValues([3, 9, 6], "last")).toBe(6);
    expect(reduceValues([3, 9, 6], "max")).toBe(9);
    expect(reduceValues([3, 9, 6], "min")).toBe(3);
    expect(reduceValues([3, 9, 6], "sum")).toBe(18);
    expect(reduceValues([3, 9, 6], "avg")).toBe(6);
  });

  it("is due when never evaluated or the interval has passed, and never when disabled", () => {
    const alert = { enabled: true, config: { everyMinutes: 5 } } as never;
    expect(isDue(alert, OK, 0)).toBe(true);
    expect(isDue(alert, { ...OK, lastEvalAt: 0 }, 299_999)).toBe(false);
    expect(isDue(alert, { ...OK, lastEvalAt: 0 }, 300_000)).toBe(true);
    expect(isDue({ enabled: false, config: { everyMinutes: 5 } } as never, OK, 0)).toBe(false);
  });
});

describe("evaluator end to end", () => {
  const OWNER = "alert-owner";
  let dashboardId = "";
  let panelId = "";
  let alertId = "";
  let channelId = "";
  const MINUTE = 60_000;
  let now = 1_800_000_000_000;

  beforeAll(async () => {
    process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
    process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
    await freshDatabase("sqlite");
    await runMigrations();
    await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${OWNER}, 'o@test.local', 'owner', 'x', 1, unixepoch(), unixepoch())`);
    await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) SELECT 'ur-o', ${OWNER}, id, unixepoch() FROM rbac_roles WHERE name = 'super_admin'`);
    await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
      VALUES ('conn-a', 'alpha', 'localhost', 8123, 'default', NULL, 'default', 0, 1, 0, unixepoch(), unixepoch())`);
    dashboardId = await store.createDashboard({
      title: "Shop", description: "", timeRange: "6h", refreshSeconds: 0, connectionScope: { kind: "only", connectionIds: ["conn-a"] }, variables: [], annotations: [],
      panels: [{ id: null, kind: "chart", title: "Orders", sql: "SELECT now() AS t, count() AS v FROM shop.orders", viz: { version: 2, type: "line", x: "t", y: ["v"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null, links: [], baseline: null }, fleet: false, layout: { x: 0, y: 0, w: 12, h: 9 } }],
    }, OWNER, { userId: OWNER, source: "ui" });
    panelId = (await store.getDashboard(dashboardId))!.panels[0].id;
    channelId = await createChannel({ name: "ops-hook", type: ChannelType.Webhook, config: { url: "https://hooks.test/ops" }, enabled: true });
    alertId = await alertStore.createAlert(dashboardId, panelId, OWNER, {
      name: "Too many orders", severity: "critical", connectionId: "conn-a", channelIds: [channelId], enabled: true,
      config: { kind: "threshold", column: "v", reduce: "max", op: ">", value: 5, forEvaluations: 2, everyMinutes: 1, range: "15m", values: {} },
    });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(() => {
    sentMessages.length = 0;
    clearPanelCache();
  });

  const tick = async (): Promise<Status> => {
    await DashboardAlertEvaluator.getInstance().tick(now);
    now += MINUTE;
    clearPanelCache();
    return (await alertStore.getStatuses([alertId])).get(alertId)!;
  };

  it("fires after two breaching evaluations and notifies once", async () => {
    rows = [{ v: 10 }];
    expect((await tick()).state).toBe("pending");
    expect(sentMessages).toEqual([]);
    expect((await tick()).state).toBe("firing");
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].title).toBe("🔴 Too many orders");
    expect(sentMessages[0].text).toContain("max of v is 10");
    expect((await tick()).state).toBe("firing");
    expect(sentMessages).toHaveLength(1);
    const events = await rawAll(sql`SELECT severity, delivered_to, payload FROM alert_events WHERE rule_id = ${alertId}`);
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe("critical");
    expect(JSON.parse(String(events[0].delivered_to))).toEqual(["ops-hook"]);
    expect(JSON.parse(String(events[0].payload))).toMatchObject({ source: "dashboard_panel_alert", notice: "firing", value: 10 });
  });

  it("resolves when the value drops", async () => {
    rows = [{ v: 1 }];
    expect((await tick()).state).toBe("ok");
    expect(sentMessages.map((m) => m.title)).toEqual(["✅ Too many orders resolved"]);
  });

  it("does not run again before the interval, or on a pod that lost the lease", async () => {
    const before = queries;
    await DashboardAlertEvaluator.getInstance().tick(now - MINUTE + 1);
    expect(queries).toBe(before);
    await rawRun(sql`UPDATE obs_leases SET holder = 'other-pod', expires_at = ${Math.floor(now / 1000) + 600} WHERE lease_key = ${`dashboard-alert:${alertId}`}`);
    await DashboardAlertEvaluator.getInstance().tick(now);
    expect(queries).toBe(before);
    await rawRun(sql`UPDATE obs_leases SET expires_at = 0 WHERE lease_key = ${`dashboard-alert:${alertId}`}`);
  });

  it("goes to error with the reason when the owner is deactivated, notifying once", async () => {
    await rawRun(sql`UPDATE rbac_users SET is_active = 0 WHERE id = ${OWNER}`);
    const status = await tick();
    expect(status.state).toBe("error");
    expect(status.lastError).toContain("deactivated");
    expect(sentMessages.map((m) => m.title)).toEqual(["⚠️ Too many orders cannot be evaluated"]);
    expect((await tick()).state).toBe("error");
    expect(sentMessages).toHaveLength(1);
    await rawRun(sql`UPDATE rbac_users SET is_active = 1 WHERE id = ${OWNER}`);
    rows = [{ v: 1 }];
    expect((await tick()).state).toBe("ok");
    expect(sentMessages.map((m) => m.title)).toEqual(["⚠️ Too many orders cannot be evaluated", "✅ Too many orders is evaluating again"]);
  });

  it("refuses NULLs and missing columns instead of guessing", async () => {
    rows = [{ v: null }];
    const status = await tick();
    expect(status.state).toBe("error");
    expect(status.lastError).toContain("not numbers");
  });

  it("goes to error when the dashboard is no longer assigned to the alert's connection", async () => {
    const detail = (await store.getDashboard(dashboardId))!;
    await store.updateDashboard(dashboardId, detail.dashboard.version, {
      ...store.toInput(detail), connectionScope: { kind: "only", connectionIds: ["conn-b"] },
    }, { userId: OWNER, source: "ui" });
    rows = [{ v: 1 }];
    const status = await tick();
    expect(status.state).toBe("error");
    expect(status.lastError).toBe("The dashboard is no longer assigned to the connection this alert watches");
  });

  it("is removed with its panel when a save drops the panel", async () => {
    const detail = (await store.getDashboard(dashboardId))!;
    const result = await store.updateDashboard(dashboardId, detail.dashboard.version, {
      title: "Shop", description: "", timeRange: "6h", refreshSeconds: 0, connectionScope: { kind: "only", connectionIds: ["conn-a"] }, variables: [], annotations: [], panels: [],
    }, { userId: OWNER, source: "ui" });
    expect(result.removedAlertIds).toEqual([alertId]);
    expect(await alertStore.getAlert(alertId)).toBeNull();
    expect(await rawAll(sql`SELECT 1 FROM dashboard_alert_channels WHERE alert_id = ${alertId}`)).toEqual([]);
    expect(await rawAll(sql`SELECT 1 FROM dashboard_alert_state WHERE alert_id = ${alertId}`)).toEqual([]);
  });
});

describe("noticeMessage", () => {
  it("uses the warning icon for warning alerts and names the panel and dashboard", () => {
    const alert = { name: "Lag", severity: "warning", config: { kind: "threshold", reduce: "last", column: "lag", op: ">=", value: 1000, forEvaluations: 1 } } as never;
    const message = noticeMessage(alert, "firing", { outcome: { kind: "value", value: 1500, breached: true }, dashboardTitle: "Kafka", panelTitle: "Consumer lag" }, { ...OK, state: "firing", lastValue: 1500 });
    expect(message).toEqual({ title: "🟠 Lag", text: "Consumer lag on dashboard Kafka: last of lag is 1,500 (alert when >= 1,000, 1 evaluation in a row)." });
  });

  it("names the expected range for a band alert", () => {
    const alert = { name: "Inserts", severity: "critical", config: { kind: "outside_band", column: "rows", forEvaluations: 2 } } as never;
    const message = noticeMessage(alert, "firing", { outcome: { kind: "value", value: 12, breached: true, band: { lo: 100, hi: 180.5 } }, dashboardTitle: "Orders", panelTitle: "Insert rate" }, { ...OK, state: "firing", lastValue: 12 });
    expect(message).toEqual({ title: "🔴 Inserts", text: "Insert rate on dashboard Orders: rows in the latest complete bucket is 12 (expected 100 to 180.5, 2 evaluations in a row)." });
  });
});
