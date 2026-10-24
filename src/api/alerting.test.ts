import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/test/mocks/server";
import { listChannels, postChannelMessage, testChannel } from "./alerting";

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
