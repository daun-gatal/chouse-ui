import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/test/mocks/server";
import { getBriefing, getChobiSettings, updateChobiSettings } from "./chobi";

const BRIEFING = { generatedAt: 1, general: [], connections: [], ai: { changedToday: 0, undoable: 0 }, unavailable: [] };

describe("chobi API", () => {
  it("reads the briefing, fresh when asked", async () => {
    const seen: string[] = [];
    server.use(http.get("/api/chobi/briefing", ({ request }) => {
      seen.push(new URL(request.url).search);
      return HttpResponse.json({ success: true, data: BRIEFING });
    }));
    expect(await getBriefing()).toEqual(BRIEFING);
    await getBriefing(true);
    expect(seen).toEqual(["", "?fresh=1"]);
  });

  it("reads and changes the organization's settings", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get("/api/chobi/settings", () => HttpResponse.json({ success: true, data: { plainMode: false, nudges: true, alerts: { enabled: false, events: { secondApprover: true, background: true, heldMcp: false }, delayMinutes: 5, channels: [] }, publicBaseUrl: true, updatedAt: null } })),
      http.put("/api/chobi/settings", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ success: true, data: { plainMode: true, nudges: true, updatedAt: 5 } });
      }),
    );
    expect(await getChobiSettings()).toMatchObject({ plainMode: false, nudges: true, alerts: { enabled: false, delayMinutes: 5 }, publicBaseUrl: true });
    expect(await updateChobiSettings({ plainMode: true })).toEqual({ plainMode: true, nudges: true, updatedAt: 5 });
    expect(bodies).toEqual([{ plainMode: true }]);
  });
});
