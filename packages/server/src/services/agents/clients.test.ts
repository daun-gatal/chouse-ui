import { describe, expect, it } from "bun:test";

import { describeAgentClient, initializeClientName, INTERNAL_MCP_USER_AGENT } from "./clients";

describe("describeAgentClient", () => {
  it("names well-known clients from clientInfo names and User-Agents alike", () => {
    expect(describeAgentClient("claude-code")).toBe("Claude Code");
    expect(describeAgentClient("claude-code/2.0.14 (external, cli)")).toBe("Claude Code");
    expect(describeAgentClient("cursor-vscode")).toBe("Cursor");
    expect(describeAgentClient("Visual Studio Code")).toBe("VS Code");
    expect(describeAgentClient("codex-mcp-client")).toBe("Codex");
    expect(describeAgentClient("opencode/0.4")).toBe("OpenCode");
    expect(describeAgentClient("chouse-cli/1.0.0")).toBe("chouse CLI");
    expect(describeAgentClient("curl/8.5.0")).toBe("curl");
    expect(describeAgentClient("python-httpx/0.27.0")).toBe("Python client");
    expect(describeAgentClient("node")).toBe("Node.js client");
  });

  it("keeps the product token of an unknown client", () => {
    expect(describeAgentClient("acme-agent/3.1 (linux)")).toBe("acme-agent");
    expect(describeAgentClient("my bot")).toBe("my");
  });

  it("is null for nothing usable and for CHouse's own MCP subrequests", () => {
    expect(describeAgentClient(null)).toBeNull();
    expect(describeAgentClient("   ")).toBeNull();
    expect(describeAgentClient(INTERNAL_MCP_USER_AGENT)).toBeNull();
  });
});

describe("initializeClientName", () => {
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.0.14" } } };

  it("reads clientInfo.name from initialize, alone or in a batch", () => {
    expect(initializeClientName(init)).toBe("claude-code");
    expect(initializeClientName([{ jsonrpc: "2.0", method: "notifications/initialized" }, init])).toBe("claude-code");
  });

  it("ignores every other message", () => {
    expect(initializeClientName({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "query" } })).toBeNull();
    expect(initializeClientName({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).toBeNull();
    expect(initializeClientName(null)).toBeNull();
    expect(initializeClientName("initialize")).toBeNull();
  });
});
