import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { assessScheduledQuery, diagnoseScheduledRun, summarizeScheduledQuery } from "./dataOpsAi";

describe("DataOps AI API", () => {
  it("invokes object-scoped structured capabilities", async () => {
    const seen: string[] = [];
    server.use(http.post("/api/ai/invoke", async ({ request }) => {
      const body = await request.json() as { capability: string };
      seen.push(body.capability);
      if (body.capability === "summarize-scheduled-query") return HttpResponse.json({ success: true, data: { headline: "Healthy", summary: "Runs daily", health: "healthy", facts: [], changes: [], suggestedAction: null, confidence: 1, evidence: [], generatedAt: 1, fingerprint: "f", model: "m" } });
      if (body.capability === "diagnose-scheduled-run") return HttpResponse.json({ success: true, data: { summary: "Failed", likelyCause: "Schema drift", confidence: 0.8, observedFacts: [], hypotheses: [], impact: [], actions: [], evidence: [], generatedAt: 1, model: "m" } });
      return HttpResponse.json({ success: true, data: { readiness: "ready", summary: "Safe", blockers: [], warnings: [], recommendations: [], confidence: 1 } });
    }));

    expect((await summarizeScheduledQuery("job-1")).headline).toBe("Healthy");
    expect((await diagnoseScheduledRun("job-1", "run-1")).likelyCause).toBe("Schema drift");
    expect((await assessScheduledQuery({ name: "x", connectionId: "conn-1", query: "SELECT 1", frequency: "daily", timezone: "UTC", outputMode: "none", timeoutSecs: 60, maxAttempts: 2 })).readiness).toBe("ready");
    expect(seen).toEqual(["summarize-scheduled-query", "diagnose-scheduled-run", "assess-scheduled-query"]);
  });
});
