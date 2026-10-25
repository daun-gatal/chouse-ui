/**
 * Chobi › Need You (ADR 0026 §6): which requests alert, after the delay, once
 * per channel; what the message shows (never raw arguments); and the edit
 * once the request is decided or expires.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import * as h from "../../rbac/db/migrationTestHarness";
import { createChannel } from "../alerting/store";
import { ChannelType } from "../alerting/types";
import { resetPlatformHosts } from "../alerting/notify/hosts";
import { createAction, decideAction, finishAction } from "../ai/actions/store";
import { needYouKind, needYouMessage, sendDue, settleOpen } from "./needYou";
import { resetChobiSettingsCache, saveChobiSettings } from "./settings";

const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
let platform: ReturnType<typeof Bun.serve>;
let slack = "";
let hook = "";
let ts = 0;

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  process.env.PUBLIC_BASE_URL = "https://chouse.example.com";
  await h.freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
  for (const id of ["ana", "ben"]) {
    await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, display_name, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@t.io`}, ${id}, ${id.toUpperCase()}, 'x', 1, unixepoch(), unixepoch())`);
  }
  platform = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const u = new URL(req.url);
      const text = await req.text();
      posts.push({ path: u.pathname, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} });
      if (u.pathname === "/slack/api/chat.postMessage") return Response.json({ ok: true, channel: "C0TEST123", ts: `1700000000.${++ts}` });
      if (u.pathname.startsWith("/slack/api/")) return Response.json({ ok: true });
      return new Response("ok");
    },
  });
  process.env.CHOUSE_ALLOW_TEST_OVERRIDES = "1";
  process.env.CHOUSE_INTEGRATIONS_TEST_HOSTS = JSON.stringify({ slack: `http://127.0.0.1:${platform.port}/slack` });
  resetPlatformHosts();
  slack = await createChannel({ name: "ops-slack", type: ChannelType.Slack, config: { mode: "app", botToken: "xoxb-1", signingSecret: "testSigningSecretOne", channelId: "C0TEST123" }, enabled: true });
  hook = await createChannel({ name: "ops-hook", type: ChannelType.Webhook, config: { url: `http://127.0.0.1:${platform.port}/hook` }, enabled: true });
}, 60_000);

afterAll(async () => {
  platform.stop(true);
  delete process.env.CHOUSE_INTEGRATIONS_TEST_HOSTS;
  delete process.env.CHOUSE_ALLOW_TEST_OVERRIDES;
  delete process.env.PUBLIC_BASE_URL;
  resetPlatformHosts();
  await closeDatabase();
});

beforeEach(async () => {
  posts.length = 0;
  await h.rawRun(sql`DELETE FROM ai_actions`);
  await h.rawRun(sql`DELETE FROM channel_messages`);
});

async function configure(alerts: Partial<Parameters<typeof saveChobiSettings>[0]["alerts"]> & object): Promise<void> {
  await saveChobiSettings({ alerts: { enabled: true, events: { secondApprover: true, background: true, heldMcp: false }, delayMinutes: 0, channels: [{ channelId: slack, approveFromChat: true }, { channelId: hook, approveFromChat: true }], ...alerts } }, null);
  resetChobiSettingsCache();
}

const t3 = (over: Partial<Parameters<typeof createAction>[0]> = {}) => createAction({ source: "background", tier: "t3", userId: "ana", tool: "drop_table", args: { database: "shop", table: "orders", secret: "s3cr3t-arg" }, description: "DROP TABLE shop.orders", origin: "chat", ...over });

describe("which requests alert", () => {
  it("knows the kind of each request", () => {
    expect(needYouKind({ source: "background", tier: "t3" })).toBe("secondApprover");
    expect(needYouKind({ source: "background", tier: "t2" })).toBe("background");
    expect(needYouKind({ source: "held", tier: "t2" })).toBe("heldMcp");
    expect(needYouKind({ source: "chat", tier: "t2" })).toBeNull();
  });

  it("sends a waiting T3 request to each channel once, with buttons only where the channel can carry them", async () => {
    await configure({});
    const action = await t3();
    expect(await sendDue()).toBe(2);
    expect(await sendDue()).toBe(0);
    const slackPost = posts.find((p) => p.path === "/slack/api/chat.postMessage")!;
    const hookPost = posts.find((p) => p.path === "/hook")!;
    expect(JSON.stringify(slackPost.body)).toContain("Needs a second approver");
    expect(JSON.stringify(slackPost.body)).toContain('"action_id":"chouse_0"');
    expect(JSON.stringify(slackPost.body)).toContain("https://chouse.example.com/ai/approvals");
    expect(hookPost.body).toEqual({ title: expect.stringContaining("Needs a second approver"), text: "DROP TABLE shop.orders" });
    for (const p of posts) expect(JSON.stringify(p.body)).not.toContain("s3cr3t-arg");
    const audit = await h.rawAll(sql`SELECT resource_id, details FROM rbac_audit_logs WHERE action = 'chobi.alert_sent'`);
    expect(audit.map((a) => String(a.resource_id))).toEqual([action.id]);
  });

  it("waits the delay, skips unwanted kinds and turned-off alerts, and never alerts chat actions", async () => {
    await configure({ delayMinutes: 10 });
    await t3();
    expect(await sendDue()).toBe(0);
    expect(await sendDue(Date.now() + 11 * 60_000)).toBe(2);
    await h.rawRun(sql`DELETE FROM channel_messages`);
    await h.rawRun(sql`DELETE FROM ai_actions`);
    await configure({ events: { secondApprover: false, background: true, heldMcp: false } });
    await t3();
    await createAction({ source: "held", tier: "t2", userId: "ana", tool: "kill_query", args: {}, description: "KILL q", origin: "mcp" });
    await createAction({ source: "chat", tier: "t2", userId: "ana", tool: "kill_query", args: {}, description: "KILL q2" });
    expect(await sendDue()).toBe(0);
    await configure({ enabled: false });
    await createAction({ source: "background", tier: "t2", userId: "ana", tool: "kill_query", args: {}, description: "KILL q3", origin: "background" });
    expect(await sendDue()).toBe(0);
  });

  it("drops the buttons when the channel is set to not approve from chat", async () => {
    await configure({ channels: [{ channelId: slack, approveFromChat: false }] });
    await t3();
    await sendDue();
    expect(JSON.stringify(posts[0].body)).not.toContain("chouse_0");
  });

  it("sends nothing without PUBLIC_BASE_URL (the review link cannot be built)", async () => {
    await configure({});
    await t3();
    delete process.env.PUBLIC_BASE_URL;
    expect(await sendDue()).toBe(0);
    process.env.PUBLIC_BASE_URL = "https://chouse.example.com";
  });
});

describe("settling", () => {
  it("edits the alert once the request is decided, and closes it", async () => {
    await configure({});
    const action = await t3();
    await sendDue();
    posts.length = 0;
    await decideAction(action.id, "rejected", "ben");
    await Bun.sleep(100);
    await settleOpen();
    const update = posts.find((p) => p.path === "/slack/api/chat.update");
    expect(JSON.stringify(update?.body)).toContain("Declined by BEN");
    expect(JSON.stringify(update?.body)).not.toContain("chouse_0");
    const open = await h.rawAll(sql`SELECT COUNT(*) AS n FROM channel_messages WHERE feature = 'need_you' AND closed_at IS NULL`);
    expect(Number(open[0].n)).toBe(0);
    posts.length = 0;
    expect(await settleOpen()).toBe(0);
    expect(posts).toEqual([]);
  });

  it("follows an approved request until it lands, editing only when something changed", async () => {
    await configure({});
    const action = await t3();
    await sendDue();
    posts.length = 0;
    await decideAction(action.id, "approved", "ben");
    await Bun.sleep(100);
    await settleOpen();
    await settleOpen();
    const updates = () => posts.filter((p) => p.path === "/slack/api/chat.update");
    expect(updates()).toHaveLength(1);
    expect(JSON.stringify(updates()[0].body)).toContain("Approved by BEN");
    const open = await h.rawAll(sql`SELECT COUNT(*) AS n FROM channel_messages WHERE feature = 'need_you' AND closed_at IS NULL`);
    expect(Number(open[0].n)).toBe(1);
    await finishAction(action.id, { result: { ok: true } });
    await Bun.sleep(100);
    await settleOpen();
    expect(JSON.stringify(updates().at(-1)?.body)).toContain("Done by BEN");
    const closed = await h.rawAll(sql`SELECT COUNT(*) AS n FROM channel_messages WHERE feature = 'need_you' AND closed_at IS NULL`);
    expect(Number(closed[0].n)).toBe(0);
  });

  it("marks an expired request as expired", async () => {
    await configure({});
    const action = await t3({ expiresAt: Date.now() + 1_000 });
    await sendDue();
    posts.length = 0;
    await settleOpen(Date.now() + 2_000);
    expect(JSON.stringify(posts.find((p) => p.path === "/slack/api/chat.update")?.body)).toContain("Expired without an answer");
    void action;
  });

  it("says who asked, through what, and on which connection", () => {
    const msg = needYouMessage({ id: "a1", tool: "kill_query", description: "KILL q", status: "pending", expiresAt: Date.now() + 125 * 60_000, origin: "mcp", source: "held" } as Parameters<typeof needYouMessage>[0], "heldMcp", { requester: "Ana", decider: null, connection: "prod-eu" }, true);
    expect(msg.title).toBe("Waiting for Ana to confirm: Kill a query");
    expect(msg.facts).toEqual([{ label: "Requested by", value: "Ana via MCP" }, { label: "Connection", value: "prod-eu" }, { label: "Status", value: "Waiting · expires in 2h" }]);
    expect(msg.buttons?.map((b) => b.label)).toEqual(["Confirm", "Decline"]);
  });
});
