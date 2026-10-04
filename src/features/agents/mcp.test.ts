import { describe, expect, it } from "vitest";

import type { McpTool } from "@/api/agents";
import {
  bulkToolOverrides,
  defaultToolOverrides,
  filterMcpTools,
  groupMcpTools,
  mcpClientSnippets,
  mcpEndpointUrl,
  parseOrigins,
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
  it("prefers the server's public URL", () => {
    expect(mcpEndpointUrl({ path: "/mcp", url: "https://chouse.corp/mcp" }, "http://localhost:5173", "/")).toBe("https://chouse.corp/mcp");
  });

  it("falls back to this origin and base path", () => {
    expect(mcpEndpointUrl({ path: "/mcp", url: null }, "https://chouse.corp", "/")).toBe("https://chouse.corp/mcp");
    expect(mcpEndpointUrl({ path: "/mcp", url: null }, "https://corp", "/chouse/")).toBe("https://corp/chouse/mcp");
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
