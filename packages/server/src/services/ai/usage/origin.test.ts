import { describe, expect, it } from "bun:test";

import { callerOf, currentCaller, runAsCaller } from "./origin";

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
    const caller = { origin: "token" as const, patId: "pat-1", clientName: "curl" };
    const seen = await runAsCaller(caller, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentCaller();
    });
    expect(seen).toEqual(caller);
    expect(currentCaller()).toBeNull();
  });

  it("lets a nested request (an MCP subrequest) replace the outer caller", async () => {
    const outer = { origin: "ui" as const, patId: null, clientName: null };
    const inner = { origin: "mcp" as const, patId: "pat-1", clientName: "Cursor" };
    await runAsCaller(outer, async () => {
      expect(await runAsCaller(inner, async () => currentCaller())).toEqual(inner);
      expect(currentCaller()).toEqual(outer);
    });
  });
});
