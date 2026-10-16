import { describe, expect, it } from "bun:test";
import { Hono, type Context, type Next } from "hono";

import { callerOf, currentCaller, requestCallerMiddleware, runAsCaller, type UsageCaller } from "./origin";

function request(authMethod: "jwt" | "pat", headers: Record<string, string>, patId: string | null = null) {
  return { authMethod, patId, header: (name: string): string | undefined => headers[name] };
}

describe("callerOf", () => {
  it("treats browser sessions as the UI, whatever headers they send", () => {
    expect(callerOf(request("jwt", { "X-Chouse-Agent-Source": "mcp", "User-Agent": "Mozilla/5.0" }))).toEqual({ origin: "ui", patId: null, clientName: null });
  });

  it("names MCP subrequests by the agent the MCP endpoint forwards", () => {
    const caller = callerOf(request("pat", {
      "X-Chouse-Agent-Source": "mcp",
      "X-Chouse-Agent-Client": "claude-code",
      "User-Agent": "chouse-mcp/1",
    }, "pat-1"));
    expect(caller).toEqual({ origin: "mcp", patId: "pat-1", clientName: "Claude Code" });
  });

  it("does not name an MCP request after the MCP endpoint's own User-Agent", () => {
    expect(callerOf(request("pat", { "X-Chouse-Agent-Source": "mcp", "User-Agent": "chouse-mcp/1" }, "pat-1")).clientName).toBeNull();
  });

  it("names direct token callers by their User-Agent", () => {
    expect(callerOf(request("pat", { "User-Agent": "chouse-cli/1.2.0 (linux)" }, "pat-2"))).toEqual({ origin: "token", patId: "pat-2", clientName: "chouse CLI" });
    expect(callerOf(request("pat", {}, "pat-3"))).toEqual({ origin: "token", patId: "pat-3", clientName: null });
  });
});

describe("runAsCaller", () => {
  it("exposes the caller to everything the request awaits, and nothing outside it", async () => {
    expect(currentCaller()).toBeNull();
    const caller: UsageCaller = { origin: "token", patId: "pat-1", clientName: "curl" };
    const seen = await runAsCaller(() => caller, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentCaller();
    });
    expect(seen).toEqual(caller);
    expect(currentCaller()).toBeNull();
  });

  it("lets a nested request (an MCP subrequest) replace the outer caller", async () => {
    const outer: UsageCaller = { origin: "ui", patId: null, clientName: null };
    const inner: UsageCaller = { origin: "mcp", patId: "pat-1", clientName: "Cursor" };
    await runAsCaller(() => outer, async () => {
      expect(await runAsCaller(() => inner, async () => currentCaller())).toEqual(inner);
      expect(currentCaller()).toEqual(outer);
    });
  });
});

describe("requestCallerMiddleware", () => {
  /** Sets the auth context the way rbacAuthMiddleware / connectionContextMiddleware do. */
  function fakeAuth(authMethod: "jwt" | "pat", patId?: string) {
    return async (c: Context, next: Next): Promise<void> => {
      c.set("authMethod", authMethod);
      if (patId) c.set("patId", patId);
      await next();
    };
  }

  function app(...auth: Array<(c: Context, next: Next) => Promise<void>>): Hono {
    const a = new Hono();
    a.use("*", requestCallerMiddleware);
    // Seen before auth ran: no caller yet.
    a.use("*", async (c, next) => {
      c.header("X-Before-Auth", JSON.stringify(currentCaller()));
      await next();
    });
    for (const mw of auth) a.use("*", mw);
    a.get("/run", (c) => c.json(currentCaller()));
    return a;
  }

  it("records the caller set by whichever middleware authenticated the request", async () => {
    const res = await app(fakeAuth("pat", "pat-9")).request("/run", { headers: { "User-Agent": "chouse-cli/1.0.0", "X-Chouse-Agent-Source": "pat" } });
    expect(res.headers.get("X-Before-Auth")).toBe("null");
    expect(await res.json()).toEqual({ origin: "token", patId: "pat-9", clientName: "chouse CLI" });
  });

  it("records MCP subrequests and browser sessions", async () => {
    const mcp = await app(fakeAuth("pat", "pat-1")).request("/run", { headers: { "X-Chouse-Agent-Source": "mcp", "X-Chouse-Agent-Client": "cursor", "User-Agent": "chouse-mcp/1" } });
    expect(await mcp.json()).toEqual({ origin: "mcp", patId: "pat-1", clientName: "Cursor" });
    const ui = await app(fakeAuth("jwt")).request("/run");
    expect(await ui.json()).toEqual({ origin: "ui", patId: null, clientName: null });
  });

  it("has no caller for an unauthenticated request", async () => {
    expect(await (await app().request("/run")).json()).toBeNull();
  });
});
