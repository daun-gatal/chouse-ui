import { describe, it, expect, mock } from "bun:test";
import { Hono } from "hono";

// Token owners come from the RBAC database; stand in for it.
const PAT_OWNERS: Record<string, string> = { ch_pat_alice1: "user-a", ch_pat_alice2: "user-a" };
const OAUTH_OWNERS: Record<string, string> = { ch_oat_alice: "user-a" };
mock.module("../rbac/services/personalAccessTokens", () => ({
  PAT_PREFIX: "ch_pat_",
  patOwner: async (raw: string) => PAT_OWNERS[raw] ?? null,
}));
mock.module("../mcp/oauth/store", () => ({
  oauthAccessTokenOwner: async (raw: string) => OAUTH_OWNERS[raw] ?? null,
}));

const { loginAccountKey, rateLimitClientKey, rateLimitUserKey } = await import("./rateLimitKeys");
const { generateAccessToken } = await import("../rbac/services/jwt");

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

describe("rateLimitUserKey", () => {
  function keyApp(): Hono {
    const app = new Hono();
    app.get("/key", async (c) => c.text(await rateLimitUserKey(c)));
    return app;
  }

  async function keyFor(headers: Record<string, string>): Promise<string> {
    return (await keyApp().request("/key", { headers })).text();
  }

  it("keys a verified session token by its user, not one shared bucket", async () => {
    const alice = await generateAccessToken({ sub: "user-a", email: "a@x", username: "a", roles: [], permissions: [], sessionId: "s1" });
    const aliceOtherTab = await generateAccessToken({ sub: "user-a", email: "a@x", username: "a", roles: [], permissions: [], sessionId: "s2" });
    const bob = await generateAccessToken({ sub: "user-b", email: "b@x", username: "b", roles: [], permissions: [], sessionId: "s3" });
    expect(await keyFor({ Authorization: `Bearer ${alice}` })).toBe("user:user-a");
    expect(await keyFor({ Authorization: `Bearer ${aliceOtherTab}` })).toBe("user:user-a");
    expect(await keyFor({ Authorization: `Bearer ${bob}` })).toBe("user:user-b");
  });

  it("does not trust an unverified token's user id", async () => {
    // A JWT signed with another key that claims to be user-a.
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "user-a", type: "access" })).toString("base64url");
    const forged = `${header}.${body}.c2lnbmF0dXJl`;
    expect(await keyFor({ Authorization: `Bearer ${forged}`, "X-Real-IP": "10.0.0.5" })).toBe("addr:10.0.0.5");
  });

  it("keys a known personal access or OAuth token by its owner, so extra tokens add no budget", async () => {
    expect(await keyFor({ Authorization: "Bearer ch_pat_alice1" })).toBe("user:user-a");
    expect(await keyFor({ Authorization: "Bearer ch_pat_alice2" })).toBe("user:user-a");
    expect(await keyFor({ Authorization: "Bearer ch_oat_alice" })).toBe("user:user-a");
  });

  it("counts made-up tokens by address, so rotating them can't escape the limit", async () => {
    const a = await keyFor({ Authorization: "Bearer ch_pat_madeup1", "X-Real-IP": "10.0.0.7" });
    const b = await keyFor({ Authorization: "Bearer ch_pat_madeup2", "X-Real-IP": "10.0.0.7" });
    const c = await keyFor({ Authorization: "Bearer ch_oat_madeup", "X-Real-IP": "10.0.0.7" });
    expect([a, b, c]).toEqual(["addr:10.0.0.7", "addr:10.0.0.7", "addr:10.0.0.7"]);
  });

  it("falls back to the client address when signed out", async () => {
    expect(await keyFor({ "X-Real-IP": "10.0.0.9" })).toBe("addr:10.0.0.9");
  });
});
