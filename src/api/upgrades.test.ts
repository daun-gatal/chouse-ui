import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { getAssessment, getFleetUpgrades, getReferences, getReplay, getUpgradeStatus, listAssessments, startCheck, startReplay } from "./upgrades";

describe("upgrades API", () => {
  it("calls the upgrade check routes with the right paths, params and bodies", async () => {
    const seen: Array<{ method: string; path: string; search: string; body: unknown }> = [];
    server.use(
      http.all("/api/upgrades/*", async ({ request }) => {
        const url = new URL(request.url);
        const text = request.method === "GET" ? "" : await request.text();
        seen.push({ method: request.method, path: url.pathname, search: url.search, body: text ? JSON.parse(text) : undefined });
        return HttpResponse.json({ success: true, data: { references: [{ connectionId: "c2", name: "staging", version: "26.8.36.3" }], nodes: [], enabled: true, assessments: [], replays: [], id: "a1", status: "running" } });
      }),
    );
    await getUpgradeStatus("c1");
    expect(await getReferences("26.8.36.3", "c1")).toEqual([{ connectionId: "c2", name: "staging", version: "26.8.36.3" }]);
    await getFleetUpgrades();
    await listAssessments("c1");
    await getAssessment("a/1");
    await startCheck("26.8.36.3", "c2", "c1");
    await startCheck("26.8.36.3", null, "c1");
    await startReplay("c2", "a1");
    await getReplay("r1");
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "GET /api/upgrades/status",
      "GET /api/upgrades/references",
      "GET /api/upgrades/fleet",
      "GET /api/upgrades/assessments",
      "GET /api/upgrades/assessments/a%2F1",
      "POST /api/upgrades/assessments",
      "POST /api/upgrades/assessments",
      "POST /api/upgrades/replays",
      "GET /api/upgrades/replays/r1",
    ]);
    expect(new URLSearchParams(seen[1].search).get("target")).toBe("26.8.36.3");
    expect(new URLSearchParams(seen[1].search).get("connectionId")).toBe("c1");
    expect(seen[5].body).toEqual({ targetVersion: "26.8.36.3", referenceConnectionId: "c2" });
    expect(seen[6].body).toEqual({ targetVersion: "26.8.36.3" });
    expect(seen[7].body).toEqual({ canaryConnectionId: "c2", assessmentId: "a1" });
  });
});
