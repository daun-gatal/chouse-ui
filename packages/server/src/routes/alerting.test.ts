/**
 * A notification channel in use cannot be deleted — by alert rules or by
 * dashboard panel alerts (ADR 0021 §7).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase, rawRun } from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import { createChannel } from "../services/alerting/store";
import { ChannelType } from "../services/alerting/types";
import { createAlert } from "../services/dashboards/alertStore";
import alerting from "./alerting";

const USER = "alerting-admin";
let app: Hono;

async function del(path: string): Promise<{ status: number; body: { success: boolean; error?: string } }> {
  const token = await generateAccessToken({ sub: USER, email: "a@test.local", username: "admin", roles: ["custom"], permissions: ["alerting:delete"], sessionId: "s1" });
  const res = await app.request(path, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as { success: boolean; error?: string } };
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'a@test.local', 'admin', 'x', 1, unixepoch(), unixepoch())`);
  app = new Hono();
  app.onError(errorHandler);
  app.route("/alerting", alerting);
});

afterAll(async () => {
  await closeDatabase();
});

describe("DELETE /alerting/channels/:id", () => {
  it("refuses while a dashboard panel alert delivers to the channel, then deletes", async () => {
    const channelId = await createChannel({ name: "ops", type: ChannelType.Webhook, config: { url: "https://hooks.test/ops" }, enabled: true });
    await createAlert("d1", "p1", USER, {
      name: "Lag", severity: "warning", connectionId: "c1", channelIds: [channelId], enabled: true,
      config: { column: "v", reduce: "last", op: ">", value: 1, forEvaluations: 1, everyMinutes: 5, range: "15m", values: {} },
    });
    const refused = await del(`/alerting/channels/${channelId}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("Channel is used by 1 dashboard panel alert; detach it first.");
    await rawRun(sql`DELETE FROM dashboard_alert_channels WHERE channel_id = ${channelId}`);
    expect((await del(`/alerting/channels/${channelId}`)).status).toBe(200);
  });
});
