/**
 * POST /alerting/channels/:id/message (ADR 0025 §6): a handoff or a confirmed
 * agent post reaches the channel; it needs alerting:edit, refuses a channel
 * that is off, and the audit keeps the title and length but never the text.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase, rawAll, rawRun } from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import { createChannel } from "../services/alerting/store";
import { ChannelType } from "../services/alerting/types";
import alerting from "./alerting";

const USER = "alerting-poster";
let app: Hono;
const received: Array<{ body: unknown; auth: string | null }> = [];
let hook: ReturnType<typeof Bun.serve>;

async function post(path: string, body: unknown, permissions = ["alerting:edit"]): Promise<{ status: number; body: { success: boolean; error?: string; data?: { sent: boolean; channel: string } } }> {
  const token = await generateAccessToken({ sub: USER, email: "p@test.local", username: "poster", roles: ["custom"], permissions, sessionId: "s1" });
  const res = await app.request(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as { success: boolean; error?: string } };
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'p@test.local', 'poster', 'x', 1, unixepoch(), unixepoch())`);
  hook = Bun.serve({
    port: 0,
    fetch: async (req) => {
      received.push({ body: await req.json(), auth: req.headers.get("authorization") });
      return new Response("ok");
    },
  });
  app = new Hono();
  app.onError(errorHandler);
  app.route("/alerting", alerting);
});

afterAll(async () => {
  hook.stop(true);
  await closeDatabase();
});

describe("POST /alerting/channels/:id/message", () => {
  it("delivers the message and audits it without its text", async () => {
    const id = await createChannel({ name: "oncall", type: ChannelType.Webhook, config: { url: `http://127.0.0.1:${hook.port}/hook`, secret: "s3cret" }, enabled: true });
    const res = await post(`/alerting/channels/${id}/message`, { title: "Handoff: orders late", text: "Upstream job failed at 03:10; rerun scheduled." });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true, channel: "oncall" });
    expect(received.at(-1)).toEqual({ body: { title: "Handoff: orders late", text: "Upstream job failed at 03:10; rerun scheduled." }, auth: "Bearer s3cret" });

    const audit = await rawAll(sql`SELECT details, status FROM rbac_audit_logs WHERE action = 'alerting.channel_message'`);
    expect(audit).toHaveLength(1);
    const details = String(audit[0].details);
    expect(details).toContain("Handoff: orders late");
    expect(details).toContain("\"length\":");
    expect(details).not.toContain("Upstream job failed");
  });

  it("needs alerting:edit, an existing channel that is on, and a sane message", async () => {
    const id = await createChannel({ name: "off", type: ChannelType.Webhook, config: { url: `http://127.0.0.1:${hook.port}/off` }, enabled: false });
    expect((await post(`/alerting/channels/${id}/message`, { title: "t", text: "x" }, ["alerting:view"])).status).toBe(403);
    expect((await post("/alerting/channels/nope/message", { title: "t", text: "x" })).status).toBe(404);
    expect((await post(`/alerting/channels/${id}/message`, { title: "t", text: "x" })).status).toBe(409);
    expect((await post(`/alerting/channels/${id}/message`, { title: "", text: "x" })).status).toBe(400);
    expect((await post(`/alerting/channels/${id}/message`, { title: "t", text: "x".repeat(4001) })).status).toBe(400);
  });

  it("reports a delivery failure", async () => {
    const id = await createChannel({ name: "broken", type: ChannelType.Webhook, config: { url: "http://127.0.0.1:1/never" }, enabled: true });
    const res = await post(`/alerting/channels/${id}/message`, { title: "t", text: "x" });
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });
});
