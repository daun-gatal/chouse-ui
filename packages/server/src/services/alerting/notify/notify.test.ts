/**
 * The shared notify layer (ADR 0026 §1): rendering for each platform, the
 * message log that keeps a message from being sent twice, and the webhook
 * contracts features had before it (they must not change).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../../rbac/db";
import { runMigrations } from "../../../rbac/db/migrations";
import { freshDatabase, rawAll, rawRun } from "../../../rbac/db/migrationTestHarness";
import { createChannel, getChannel } from "../store";
import { ChannelType } from "../types";
import { editSubject, isDeliverable, notifyChannelIds, sendToChannel, TEST_MESSAGE } from "./index";
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
    const log = await rawAll(sql`SELECT channel_id, feature, subject_id, kind, state, message FROM channel_messages ORDER BY created_at`);
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
