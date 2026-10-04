import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { getAssessment, getReplay, getRollout, listAssessments, runAssessment, startReplay } from "./upgrades";

describe("upgrades API", () => {
  it("runs assessments and replays", async () => {
    const seen: Array<{ method: string; path: string; body: unknown }> = [];
    server.use(
      http.all("/api/upgrades/*", async ({ request }) => {
        const url = new URL(request.url);
        const text = request.method === "GET" ? "" : await request.text();
        seen.push({ method: request.method, path: url.pathname, body: text ? JSON.parse(text) : undefined });
        return HttpResponse.json({ success: true, data: { nodes: [{ connectionId: "c1" }], assessments: [], replays: [] } });
      }),
    );
    await listAssessments("c1");
    await getAssessment("a1");
    await runAssessment("25.3");
    await startReplay("c2", "a1");
    await getReplay("r1");
    expect(await getRollout()).toEqual([{ connectionId: "c1" }]);
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "GET /api/upgrades/assessments",
      "GET /api/upgrades/assessments/a1",
      "POST /api/upgrades/assessments",
      "POST /api/upgrades/replays",
      "GET /api/upgrades/replays/r1",
      "GET /api/upgrades/rollout",
    ]);
    expect(seen[2].body).toEqual({ targetVersion: "25.3" });
    expect(seen[3].body).toEqual({ canaryConnectionId: "c2", assessmentId: "a1" });
  });
});
