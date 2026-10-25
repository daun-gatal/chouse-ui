import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/test/mocks/server";
import { ChannelType, getAlertingOverview, isAppChannel, listChannels, postChannelMessage, searchEvents, testChannel, usageTotal, visibleFieldSpecs } from "./alerting";

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

describe("alerting hub API", () => {
  it("searches history with only the filters given, and reads the overview", async () => {
    const urls: string[] = [];
    server.use(
      http.get("/api/alerting/events/search", ({ request }) => {
        urls.push(new URL(request.url).search);
        return HttpResponse.json({ success: true, data: { events: [], nextCursor: "abc" } });
      }),
      http.get("/api/alerting/overview", () => HttpResponse.json({ success: true, data: { firing: { fleet: 1, dashboards: 0, dataHealth: 2 }, sent24h: 5, failed24h: 1, waiting: 0, failing: [] } })),
    );
    expect((await searchEvents({ q: "50% load", source: "", failed: false, cursor: null, limit: 20 })).nextCursor).toBe("abc");
    expect(urls[0]).toBe("?q=50%25+load&failed=false&limit=20");
    expect((await getAlertingOverview()).firing.dataHealth).toBe(2);
  });

  it("totals what uses a channel", () => {
    expect(usageTotal(undefined)).toBe(0);
    expect(usageTotal({ fleetRules: 1, dashboardAlerts: 2, dashboardReports: 0, scheduledQueries: 0, dataHealth: 3, triage: 0, chobi: 1, remediation: 0 })).toBe(7);
  });
});
