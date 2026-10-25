import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/test/mocks/server";
import { ChannelType, isAppChannel, listChannels, postChannelMessage, testChannel, visibleFieldSpecs } from "./alerting";

describe("alerting API", () => {
  it("lists channels and sends a test", async () => {
    const hits: string[] = [];
    server.use(
      http.get("/api/alerting/channels", () => HttpResponse.json({ success: true, data: [{ id: "c1", name: "oncall", type: "slack", enabled: true, config: {}, configured: {} }] })),
      http.post("/api/alerting/channels/c1/test", () => {
        hits.push("test");
        return HttpResponse.json({ success: true });
      }),
    );
    expect((await listChannels()).map((c) => c.name)).toEqual(["oncall"]);
    await testChannel("c1");
    expect(hits).toEqual(["test"]);
  });

  it("posts a handoff message to a channel", async () => {
    const bodies: unknown[] = [];
    server.use(http.post("/api/alerting/channels/c%201/message", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ success: true, data: { sent: true, channel: "oncall" } });
    }));
    expect(await postChannelMessage("c 1", { title: "Handoff", text: "Done." })).toEqual({ sent: true, channel: "oncall" });
    expect(bodies).toEqual([{ title: "Handoff", text: "Done." }]);
  });
});

describe("channel field specs", () => {
  it("shows the webhook field until the mode is App, then the bot fields", () => {
    expect(visibleFieldSpecs(ChannelType.Slack, {}).map((s) => s.key)).toEqual(["mode", "webhookUrl"]);
    expect(visibleFieldSpecs(ChannelType.Slack, { mode: "app" }).map((s) => s.key)).toEqual(["mode", "botToken", "signingSecret", "channelId"]);
    expect(visibleFieldSpecs(ChannelType.GoogleChat, { mode: "app" }).map((s) => s.key)).toEqual(["mode", "serviceAccountJson", "space", "audience"]);
    expect(visibleFieldSpecs(ChannelType.Telegram, {}).map((s) => s.key)).toEqual(["botToken", "chatId", "topicId"]);
    expect(visibleFieldSpecs(ChannelType.Email, {}).map((s) => s.key)).toContain("password");
  });

  it("knows which channels are bots", () => {
    expect(isAppChannel({ type: ChannelType.Telegram, config: {} })).toBe(true);
    expect(isAppChannel({ type: ChannelType.Slack, config: { mode: "app" } })).toBe(true);
    expect(isAppChannel({ type: ChannelType.Slack, config: {} })).toBe(false);
    expect(isAppChannel({ type: ChannelType.Webhook, config: { mode: "app" } })).toBe(false);
  });
});
