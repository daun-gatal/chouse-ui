/**
 * The shared notify layer (ADR 0026 §1): rendering for each platform, the
 * message log that keeps a message from being sent twice, and the webhook
 * contracts features had before it (they must not change).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "crypto";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../../rbac/db";
import { runMigrations } from "../../../rbac/db/migrations";
import { freshDatabase, rawAll, rawRun } from "../../../rbac/db/migrationTestHarness";
import { createChannel, getChannel, maskChannelConfig, updateChannel } from "../store";
import { ChannelType } from "../types";
import { capabilitiesOf, checkChannel, editSubject, isDeliverable, notifyChannelIds, sendToChannel, TEST_MESSAGE } from "./index";
import { resetPlatformHosts } from "./hosts";
import { renderTelegram } from "./platforms/telegram";
import { claimMessage, markFailed, openMessages } from "./log";
import { renderGoogleChat } from "./platforms/googleChat";
import { renderSlack } from "./platforms/slack";
import { renderEmailHtml } from "./platforms/email";
import { clip, escapeSlack, isPublicHttpsUrl, plainText, webhookBody } from "./text";
import { breachMessage, rcaMessage, resolvedBreachMessage } from "../../fleetAlerter";
import type { NotifyMessage } from "./types";

const received: Array<{ path: string; body: Record<string, unknown>; auth: string | null }> = [];
let failWith: number | null = null;
let server: ReturnType<typeof Bun.serve>;
const url = (path: string): string => `http://127.0.0.1:${server.port}${path}`;

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      if (failWith) return new Response("nope", { status: failWith });
      received.push({ path: new URL(req.url).pathname, body: (await req.json()) as Record<string, unknown>, auth: req.headers.get("authorization") });
      return new Response("ok");
    },
  });
});

afterAll(async () => {
  server.stop(true);
  await closeDatabase();
});

beforeEach(async () => {
  received.length = 0;
  failWith = null;
  await rawRun(sql`DELETE FROM channel_messages`);
});

describe("rendering", () => {
  const message: NotifyMessage = {
    title: "Orders <late>",
    severity: "critical",
    text: "Rows for <!channel> & friends",
    facts: [{ label: "Table", value: "shop.orders" }],
    sections: [{ title: "Why", text: "lag" }],
    detail: "SELECT 1",
    links: [{ label: "Open", url: "https://chouse.example.com/x" }],
    buttons: [{ action: "data_health.ack", label: "Acknowledge", value: "inc-1" }],
    footer: "chouse",
  };

  it("escapes Slack mrkdwn so data can never ping a channel, and keeps the alert layout", () => {
    const { payload, buttons } = renderSlack(message, { actions: false, rowId: "r1" });
    const blocks = payload.attachments[0].blocks;
    expect(payload.attachments[0].color).toBe("#dc2626");
    expect(blocks[0]).toEqual({ type: "header", text: { type: "plain_text", text: "Orders <late>", emoji: true } });
    expect(JSON.stringify(blocks)).toContain("Rows for &lt;!channel&gt; &amp; friends");
    expect(JSON.stringify(blocks)).not.toContain("<!channel>");
    // The notification text is parsed as mrkdwn too.
    expect(payload.text).toBe("Orders &lt;late&gt;\nRows for &lt;!channel&gt; &amp; friends");
    // No action buttons where the channel cannot call back; links still render.
    expect(buttons).toEqual([]);
    const actions = blocks.find((b) => b.type === "actions") as { elements: Array<Record<string, unknown>> };
    expect(actions.elements).toEqual([{ type: "button", action_id: "link_0", text: { type: "plain_text", text: "Open" }, url: "https://chouse.example.com/x" }]);
  });

  it("names a button by the message row and its index, and stores what it does", () => {
    const { payload, buttons } = renderSlack(message, { actions: true, rowId: "row-9" });
    const actions = payload.attachments[0].blocks.find((b) => b.type === "actions") as { elements: Array<Record<string, unknown>> };
    expect(actions.elements[0]).toMatchObject({ action_id: "chouse_0", value: "row-9:0" });
    expect(buttons).toEqual([{ action: "data_health.ack", value: "inc-1" }]);
    const chat = renderGoogleChat(message, { actions: true, rowId: "row-9" });
    expect(JSON.stringify(chat.payload)).toContain('"value":"row-9:0"');
    expect(chat.buttons).toEqual([{ action: "data_health.ack", value: "inc-1" }]);
  });

  it("escapes Google Chat and email HTML", () => {
    const { payload } = renderGoogleChat(message, { actions: false, rowId: "r" });
    expect(JSON.stringify(payload)).toContain("Rows for &lt;!channel&gt; &amp; friends");
    const html = renderEmailHtml(message);
    expect(html).toContain("Orders &lt;late&gt;");
    expect(html).not.toContain("<late>");
    expect(html).toContain('href="https://chouse.example.com/x"');
  });

  it("keeps a {title, text} message in the shape every channel got before", () => {
    const simple = { title: "Job failed", text: "nightly rollup" };
    expect(renderSlack(simple, { actions: false, rowId: "r" }).payload).toEqual({
      text: "Job failed\nnightly rollup",
      attachments: [{ color: "#2563eb", blocks: [
        { type: "header", text: { type: "plain_text", text: "Job failed", emoji: true } },
        { type: "section", text: { type: "mrkdwn", text: "nightly rollup" } },
      ] }],
    });
    expect(renderGoogleChat(simple, { actions: false, rowId: "r" }).payload.cardsV2[0].card).toEqual({
      header: { title: "Job failed" },
      sections: [{ widgets: [{ textParagraph: { text: "nightly rollup" } }] }],
    });
    expect(webhookBody(simple)).toEqual({ title: "Job failed", text: "nightly rollup" });
    expect(plainText(simple)).toBe("nightly rollup");
  });

  it("clips to platform limits and only treats public https links as link buttons", () => {
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(clip("abc", 4)).toBe("abc");
    expect(escapeSlack("a<b>&")).toBe("a&lt;b&gt;&amp;");
    const long = renderSlack({ title: "x".repeat(400), text: "y".repeat(5000) }, { actions: false, rowId: "r" }).payload;
    expect((long.attachments[0].blocks[0].text as { text: string }).text).toHaveLength(150);
    expect((long.attachments[0].blocks[1].text as { text: string }).text).toHaveLength(3000);
    expect(isPublicHttpsUrl("https://chouse.example.com/a")).toBe(true);
    expect(isPublicHttpsUrl("http://chouse.example.com/a")).toBe(false);
    expect(isPublicHttpsUrl("https://localhost:5521/a")).toBe(false);
    expect(isPublicHttpsUrl("https://10.0.0.1/a")).toBe(false);
    expect(isPublicHttpsUrl("not a url")).toBe(false);
  });
});

describe("webhook contracts kept byte for byte", () => {
  it("fleet alerts keep the fleet_alert body", () => {
    const at = new Date("2026-10-25T10:00:00.000Z");
    const message = breachMessage({ node: "ch-1", metric: "node memory", summary: "92% memory", user: "bob", detail: "SELECT 1" }, at);
    expect(webhookBody(message)).toEqual({ kind: "fleet_alert", node: "ch-1", metric: "node memory", summary: "92% memory", user: "bob", detail: "SELECT 1", firedAt: "2026-10-25T10:00:00.000Z" });
    expect(message.fallback).toBe("🔴 ch-1 — node memory: 92% memory");
    // The query's SQL reaches email only, as before.
    expect(JSON.stringify(renderSlack(message, { actions: false, rowId: "r" }).payload)).not.toContain("SELECT 1");
    expect(JSON.stringify(renderGoogleChat(message, { actions: false, rowId: "r" }).payload)).not.toContain("SELECT 1");
    expect(renderTelegram(message, { actions: false, rowId: "r" }).payload.text).not.toContain("SELECT 1");
    expect(renderEmailHtml(message)).toContain("SELECT 1");
    expect(message.emailSubject).toBe("🔴 ch-1 — Node memory alert");
    const resolved = resolvedBreachMessage(message, at.getTime(), new Date(at.getTime() + 14 * 60_000));
    expect(resolved.title).toBe("✅ ClickHouse fleet alert resolved");
    expect(resolved.text).toContain("lasted 14 min");
    expect(webhookBody(resolved)).toEqual(webhookBody(message));
  });

  it("root-cause reports keep the fleet_rca body", () => {
    const at = new Date("2026-10-25T10:00:00.000Z");
    const report = { id: "rep-1", model: "m", raw: "", analysis: { verdict: { status: "critical", summary: "Disk full" }, nodes: [], recommendations: ["Add disk"] } } as unknown as Parameters<typeof rcaMessage>[0];
    const message = rcaMessage(report, ["ch-1 — node memory: 92%"], at);
    expect(webhookBody(message)).toEqual({ kind: "fleet_rca", status: "critical", summary: "Disk full", triggers: ["ch-1 — node memory: 92%"], model: "m", reportId: "rep-1", firedAt: "2026-10-25T10:00:00.000Z" });
    expect(message.severity).toBe("critical");
    expect(message.emailSubject).toBe("🩺 Chouse AI RCA — CRITICAL");
  });

  it("the channel test keeps its body", () => {
    expect(webhookBody(TEST_MESSAGE)).toEqual({ title: "✅ CHouse UI — alerting test", text: "This is a test message from CHouse UI alerting. If you can read this, the channel is configured correctly.", test: true });
  });
});

describe("sending", () => {
  it("delivers to each platform's webhook in its own format, with the bearer secret", async () => {
    const slack = await createChannel({ name: "slack", type: ChannelType.Slack, config: { webhookUrl: url("/slack") }, enabled: true });
    const chat = await createChannel({ name: "chat", type: ChannelType.GoogleChat, config: { webhookUrl: url("/chat") }, enabled: true });
    const hook = await createChannel({ name: "hook", type: ChannelType.Webhook, config: { url: url("/hook"), secret: "s3cret" }, enabled: true });
    const result = await notifyChannelIds([slack, chat, hook], { title: "T", text: "body" }, { feature: "scheduled_query", subjectId: "out-1" });
    expect(result.deliveredTo).toEqual(["slack", "chat", "hook"]);
    expect(result.channelIds).toEqual([slack, chat, hook]);
    expect(result.failed).toEqual([]);
    expect(received.map((r) => r.path)).toEqual(["/slack", "/chat", "/hook"]);
    expect(received[0].body).toHaveProperty("attachments");
    expect(received[1].body).toHaveProperty("cardsV2");
    expect(received[2]).toEqual({ path: "/hook", body: { title: "T", text: "body" }, auth: "Bearer s3cret" });
    const log = await rawAll(sql`SELECT channel_id, feature, subject_id, kind, state, message, closed_at FROM channel_messages ORDER BY created_at`);
    // A webhook cannot edit what it sent, so its messages are closed at once.
    expect(log.every((r) => r.closed_at !== null)).toBe(true);
    expect(log.map((r) => [String(r.feature), String(r.subject_id), String(r.kind), String(r.state)])).toEqual([
      ["scheduled_query", "out-1", "post", "sent"],
      ["scheduled_query", "out-1", "post", "sent"],
      ["scheduled_query", "out-1", "post", "sent"],
    ]);
    expect(JSON.parse(String(log[0].message))).toEqual({ title: "T", text: "body" });
  });

  it("sends a message about a subject once, even when asked twice, and retries a failure", async () => {
    const hook = await createChannel({ name: "once", type: ChannelType.Webhook, config: { url: url("/once") }, enabled: true });
    const row = (await getChannel(hook))!;
    expect((await sendToChannel(row, { title: "A" }, { feature: "data_health", subjectId: "s1" })).status).toBe("sent");
    expect((await sendToChannel(row, { title: "A" }, { feature: "data_health", subjectId: "s1" })).status).toBe("duplicate");
    expect(received).toHaveLength(1);
    // A different kind about the same subject is its own message.
    expect((await sendToChannel(row, { title: "B" }, { feature: "data_health", subjectId: "s1", kind: "recovered" })).status).toBe("sent");
    expect(received).toHaveLength(2);

    failWith = 500;
    await expect(sendToChannel(row, { title: "C" }, { feature: "data_health", subjectId: "s2" })).rejects.toThrow("HTTP 500");
    const failed = await rawAll(sql`SELECT state, error FROM channel_messages WHERE subject_id = 's2'`);
    expect([String(failed[0].state), String(failed[0].error)]).toEqual(["failed", "HTTP 500: nope"]);
    failWith = null;
    expect((await sendToChannel(row, { title: "C" }, { feature: "data_health", subjectId: "s2" })).status).toBe("sent");
    expect(await rawAll(sql`SELECT COUNT(*) AS n FROM channel_messages WHERE subject_id = 's2'`)).toEqual([{ n: 1 }]);
  });

  it("one-off messages (no subject) are each sent", async () => {
    const hook = await createChannel({ name: "oneoff", type: ChannelType.Webhook, config: { url: url("/oneoff") }, enabled: true });
    const row = (await getChannel(hook))!;
    await sendToChannel(row, { title: "x" }, { feature: "handoff" });
    await sendToChannel(row, { title: "x" }, { feature: "handoff" });
    expect(received).toHaveLength(2);
  });

  it("reports missing, disabled and failing channels the way features expect", async () => {
    const off = await createChannel({ name: "off", type: ChannelType.Webhook, config: { url: url("/off") }, enabled: false });
    const broken = await createChannel({ name: "broken", type: ChannelType.Webhook, config: { url: "http://127.0.0.1:1/x" }, enabled: true });
    const result = await notifyChannelIds(["nope", off, broken, "nope"], { title: "x" }, { feature: "triage", subjectId: "t1" });
    expect(result.deliveredTo).toEqual([]);
    expect(result.failed.map((f) => [f.channelId, f.name, f.reason])).toEqual([
      ["nope", null, "missing"],
      [off, "off", "disabled"],
      [broken, "broken", "error"],
    ]);
    expect(result.failed[0].error).toBe("channel no longer exists");
    expect(result.failed[1].error).toBe("channel is disabled");
  });

  it("claims are atomic: only one of two racing claims wins", async () => {
    const key = { channelId: "c-race", feature: "need_you" as const, subjectId: "a1", kind: "post" };
    const results = await Promise.all([claimMessage(key), claimMessage(key), claimMessage(key)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    await markFailed(results.find((r) => r !== null)!, "boom");
    expect(await claimMessage(key)).not.toBeNull();
  });

  it("knows which channels can deliver", async () => {
    const empty = await createChannel({ name: "empty", type: ChannelType.Email, config: { user: "a", to: "b" }, enabled: true });
    const full = await createChannel({ name: "full", type: ChannelType.Email, config: { user: "a", to: "b", password: "p" }, enabled: true });
    expect(isDeliverable((await getChannel(empty))!)).toBe(false);
    expect(isDeliverable((await getChannel(full))!)).toBe(true);
  });

  it("closes what a channel cannot edit, without touching it", async () => {
    const hook = await createChannel({ name: "noedit", type: ChannelType.Webhook, config: { url: url("/noedit") }, enabled: true });
    await notifyChannelIds([hook], { title: "firing" }, { feature: "fleet_alert", subjectId: "latch-1", kind: "fire:1" });
    // A webhook stores no platform reference, so nothing is open for editing.
    expect(await openMessages("fleet_alert", "latch-1")).toEqual([]);
    expect(await editSubject("fleet_alert", "latch-1", { title: "resolved" }, { close: true })).toBe(0);
    expect(received).toHaveLength(1);
  });
});

describe("bot channels (App mode, Telegram)", () => {
  const calls: Array<{ path: string; body: unknown; auth: string | null }> = [];
  let bots: ReturnType<typeof Bun.serve>;
  let nextId = 100;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const serviceAccount = JSON.stringify({ type: "service_account", client_email: "chouse@proj.iam.gserviceaccount.com", private_key: privateKey, project_id: "proj" });

  beforeAll(() => {
    bots = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const u = new URL(req.url);
        const text = await req.text();
        const body: unknown = text.startsWith("{") ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
        calls.push({ path: u.pathname + u.search, body, auth: req.headers.get("authorization") });
        const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
        if (u.pathname === "/slack/api/chat.postMessage") return json({ ok: true, channel: "C0TEST123", ts: `1700000000.${nextId++}` });
        if (u.pathname === "/slack/api/chat.update") return json({ ok: true });
        if (u.pathname === "/slack/api/auth.test") return req.headers.get("authorization") === "Bearer xoxb-good" ? json({ ok: true, user: "chouse", team: "Acme" }) : json({ ok: false, error: "invalid_auth" });
        if (u.pathname === "/goauth/token") return json({ access_token: "ya29.test", expires_in: 3600 });
        if (u.pathname.startsWith("/gchat/v1/spaces/AAAA") && req.method === "GET") return json({ name: "spaces/AAAA", displayName: "Ops" });
        if (u.pathname === "/gchat/v1/spaces/AAAA/messages") return json({ name: `spaces/AAAA/messages/m${nextId++}` });
        if (u.pathname.startsWith("/gchat/v1/spaces/AAAA/messages/")) return json({ name: u.pathname.slice(10) });
        const tg = /^\/tg\/bot([^/]+)\/(\w+)$/.exec(u.pathname);
        if (tg) {
          if (tg[1] !== "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123") return json({ ok: false, description: "Unauthorized" }, 401);
          if (tg[2] === "sendMessage") return json({ ok: true, result: { message_id: nextId++, chat: { id: -1001 } } });
          if (tg[2] === "editMessageText") return json({ ok: true, result: true });
          if (tg[2] === "getMe") return json({ ok: true, result: { username: "chouse_bot" } });
          if (tg[2] === "getChat") return json({ ok: true, result: { title: "Ops group" } });
        }
        return json({ ok: false, error: "unknown" }, 404);
      },
    });
    process.env.CHOUSE_ALLOW_TEST_OVERRIDES = "1";
    const base = `http://127.0.0.1:${bots.port}`;
    process.env.CHOUSE_INTEGRATIONS_TEST_HOSTS = JSON.stringify({ slack: `${base}/slack`, googleOauth: `${base}/goauth`, googleChat: `${base}/gchat`, telegram: `${base}/tg` });
    resetPlatformHosts();
  });

  afterAll(() => {
    bots.stop(true);
    delete process.env.CHOUSE_INTEGRATIONS_TEST_HOSTS;
    delete process.env.CHOUSE_ALLOW_TEST_OVERRIDES;
    resetPlatformHosts();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  const alert: NotifyMessage = { title: "Disk <full>", text: "ch-1", buttons: [{ action: "data_health.ack", label: "Acknowledge", value: "inc-1" }], links: [{ label: "Open", url: "http://localhost:5521/x" }] };

  it("Slack App mode posts with the bot, carries buttons, and edits in place", async () => {
    const id = await createChannel({ name: "slack-app", type: ChannelType.Slack, config: { mode: "app", botToken: "xoxb-good", signingSecret: "abcdef0123456789abcdef0123456789", channelId: "C0TEST123" }, enabled: true });
    const row = (await getChannel(id))!;
    expect(capabilitiesOf(row)).toEqual({ edit: true, actions: true });
    expect(isDeliverable(row)).toBe(true);
    const sent = await sendToChannel(row, alert, { feature: "data_health", subjectId: "inc-1" });
    expect(calls[0].path).toBe("/slack/api/chat.postMessage");
    expect(calls[0].auth).toBe("Bearer xoxb-good");
    expect(JSON.stringify(calls[0].body)).toContain(`"value":"${sent.messageId}:0"`);
    const open = await openMessages("data_health", "inc-1");
    expect(open).toHaveLength(1);
    expect(open[0].ref).toEqual({ platform: "slack", channel: "C0TEST123", ts: expect.stringMatching(/^1700000000\./) });
    expect(open[0].buttons).toEqual([{ action: "data_health.ack", value: "inc-1" }]);
    expect(await editSubject("data_health", "inc-1", (posted) => ({ ...posted, title: "Acknowledged", buttons: [] }), { close: true })).toBe(1);
    expect(calls[1].path).toBe("/slack/api/chat.update");
    expect(JSON.stringify(calls[1].body)).toContain("Acknowledged");
    expect(JSON.stringify(calls[1].body)).not.toContain("chouse_0");
    expect(await openMessages("data_health", "inc-1")).toEqual([]);
    expect(await checkChannel(row)).toEqual([{ label: "Bot connected as @chouse (Acme)", ok: true }]);
  });

  it("a bad bot token fails the check with Slack's reason, never the token", async () => {
    const id = await createChannel({ name: "slack-bad", type: ChannelType.Slack, config: { mode: "app", botToken: "xoxb-bad", signingSecret: "abcdef0123456789abcdef0123456789", channelId: "C0TEST123" }, enabled: true });
    await expect(checkChannel((await getChannel(id))!)).rejects.toThrow("Slack auth.test: invalid_auth");
  });

  it("Google Chat App mode signs in with the service account, posts and edits", async () => {
    const id = await createChannel({ name: "chat-app", type: ChannelType.GoogleChat, config: { mode: "app", serviceAccountJson: serviceAccount, space: "spaces/AAAA" }, enabled: true });
    const row = (await getChannel(id))!;
    await sendToChannel(row, alert, { feature: "data_health", subjectId: "inc-2" });
    const token = calls.find((c) => c.path === "/goauth/token")!;
    expect((token.body as Record<string, string>).grant_type).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const post = calls.find((c) => c.path === "/gchat/v1/spaces/AAAA/messages")!;
    expect(post.auth).toBe("Bearer ya29.test");
    expect(JSON.stringify(post.body)).toContain('"function":"chouse"');
    await editSubject("data_health", "inc-2", { title: "Snoozed" }, { close: true });
    expect(calls.some((c) => c.path.startsWith("/gchat/v1/spaces/AAAA/messages/m") && c.path.endsWith("?updateMask=text,cardsV2"))).toBe(true);
    expect(await checkChannel(row)).toEqual([{ label: "Signed in as chouse@proj.iam.gserviceaccount.com", ok: true }, { label: "Can reach Ops", ok: true }]);
  });

  it("Telegram posts HTML, keeps localhost links in the text, edits, and only carries buttons once its webhook is registered", async () => {
    const token = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123";
    const id = await createChannel({ name: "tg", type: ChannelType.Telegram, config: { botToken: token, chatId: "-1001", topicId: 7 }, enabled: true });
    const row = (await getChannel(id))!;
    expect(capabilitiesOf(row)).toEqual({ edit: true, actions: false });
    await sendToChannel(row, alert, { feature: "data_health", subjectId: "inc-3" });
    const body = calls[0].body as Record<string, unknown>;
    expect(calls[0].path).toBe(`/tg/bot${token}/sendMessage`);
    expect(body.chat_id).toBe("-1001");
    expect(body.message_thread_id).toBe(7);
    expect(body.parse_mode).toBe("HTML");
    expect(String(body.text)).toContain("<b>Disk &lt;full&gt;</b>");
    expect(String(body.text)).toContain('<a href="http://localhost:5521/x">Open</a>');
    expect(body.reply_markup).toBeUndefined();
    await editSubject("data_health", "inc-3", { title: "Done" }, { close: true });
    expect(calls[1].path).toBe(`/tg/bot${token}/editMessageText`);
    expect(await checkChannel(row)).toEqual([{ label: "Bot @chouse_bot", ok: true }, { label: "Chat: Ops group", ok: true }]);
    await rawRun(sql`UPDATE notification_channels SET config = ${JSON.stringify({ ...JSON.parse((await getChannel(id))!.config), webhookRegistered: true })} WHERE id = ${id}`);
    expect(capabilitiesOf((await getChannel(id))!).actions).toBe(true);
  });

  it("a Telegram error never leaks the bot token", async () => {
    const id = await createChannel({ name: "tg-bad", type: ChannelType.Telegram, config: { botToken: "999999:ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ", chatId: "-1001" }, enabled: true });
    const error = await sendToChannel((await getChannel(id))!, { title: "x" }, { feature: "test" }).catch((e: Error) => e);
    expect(String(error)).toContain("Telegram sendMessage: Unauthorized");
    expect(String(error)).not.toContain("ZZZZ");
  });

  it("renders Telegram buttons as callback data within 64 bytes and public links as url buttons", () => {
    const { payload, buttons } = renderTelegram({ ...alert, links: [{ label: "Open", url: "https://chouse.example.com/x" }] }, { actions: true, rowId: "0e6b3c3a-1f6d-4c55-9a2b-1c2d3e4f5a6b" });
    const keyboard = payload.reply_markup!.inline_keyboard;
    expect(keyboard[0][0]).toEqual({ text: "Acknowledge", callback_data: "0e6b3c3a-1f6d-4c55-9a2b-1c2d3e4f5a6b:0" });
    expect(Buffer.byteLength(String(keyboard[0][0].callback_data))).toBeLessThanOrEqual(64);
    expect(keyboard[1][0]).toEqual({ text: "Open", url: "https://chouse.example.com/x" });
    expect(buttons).toEqual([{ action: "data_health.ack", value: "inc-1" }]);
    const long = renderTelegram({ title: "T", text: "a".repeat(10_000), sections: Array.from({ length: 20 }, () => ({ text: "b".repeat(800) })) }, { actions: false, rowId: "r" });
    expect(long.payload.text.length).toBeLessThanOrEqual(4096);
    expect(long.payload.text.startsWith("<b>T</b>")).toBe(true);
  });

  it("keeps only the secrets a channel's mode uses", async () => {
    const id = await createChannel({ name: "switch", type: ChannelType.Slack, config: { webhookUrl: "https://hooks.slack.com/services/x" }, enabled: true });
    await updateChannel(id, { name: "switch", type: ChannelType.Slack, enabled: true, config: { mode: "app", botToken: "xoxb-good", signingSecret: "abcdef0123456789abcdef0123456789", channelId: "C0TEST123" } });
    const stored = JSON.parse((await getChannel(id))!.config) as Record<string, unknown>;
    expect(stored.webhookUrl).toBeUndefined();
    expect(String(stored.botToken)).not.toContain("xoxb");
    expect(maskChannelConfig(ChannelType.Slack, stored).configured).toEqual({ webhookUrl: false, botToken: true, signingSecret: true });
  });
});
