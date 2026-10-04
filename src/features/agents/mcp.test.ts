import { describe, expect, it } from "vitest";

import type { McpTool } from "@/api/agents";
import {
  bulkToolOverrides,
  defaultToolOverrides,
  filterMcpTools,
  groupMcpTools,
  mcpClientSnippets,
  isLocalHost,
  mcpEndpointUrl,
  parseOrigins,
  parsePublicUrl,
} from "./mcp";

function tool(overrides: Partial<McpTool>): McpTool {
  return {
    name: "query",
    title: "Run a read-only query",
    description: "SELECT only",
    category: "query",
    access: "read",
    spendsLlm: false,
    permissions: ["query:execute"],
    parameters: [],
    enabled: true,
    enabledByDefault: true,
    ...overrides,
  };
}

const TOOLS: McpTool[] = [
  tool({}),
  tool({ name: "kill_query", title: "Kill a query", category: "monitoring", access: "destructive", permissions: ["live_queries:kill"], enabled: false, enabledByDefault: false }),
  tool({ name: "whoami", title: "Who am I", category: "identity", permissions: [] }),
  tool({ name: "create_saved_query", title: "Save a query", access: "write", enabled: true, enabledByDefault: false }),
];

describe("mcpEndpointUrl", () => {
  it("prefers the address the server knows and says where it came from", () => {
    expect(mcpEndpointUrl({ path: "/mcp", url: "https://chouse.corp/mcp", source: "settings" }, "http://localhost:5173", "/")).toEqual({
      url: "https://chouse.corp/mcp",
      source: "settings",
      local: false,
    });
    expect(mcpEndpointUrl({ path: "/mcp", url: "https://env.corp/mcp", source: "env" }, "http://localhost:5173", "/").source).toBe("env");
  });

  it("falls back to this page's origin and base path (an Ingress host, an IP, any domain)", () => {
    expect(mcpEndpointUrl({ path: "/mcp", url: null, source: null }, "https://chouse.corp", "/")).toEqual({ url: "https://chouse.corp/mcp", source: "page", local: false });
    expect(mcpEndpointUrl({ path: "/mcp", url: null, source: null }, "https://corp", "/chouse/").url).toBe("https://corp/chouse/mcp");
    expect(mcpEndpointUrl({ path: "/mcp", url: null, source: null }, "http://10.0.4.7:5521", "/").url).toBe("http://10.0.4.7:5521/mcp");
  });

  it("flags addresses only this machine can reach", () => {
    expect(mcpEndpointUrl({ path: "/mcp", url: null, source: null }, "http://localhost:5173", "/").local).toBe(true);
    expect(mcpEndpointUrl({ path: "/mcp", url: null, source: null }, "http://10.0.4.7:5521", "/").local).toBe(false);
  });
});

describe("isLocalHost", () => {
  it("knows loopback names and addresses", () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "127.1.2.3", "[::1]", "0.0.0.0"]) expect(isLocalHost(host)).toBe(true);
    for (const host of ["chouse.corp", "10.0.0.1", "192.168.1.5", "localhost.corp"]) expect(isLocalHost(host)).toBe(false);
  });
});

describe("parsePublicUrl", () => {
  it("accepts a bare address, keeps a base path and drops trailing slashes", () => {
    expect(parsePublicUrl(" https://chouse.corp/ ")).toEqual({ value: "https://chouse.corp" });
    expect(parsePublicUrl("https://corp.example/chouse/")).toEqual({ value: "https://corp.example/chouse" });
    expect(parsePublicUrl("http://10.0.4.7:5521")).toEqual({ value: "http://10.0.4.7:5521" });
  });

  it("clears with an empty box", () => {
    expect(parsePublicUrl("   ")).toEqual({ value: null });
  });

  it("explains what is wrong", () => {
    expect(parsePublicUrl("chouse.corp")).toHaveProperty("error");
    expect(parsePublicUrl("ftp://chouse.corp")).toHaveProperty("error");
    expect(parsePublicUrl("https://chouse.corp/?a=1")).toHaveProperty("error");
  });
});

describe("mcpClientSnippets", () => {
  const snippets = mcpClientSnippets("https://chouse.corp/mcp");

  it("covers every client and points each at the endpoint", () => {
    expect(snippets.map((s) => s.id)).toEqual(["claude-code", "codex", "cursor", "vscode", "opencode", "curl"]);
    for (const snippet of snippets) expect(snippet.code).toContain("https://chouse.corp/mcp");
  });

  it("never embeds a token, only the env var or a secret prompt", () => {
    for (const snippet of snippets) {
      expect(snippet.code).not.toContain("ch_pat_");
      expect(snippet.code.includes("CH_HOUSE_PAT") || snippet.code.includes("${input:chouse_pat}")).toBe(true);
    }
  });

  it("emits valid JSON for the file-based clients", () => {
    for (const snippet of snippets.filter((s) => s.language === "json")) {
      expect(() => JSON.parse(snippet.code)).not.toThrow();
    }
  });
});

describe("filterMcpTools / groupMcpTools", () => {
  it("filters by access, state and text (including permissions)", () => {
    expect(filterMcpTools(TOOLS, { search: "", access: "destructive", state: "all" }).map((t) => t.name)).toEqual(["kill_query"]);
    expect(filterMcpTools(TOOLS, { search: "", access: "all", state: "disabled" }).map((t) => t.name)).toEqual(["kill_query"]);
    expect(filterMcpTools(TOOLS, { search: "live_queries", access: "all", state: "all" }).map((t) => t.name)).toEqual(["kill_query"]);
    expect(filterMcpTools(TOOLS, { search: "WHO", access: "all", state: "all" }).map((t) => t.name)).toEqual(["whoami"]);
  });

  it("groups in display order and drops empty categories", () => {
    expect(groupMcpTools(TOOLS).map((g) => g.category)).toEqual(["identity", "query", "monitoring"]);
    expect(groupMcpTools(TOOLS)[1].tools.map((t) => t.name)).toEqual(["query", "create_saved_query"]);
  });
});

describe("overrides", () => {
  it("switches a set of tools on or off", () => {
    expect(bulkToolOverrides(TOOLS.slice(0, 2), false)).toEqual({ query: false, kill_query: false });
  });

  it("restores defaults", () => {
    expect(defaultToolOverrides(TOOLS)).toEqual({ query: true, kill_query: false, whoami: true, create_saved_query: false });
  });
});

describe("parseOrigins", () => {
  it("accepts origins separated by lines or commas and dedupes", () => {
    expect(parseOrigins("https://a.example\nhttps://b.example, https://a.example/")).toEqual({
      origins: ["https://a.example", "https://b.example"],
      invalid: [],
    });
  });

  it("flags anything that is not a bare http(s) origin", () => {
    expect(parseOrigins("ftp://x.example https://a.example/path nope").invalid).toEqual(["ftp://x.example", "https://a.example/path", "nope"]);
  });

  it("returns nothing for an empty box", () => {
    expect(parseOrigins("  \n ")).toEqual({ origins: [], invalid: [] });
  });
});
