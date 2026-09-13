import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { originGuard } from "./origin";

function makeApp(allowedOrigins: string[]): Hono {
  const app = new Hono();
  app.use("*", originGuard(allowedOrigins));
  app.get("/mcp", (c) => c.json({ ok: true }));
  return app;
}

describe("originGuard", () => {
  it("allows requests without an Origin header even with an empty allowlist", async () => {
    const res = await makeApp([]).request("/mcp");
    expect(res.status).toBe(200);
  });

  it("rejects any Origin when the allowlist is empty (DNS-rebinding protection)", async () => {
    const res = await makeApp([]).request("/mcp", { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("rejects an unlisted Origin when configured", async () => {
    const app = makeApp(["https://good.example"]);
    const res = await app.request("/mcp", { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("allows an exactly matching Origin", async () => {
    const app = makeApp(["https://good.example"]);
    const res = await app.request("/mcp", { headers: { Origin: "https://good.example" } });
    expect(res.status).toBe(200);
  });

  it("matches origins exactly (no prefix/suffix games)", async () => {
    const app = makeApp(["https://good.example"]);
    const sneaky = await app.request("/mcp", { headers: { Origin: "https://good.example.evil.com" } });
    expect(sneaky.status).toBe(403);
    const otherPort = await app.request("/mcp", { headers: { Origin: "https://good.example:8443" } });
    expect(otherPort.status).toBe(403);
  });
});
