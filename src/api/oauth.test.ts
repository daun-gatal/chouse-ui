import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/test/mocks/server";
import { approveSignIn, denySignIn, getSignInRequest, listConnectedApps, revokeConnectedApp } from "./oauth";

const POLICY = { toolkits: ["data"], t1: "auto", t2: "confirm", t3: "approver" } as const;

describe("MCP OAuth API", () => {
  it("reads a sign-in request and answers it", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get("/api/oauth/requests/req%201", () => HttpResponse.json({
        success: true,
        data: {
          request: { id: "req 1", expiresAt: 5 },
          client: { id: "chc_1", name: "Atlas", status: "allowed", returnsTo: "agent.example", clientUri: null },
          user: { email: "ana@x.io", username: "ana" },
          canAct: true,
          ceiling: { toolkits: ["data"], maxTier: "t2" },
          defaults: POLICY,
          dayChoices: [1, 7, 30, 90],
          defaultDays: 90,
        },
      })),
      http.post("/api/oauth/requests/req%201/approve", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ success: true, data: { redirectUrl: "https://agent.example/cb?code=c" } });
      }),
      http.post("/api/oauth/requests/req%201/deny", () => HttpResponse.json({ success: true, data: { redirectUrl: "https://agent.example/cb?error=access_denied" } })),
    );
    const request = await getSignInRequest("req 1");
    expect(request.client.returnsTo).toBe("agent.example");
    expect(request.dayChoices).toEqual([1, 7, 30, 90]);
    expect((await approveSignIn("req 1", { ...POLICY, toolkits: ["data"] }, 30)).redirectUrl).toBe("https://agent.example/cb?code=c");
    expect(bodies).toEqual([{ policy: POLICY, days: 30 }]);
    expect((await denySignIn("req 1")).redirectUrl).toContain("access_denied");
  });

  it("lists and revokes connected apps", async () => {
    const hits: string[] = [];
    server.use(
      http.get("/api/oauth/grants", () => HttpResponse.json({ success: true, data: { grants: [{ id: "g1", clientId: "chc_1", clientName: "Atlas", clientStatus: "allowed", returnsTo: "agent.example", createdAt: 1, expiresAt: 2, lastUsedAt: null, policy: POLICY }] } })),
      http.delete("/api/oauth/grants/g1", () => {
        hits.push("delete");
        return HttpResponse.json({ success: true });
      }),
    );
    const apps = await listConnectedApps();
    expect(apps.map((a) => a.clientName)).toEqual(["Atlas"]);
    await revokeConnectedApp("g1");
    expect(hits).toEqual(["delete"]);
  });

  it("surfaces the server's message when a request has expired", async () => {
    server.use(http.get("/api/oauth/requests/gone", () => HttpResponse.json({ success: false, error: { code: "NOT_FOUND", message: "This sign-in request has expired" } }, { status: 404 })));
    await expect(getSignInRequest("gone")).rejects.toThrow("expired");
  });
});
