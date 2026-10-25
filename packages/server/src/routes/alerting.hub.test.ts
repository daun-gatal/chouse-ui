/**
 * Admin › Alerting hub (ADR 0026 §7): history search, filters and pages,
 * what uses each channel, delivery health, and the overview numbers.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase, rawRun } from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import { createChannel, recordEvent } from "../services/alerting/store";
import { AlertSeverity, ChannelType } from "../services/alerting/types";
import { saveChobiSettings } from "../services/chobi/settings";
import alerting from "./alerting";

let app: Hono;
let ops = "";
let other = "";

async function get<T>(path: string, permissions = ["alerting:view"]): Promise<{ status: number; data: T }> {
  const token = await generateAccessToken({ sub: "hub-user", email: "h@t.io", username: "hub", roles: ["custom"], permissions, sessionId: "s1" });
  const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json()) as { data: T };
  return { status: res.status, data: json.data };
}

type Page = { events: Array<{ id: string; source: string; firedAt: number; deliveryFailed: boolean; payload: string }>; nextCursor: string | null };

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
  ops = await createChannel({ name: "ops \"main\"", type: ChannelType.Webhook, config: { url: "https://x" }, enabled: true });
  other = await createChannel({ name: "other", type: ChannelType.Webhook, config: { url: "https://y" }, enabled: true });
  app = new Hono();
  app.onError(errorHandler);
  app.route("/alerting", alerting);
  // An event from before 1.74.0 names its channel; later ones keep ids.
  await rawRun(sql`INSERT INTO alert_events (id, rule_id, severity, fired_at, payload, delivered_to, source, delivery_failed) VALUES ('old-1', NULL, 'warning', 1000, 'node-1 — memory', ${JSON.stringify(['ops "main"'])}, 'fleet_alert', 0)`);
  await recordEvent({ ruleId: "r1", severity: AlertSeverity.Critical, payload: JSON.stringify({ title: "100% of disk_used", text: "x" }), deliveredTo: ['ops "main"'], source: "dashboard_alert", channelIds: [ops], deliveryFailed: false });
  await recordEvent({ ruleId: "r2", severity: AlertSeverity.Warning, payload: JSON.stringify({ title: "job failed", text: "nightly" }), deliveredTo: [], source: "scheduled_query", channelIds: [], deliveryFailed: true });
  await recordEvent({ ruleId: "r3", severity: AlertSeverity.Info, payload: JSON.stringify({ title: "report sent" }), deliveredTo: ["other"], source: "dashboard_report", channelIds: [other], deliveryFailed: false });
});

afterAll(async () => {
  await closeDatabase();
});

describe("GET /alerting/events/search", () => {
  it("filters by source, severity, outcome and channel (old rows by name, new by id)", async () => {
    expect((await get<Page>("/alerting/events/search?source=dashboard_alert")).data.events.map((e) => e.source)).toEqual(["dashboard_alert"]);
    expect((await get<Page>("/alerting/events/search?severity=warning")).data.events.map((e) => e.id).sort()).toHaveLength(2);
    expect((await get<Page>("/alerting/events/search?failed=true")).data.events.map((e) => e.source)).toEqual(["scheduled_query"]);
    const byChannel = (await get<Page>(`/alerting/events/search?channelId=${ops}`)).data.events.map((e) => e.id);
    expect(byChannel).toHaveLength(2);
    expect(byChannel).toContain("old-1");
    expect((await get<Page>("/alerting/events/search?channelId=missing")).data).toEqual({ events: [], nextCursor: null });
  });

  it("searches text with % and _ taken literally, case-insensitively", async () => {
    expect((await get<Page>(`/alerting/events/search?q=${encodeURIComponent("100%")}`)).data.events.map((e) => e.source)).toEqual(["dashboard_alert"]);
    expect((await get<Page>(`/alerting/events/search?q=${encodeURIComponent("disk_used")}`)).data.events).toHaveLength(1);
    expect((await get<Page>(`/alerting/events/search?q=${encodeURIComponent("disk%used")}`)).data.events).toHaveLength(0);
    expect((await get<Page>("/alerting/events/search?q=JOB")).data.events.map((e) => e.source)).toEqual(["scheduled_query"]);
  });

  it("keeps time ranges and rejects invalid filters", async () => {
    expect((await get<Page>("/alerting/events/search?to=2000")).data.events.map((e) => e.id)).toEqual(["old-1"]);
    expect((await get<Page>("/alerting/events/search?from=2000")).data.events).toHaveLength(3);
    expect((await get<Page>("/alerting/events/search?severity=loud")).status).toBe(400);
    expect((await get<Page>("/alerting/events/search?limit=999")).status).toBe(400);
    expect((await get<Page>("/alerting/events/search", [])).status).toBe(403);
  });

  it("pages through a large history with a cursor, fast, without gaps or repeats", async () => {
    const values: string[] = [];
    for (let i = 0; i < 50_000; i++) values.push(`('bulk-${String(i).padStart(5, "0")}', NULL, 'info', ${5_000 + Math.floor(i / 3)}, 'bulk', '[]', 'fleet_alert', 0)`);
    for (let i = 0; i < values.length; i += 2000) {
      await rawRun(sql.raw(`INSERT INTO alert_events (id, rule_id, severity, fired_at, payload, delivered_to, source, delivery_failed) VALUES ${values.slice(i, i + 2000).join(",")}`));
    }
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    const started = performance.now();
    do {
      const page: Page = (await get<Page>(`/alerting/events/search?source=fleet_alert&limit=200${cursor ? `&cursor=${cursor}` : ""}`)).data;
      for (const e of page.events) {
        expect(seen.has(e.id)).toBe(false);
        seen.add(e.id);
      }
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(seen.size).toBe(2000);
    expect((performance.now() - started) / pages).toBeLessThan(250);
    // A cursor whose rows were cleared still answers (with what is older).
    await rawRun(sql`DELETE FROM alert_events WHERE id LIKE 'bulk-4%'`);
    expect((await get<Page>(`/alerting/events/search?cursor=${cursor}`)).status).toBe(200);
    expect((await get<Page>("/alerting/events/search?cursor=garbage")).status).toBe(200);
  });

  it("the plain list still answers an array", async () => {
    const plain = await get<unknown[]>("/alerting/events?limit=5");
    expect(Array.isArray(plain.data)).toBe(true);
    expect(plain.data).toHaveLength(5);
  });
});

describe("channel usage and health", () => {
  it("counts what sends to each channel, across features", async () => {
    await rawRun(sql`INSERT INTO alert_rules (id, name, source_type, config, severity, enabled, ai_rca_enabled, created_at, updated_at) VALUES ('rule-1', 'Fleet', 'fleet_threshold', '{}', 'warning', 0, 0, 0, 0)`);
    await rawRun(sql`INSERT INTO alert_rule_channels (rule_id, channel_id) VALUES ('rule-1', ${ops})`);
    await rawRun(sql`INSERT INTO ai_triage_rules (trigger, enabled, agent_id, cooldown_minutes, daily_token_budget, channel_ids, propose_as, watermark, updated_by, updated_at) VALUES ('fleet_alert', 0, NULL, 30, 1000, ${JSON.stringify([ops, other])}, NULL, 0, NULL, 0)`);
    await saveChobiSettings({ alerts: { enabled: false, events: { secondApprover: true, background: true, heldMcp: false }, delayMinutes: 5, channels: [{ channelId: other, approveFromChat: false }] } }, null);
    await rawRun(sql`INSERT INTO channel_messages (id, channel_id, feature, subject_id, kind, state, error, created_at, updated_at) VALUES ('m1', ${ops}, 'test', 's1', 'post', 'failed', 'HTTP 500', ${Date.now()}, ${Date.now()}), ('m2', ${other}, 'test', 's2', 'post', 'sent', NULL, ${Date.now()}, ${Date.now()})`);
    const channels = (await get<Array<{ id: string; usedBy: Record<string, number>; health: { failed24h: number; sent24h: number; lastError: string | null } }>>("/alerting/channels")).data;
    const opsRow = channels.find((c) => c.id === ops)!;
    expect(opsRow.usedBy).toMatchObject({ fleetRules: 1, triage: 1, chobi: 0 });
    expect(opsRow.health).toMatchObject({ failed24h: 1, sent24h: 0, lastError: "HTTP 500" });
    expect(channels.find((c) => c.id === other)!.usedBy).toMatchObject({ fleetRules: 0, triage: 1, chobi: 1 });
  });

  it("counts a fleet breach as firing only while its rule is on", async () => {
    await rawRun(sql`INSERT INTO fleet_alert_latches (latch_key, armed, updated_at) VALUES ('rule-1:conn:memory', 1, 0)`);
    expect((await get<{ firing: { fleet: number } }>("/alerting/overview")).data.firing.fleet).toBe(0);
    await rawRun(sql`UPDATE alert_rules SET enabled = 1 WHERE id = 'rule-1'`);
    expect((await get<{ firing: { fleet: number } }>("/alerting/overview")).data.firing.fleet).toBe(1);
    await rawRun(sql`UPDATE alert_rules SET enabled = 0 WHERE id = 'rule-1'`);
  });

  it("the overview reports sends, failures and channels failing now", async () => {
    const overview = (await get<{ sent24h: number; failed24h: number; waiting: number; failing: Array<{ id: string; lastError: string }>; firing: { fleet: number } }>("/alerting/overview")).data;
    expect(overview).toMatchObject({ sent24h: 1, failed24h: 1, waiting: 0, firing: { fleet: 0, dashboards: 0, dataHealth: 0 } });
    expect(overview.failing.map((f) => [f.id, f.lastError])).toEqual([[ops, "HTTP 500"]]);
  });
});
