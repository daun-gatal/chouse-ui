/**
 * Actions from chat (ADR 0026 §3–4), end to end through the public endpoints:
 * each platform's request authentication, the click's place and message,
 * mapping the clicker to a CHouse user, the channel's allowlist, the action
 * run as that user with a two-minute token, Telegram linking, and the audit.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createHmac, createPublicKey, generateKeyPairSync } from "crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { decodeJwt, importPKCS8, SignJWT } from "jose";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import * as h from "../rbac/db/migrationTestHarness";
import { errorHandler } from "../middleware/error";
import { registerInProcessApi } from "../services/ai/registry/inProcessApi";
import { createChannel, getChannel } from "../services/alerting/store";
import { ChannelType } from "../services/alerting/types";
import { sendToChannel } from "../services/alerting/notify";
import { registerChatAction } from "../services/alerting/notify/actions";
import { createLinkCode } from "../services/alerting/notify/actors";
import { resetGoogleKeys } from "../services/alerting/notify/googleVerify";
import { resetPlatformHosts } from "../services/alerting/notify/hosts";
import { telegramSecretToken } from "../services/alerting/notify/telegramWebhook";
import integrations from "./integrations";

const SIGNING = "0123456789abcdef0123456789abcdef";
const OTHER_SIGNING = "fedcba9876543210fedcba9876543210";
const TG = "555555:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123";
const PROJECT = "123456789012";

const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
const echoes: Array<{ value: string; auth: string }> = [];
let platform: ReturnType<typeof Bun.serve>;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
let jwks: Record<string, unknown>;

const SLACK_USERS: Record<string, { email?: string; is_email_confirmed?: boolean }> = {
  U_ALICE: { email: "alice@test.local", is_email_confirmed: true },
  U_CAROL: { email: "carol@test.local", is_email_confirmed: true },
  U_BOB: { email: "bob@test.local", is_email_confirmed: true },
  U_NOMAIL: {},
  U_UNCONF: { email: "alice@test.local", is_email_confirmed: false },
};

function app(): Hono {
  const a = new Hono();
  a.onError(errorHandler);
  a.route("/integrations", integrations);
  return a;
}

function slackSign(body: string, secret: string, ts = Math.floor(Date.now() / 1000)): Record<string, string> {
  return {
    "X-Slack-Request-Timestamp": String(ts),
    "X-Slack-Signature": `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

async function slackClick(user: string, value: string, place: { channel: string; ts: string }, secret = SIGNING, ts?: number): Promise<number> {
  const payload = JSON.stringify({ type: "block_actions", user: { id: user, username: user.toLowerCase() }, channel: { id: place.channel }, container: { message_ts: place.ts }, actions: [{ action_id: "chouse_0", value }] });
  const body = `payload=${encodeURIComponent(payload)}`;
  const res = await app().request("/integrations/slack/interactions", { method: "POST", headers: slackSign(body, secret, ts), body });
  return res.status;
}

async function waitFor<T>(fn: () => T | undefined, ms = 3000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v !== undefined) return v;
    await Bun.sleep(20);
  }
  return undefined;
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await h.freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
  for (const [id, active] of [["alice", 1], ["carol", 1], ["bob", 0]] as const) {
    await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@test.local`}, ${id}, 'x', ${active}, unixepoch(), unixepoch())`);
  }
  const jwk = createPublicKey(publicKey).export({ format: "jwk" }) as { kty: string; n: string; e: string };
  const pub = { kty: jwk.kty, n: jwk.n, e: jwk.e, kid: "k1", alg: "RS256", use: "sig" };
  jwks = { keys: [pub] };
  platform = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const u = new URL(req.url);
      const text = await req.text();
      const body = (text.startsWith("{") ? JSON.parse(text) : {}) as Record<string, unknown>;
      calls.push({ path: u.pathname, body });
      const json = (v: unknown): Response => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (u.pathname === "/slack/api/users.info") {
        const user = SLACK_USERS[String(body.user)];
        return json(user ? { ok: true, user: { profile: { email: user.email }, is_email_confirmed: user.is_email_confirmed } } : { ok: false, error: "user_not_found" });
      }
      if (u.pathname === "/slack/api/usergroups.users.list") return json({ ok: true, users: body.usergroup === "S0GROUP01" ? ["U_ALICE"] : [] });
      if (u.pathname === "/slack/api/chat.postMessage") return json({ ok: true, channel: "C0TEST123", ts: `1700000000.${calls.length}` });
      if (u.pathname.startsWith("/slack/api/")) return json({ ok: true });
      if (u.pathname.startsWith("/certs/")) return json(jwks);
      if (u.pathname === "/goauth/token") return json({ access_token: "ya29", expires_in: 3600 });
      if (u.pathname === "/gchat/v1/spaces/AAAA/messages") return json({ name: `spaces/AAAA/messages/m${calls.length}` });
      if (u.pathname.startsWith("/gchat/")) return json({});
      if (u.pathname.startsWith("/tg/")) {
        if (u.pathname.endsWith("/sendMessage")) return json({ ok: true, result: { message_id: calls.length, chat: { id: Number(body.chat_id) } } });
        if (u.pathname.endsWith("/getMe")) return json({ ok: true, result: { username: "chouse_test_bot" } });
        return json({ ok: true, result: true });
      }
      return json({ ok: false });
    },
  });
  const base = `http://127.0.0.1:${platform.port}`;
  process.env.CHOUSE_ALLOW_TEST_OVERRIDES = "1";
  process.env.CHOUSE_INTEGRATIONS_TEST_HOSTS = JSON.stringify({ slack: `${base}/slack`, googleOauth: `${base}/goauth`, googleChat: `${base}/gchat`, googleCerts: `${base}/certs`, telegram: `${base}/tg` });
  resetPlatformHosts();
  resetGoogleKeys();
  const api = new Hono();
  api.post("/api/echo", async (c) => {
    const { value } = (await c.req.json()) as { value: string };
    echoes.push({ value, auth: c.req.header("Authorization") ?? "" });
    if (value === "deny") return c.json({ success: false, error: { message: "You need data_health:edit" } }, 403);
    return c.json({ success: true, data: { ok: true } });
  });
  registerInProcessApi(api);
  registerChatAction({ action: "test.echo", run: async (client, value) => { await client.post("/api/echo", { value }); return `Echoed ${value}.`; } });
}, 60_000);

afterAll(async () => {
  platform.stop(true);
  delete process.env.CHOUSE_INTEGRATIONS_TEST_HOSTS;
  delete process.env.CHOUSE_ALLOW_TEST_OVERRIDES;
  resetPlatformHosts();
  await closeDatabase();
});

beforeEach(() => {
  calls.length = 0;
  echoes.length = 0;
});

async function post(channelId: string, value: string): Promise<{ messageId: string; ref: Record<string, unknown> }> {
  const row = (await getChannel(channelId))!;
  const sent = await sendToChannel(row, { title: "Alert", buttons: [{ action: "test.echo", label: "Do it", value }] }, { feature: "data_health", subjectId: `s-${Math.random()}` });
  const stored = await h.rawAll(sql`SELECT platform_ref FROM channel_messages WHERE id = ${sent.messageId}`);
  return { messageId: sent.messageId!, ref: JSON.parse(String(stored[0].platform_ref)) as Record<string, unknown> };
}

const ephemeral = (): Record<string, unknown> | undefined => calls.find((c) => c.path === "/slack/api/chat.postEphemeral")?.body;

describe("Slack", () => {
  let slack: string;
  let other: string;
  beforeAll(async () => {
    slack = await createChannel({ name: "slack", type: ChannelType.Slack, config: { mode: "app", botToken: "xoxb-a", signingSecret: SIGNING, channelId: "C0TEST123" }, enabled: true });
    other = await createChannel({ name: "slack-other", type: ChannelType.Slack, config: { mode: "app", botToken: "xoxb-b", signingSecret: OTHER_SIGNING, channelId: "C0TEST999" }, enabled: true });
  });

  it("runs the action as the clicker, with a two-minute chat token, and answers only them", async () => {
    const { messageId, ref } = await post(slack, "inc-1");
    calls.length = 0;
    expect(await slackClick("U_ALICE", `${messageId}:0`, { channel: String(ref.channel), ts: String(ref.ts) })).toBe(200);
    const reply = await waitFor(ephemeral);
    expect(reply).toMatchObject({ channel: "C0TEST123", user: "U_ALICE", text: "Echoed inc-1." });
    expect(echoes).toHaveLength(1);
    const claims = decodeJwt(echoes[0].auth.slice(7));
    expect(claims.sub).toBe("alice");
    expect(String(claims.sessionId)).toMatch(/^chat:slack:/);
    expect(Number(claims.exp) - Number(claims.iat)).toBe(120);
    const audit = await h.rawAll(sql`SELECT user_id, status, details FROM rbac_audit_logs WHERE action = 'alerting.chat_action' ORDER BY created_at DESC LIMIT 1`);
    expect(String(audit[0].user_id)).toBe("alice");
    expect(String(audit[0].status)).toBe("success");
    expect(JSON.parse(String(audit[0].details))).toMatchObject({ platform: "slack", channelId: slack, action: "test.echo", target: "inc-1", platformUser: "U_ALICE", email: "alice@test.local" });
  });

  it("refuses requests that are not signed by the message's own channel, or are replayed", async () => {
    const { messageId, ref } = await post(slack, "inc-2");
    const place = { channel: String(ref.channel), ts: String(ref.ts) };
    expect(await slackClick("U_ALICE", `${messageId}:0`, place, "0000000000000000000000000000000x")).toBe(401);
    expect(await slackClick("U_ALICE", `${messageId}:0`, place, OTHER_SIGNING)).toBe(401);
    expect(await slackClick("U_ALICE", `${messageId}:0`, place, SIGNING, Math.floor(Date.now() / 1000) - 600)).toBe(401);
    await Bun.sleep(50);
    expect(echoes).toEqual([]);
    void other;
  });

  it("refuses a click from another message, an unknown button and a settled message", async () => {
    const { messageId, ref } = await post(slack, "inc-3");
    await slackClick("U_ALICE", `${messageId}:0`, { channel: String(ref.channel), ts: "1.0" });
    expect((await waitFor(ephemeral))?.text).toBe("This button is not one CHouse posted here.");
    calls.length = 0;
    await slackClick("U_ALICE", `${messageId}:5`, { channel: String(ref.channel), ts: String(ref.ts) });
    expect((await waitFor(ephemeral))?.text).toBe("This button no longer does anything.");
    calls.length = 0;
    await h.rawRun(sql`UPDATE channel_messages SET closed_at = 1 WHERE id = ${messageId}`);
    await slackClick("U_ALICE", `${messageId}:0`, { channel: String(ref.channel), ts: String(ref.ts) });
    expect((await waitFor(ephemeral))?.text).toBe("This was already settled.");
    expect(echoes).toEqual([]);
  });

  it("refuses clickers CHouse cannot map to an active user", async () => {
    const cases: Array<[string, string]> = [
      ["U_NOMAIL", "CHouse cannot see your Slack email. Ask an admin to grant the app users:read.email."],
      ["U_UNCONF", "Confirm your Slack email first, so CHouse knows it is you."],
      ["U_BOB", "No active CHouse user has the email bob@test.local."],
    ];
    for (const [user, text] of cases) {
      const { messageId, ref } = await post(slack, "inc-4");
      calls.length = 0;
      await slackClick(user, `${messageId}:0`, { channel: String(ref.channel), ts: String(ref.ts) });
      expect((await waitFor(ephemeral))?.text).toBe(text);
    }
    expect(echoes).toEqual([]);
  });

  it("the allowlist narrows: only members of the listed group may act", async () => {
    const row = (await getChannel(slack))!;
    const config = { ...JSON.parse(row.config), actors: { mode: "only", platformUsers: [], platformGroups: ["S0GROUP01"], domains: [], users: [], roles: [] } };
    await h.rawRun(sql`UPDATE notification_channels SET config = ${JSON.stringify(config)} WHERE id = ${slack}`);
    const a = await post(slack, "inc-5");
    calls.length = 0;
    await slackClick("U_CAROL", `${a.messageId}:0`, { channel: String(a.ref.channel), ts: String(a.ref.ts) });
    expect((await waitFor(ephemeral))?.text).toBe("You are not on this channel's list of people who can act from it.");
    calls.length = 0;
    await slackClick("U_ALICE", `${a.messageId}:0`, { channel: String(a.ref.channel), ts: String(a.ref.ts) });
    expect((await waitFor(ephemeral))?.text).toBe("Echoed inc-5.");
    expect(echoes.map((e) => decodeJwt(e.auth.slice(7)).sub)).toEqual(["alice"]);
  });

  it("passes on the route's own refusal", async () => {
    const row = (await getChannel(slack))!;
    const config = JSON.parse(row.config);
    delete config.actors;
    await h.rawRun(sql`UPDATE notification_channels SET config = ${JSON.stringify(config)} WHERE id = ${slack}`);
    const { messageId, ref } = await post(slack, "deny");
    calls.length = 0;
    await slackClick("U_CAROL", `${messageId}:0`, { channel: String(ref.channel), ts: String(ref.ts) });
    expect((await waitFor(ephemeral))?.text).toBe("You need data_health:edit");
  });
});

describe("Telegram", () => {
  let tg: string;
  const secret = (): string => telegramSecretToken(TG);
  const update = (body: unknown, header = secret()): Promise<Response> =>
    Promise.resolve(app().request("/integrations/telegram/555555", { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": header }, body: JSON.stringify(body) }));
  const answer = (): Record<string, unknown> | undefined => calls.find((c) => c.path.endsWith("/answerCallbackQuery"))?.body;
  const said = (): Record<string, unknown> | undefined => calls.find((c) => c.path.endsWith("/sendMessage"))?.body;

  beforeAll(async () => {
    tg = await createChannel({ name: "tg", type: ChannelType.Telegram, config: { botToken: TG, chatId: "-1001", webhookRegistered: true }, enabled: true });
  });

  const click = (from: number, data: string, messageId: number, chatId = -1001): Promise<Response> =>
    update({ callback_query: { id: "cb1", from: { id: from, username: `u${from}` }, data, message: { message_id: messageId, chat: { id: chatId } } } });

  it("refuses an update without the webhook's secret token", async () => {
    expect((await update({}, "wrong")).status).toBe(401);
    expect((await app().request("/integrations/telegram/999", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret() }, body: "{}" })).status).toBe(401);
  });

  it("asks an unlinked account to link first", async () => {
    const { messageId, ref } = await post(tg, "inc-t1");
    calls.length = 0;
    expect((await click(42, `${messageId}:0`, Number(ref.messageId))).status).toBe(200);
    expect(answer()).toMatchObject({ callback_query_id: "cb1", show_alert: true, text: "Link your Telegram account first: CHouse › your profile › Linked chat accounts." });
  });

  it("links an account with a one-time code in a private chat, then its clicks act as that user", async () => {
    const { code } = await createLinkCode("alice", "telegram");
    calls.length = 0;
    await update({ message: { text: `/start ${code}`, from: { id: 42, username: "alice_tg" }, chat: { id: 42, type: "group" } } });
    expect(said()?.text).toBe("Open this link in a private chat with the bot.");
    calls.length = 0;
    await update({ message: { text: `/start ${code}`, from: { id: 42, username: "alice_tg" }, chat: { id: 42, type: "private" } } });
    expect(said()?.text).toBe("Linked to CHouse user alice. You can now use the buttons in CHouse alerts.");
    calls.length = 0;
    await update({ message: { text: `/start ${code}`, from: { id: 43 }, chat: { id: 43, type: "private" } } });
    expect(said()?.text).toBe("This link expired or was already used. Make a new one in CHouse.");
    expect(await h.rawAll(sql`SELECT user_id, external_id, display_name FROM chat_identities`)).toEqual([{ user_id: "alice", external_id: "42", display_name: "@alice_tg" }]);

    const { messageId, ref } = await post(tg, "inc-t2");
    calls.length = 0;
    await click(42, `${messageId}:0`, Number(ref.messageId));
    expect(answer()).toMatchObject({ show_alert: false, text: "Echoed inc-t2." });
    expect(decodeJwt(echoes[0].auth.slice(7)).sub).toBe("alice");
  });

  it("routes a click to the channel that posted it when channels share a bot and a chat", async () => {
    const twin = await createChannel({ name: "tg-twin", type: ChannelType.Telegram, config: { botToken: TG, chatId: "-1001", webhookRegistered: true }, enabled: true });
    const { messageId, ref } = await post(twin, "inc-twin");
    calls.length = 0;
    await click(42, `${messageId}:0`, Number(ref.messageId));
    expect(answer()).toMatchObject({ show_alert: false, text: "Echoed inc-twin." });
    await h.rawRun(sql`DELETE FROM notification_channels WHERE id = ${twin}`);
  });

  it("refuses a click from another chat, and an expired code", async () => {
    const { messageId, ref } = await post(tg, "inc-t3");
    calls.length = 0;
    await click(42, `${messageId}:0`, Number(ref.messageId), -2002);
    expect(answer()?.text).toBe("This chat is not a CHouse channel.");
    const { code } = await createLinkCode("carol", "telegram", Date.now() - 11 * 60_000);
    calls.length = 0;
    await update({ message: { text: `/start ${code}`, from: { id: 77 }, chat: { id: 77, type: "private" } } });
    expect(said()?.text).toBe("This link expired or was already used. Make a new one in CHouse.");
    expect(echoes).toEqual([]);
    void tg;
  });
});

describe("Google Chat", () => {
  let chat: string;
  const SA = JSON.stringify({ client_email: "x@p.iam.gserviceaccount.com", private_key: privateKey });
  const sign = async (audience: string, issuer = "chat@system.gserviceaccount.com"): Promise<string> =>
    new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime("5m").sign(await importPKCS8(privateKey, "RS256"));
  const event = async (token: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
    const res = await app().request("/integrations/google-chat/events", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    chat = await createChannel({ name: "chat", type: ChannelType.GoogleChat, config: { mode: "app", serviceAccountJson: SA, space: "spaces/AAAA", audience: PROJECT }, enabled: true });
  });

  it("verifies Google's token and runs the click as the user with that email, answering privately", async () => {
    const { messageId, ref } = await post(chat, "inc-g1");
    const res = await event(await sign(PROJECT), { type: "CARD_CLICKED", space: { name: "spaces/AAAA" }, message: { name: ref.name }, user: { name: "users/9", email: "carol@test.local", displayName: "Carol" }, common: { parameters: { button: `${messageId}:0` } } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ actionResponse: { type: "NEW_MESSAGE" }, privateMessageViewer: { name: "users/9" }, text: "Echoed inc-g1." });
    expect(decodeJwt(echoes[0].auth.slice(7)).sub).toBe("carol");
  });

  it("refuses a wrong audience or issuer, a missing token, and a click from another space", async () => {
    const { messageId, ref } = await post(chat, "inc-g2");
    const body = { type: "CARD_CLICKED", space: { name: "spaces/AAAA" }, message: { name: ref.name }, user: { name: "users/9", email: "carol@test.local" }, common: { parameters: { button: `${messageId}:0` } } };
    expect((await event(await sign("999999999999"), body)).status).toBe(401);
    expect((await event(await sign(PROJECT, "someone@else.com"), body)).status).toBe(401);
    expect((await app().request("/integrations/google-chat/events", { method: "POST", body: JSON.stringify(body) })).status).toBe(401);
    expect((await event(await sign(PROJECT), { ...body, space: { name: "spaces/BBBB" } })).status).toBe(401);
    expect(echoes).toEqual([]);
    void chat;
  });
});
