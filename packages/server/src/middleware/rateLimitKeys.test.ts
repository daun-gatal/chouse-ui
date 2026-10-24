import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { loginAccountKey, rateLimitClientKey } from "./rateLimitKeys";

function appReturningKey(): Hono {
  const app = new Hono();
  app.get("/ip", (c) => c.text(rateLimitClientKey(c)));
  app.post("/account", async (c) => {
    const key = await loginAccountKey(c);
    // The route handler must still be able to read the body afterwards.
    const body = await c.req.json().catch(() => null);
    return c.json({ key, body });
  });
  return app;
}

describe("rateLimitClientKey", () => {
  it("uses the rightmost X-Forwarded-For hop, which the nearest proxy appended", async () => {
    const res = await appReturningKey().request("/ip", {
      headers: { "X-Forwarded-For": "1.2.3.4, 10.0.0.7" },
    });
    expect(await res.text()).toBe("10.0.0.7");
  });

  it("is not changed by a client-supplied leftmost hop", async () => {
    const app = appReturningKey();
    const a = await app.request("/ip", { headers: { "X-Forwarded-For": "198.51.100.1, 10.0.0.7" } });
    const b = await app.request("/ip", { headers: { "X-Forwarded-For": "198.51.100.2, 10.0.0.7" } });
    expect(await a.text()).toBe(await b.text());
  });

  it("falls back to X-Real-IP, then to a shared bucket", async () => {
    const app = appReturningKey();
    const real = await app.request("/ip", { headers: { "X-Real-IP": "10.0.0.9" } });
    expect(await real.text()).toBe("10.0.0.9");
    const none = await app.request("/ip");
    expect(await none.text()).toBe("unknown");
  });
});

describe("loginAccountKey", () => {
  it("normalises the identifier and leaves the body readable", async () => {
    const res = await appReturningKey().request("/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "  Admin@LocalHost ", password: "x" }),
    });
    const json = await res.json();
    expect(json.key).toBe("admin@localhost");
    expect(json.body).toEqual({ identifier: "  Admin@LocalHost ", password: "x" });
  });

  it("puts malformed bodies in one bucket", async () => {
    const res = await appReturningKey().request("/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect((await res.json()).key).toBe("invalid-body");
  });
});
