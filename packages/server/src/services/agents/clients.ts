/**
 * Agent client identity (ADR 0016 §10). MCP runs stateless, so the client's
 * own name (`clientInfo` in `initialize`) arrives once and later calls only
 * carry a User-Agent. Both are normalized to one friendly name so a session
 * shows the same origin however it was first seen.
 */

/** The User-Agent the MCP server uses for its own API subrequests; never the real client. */
export const INTERNAL_MCP_USER_AGENT = "chouse-mcp/1";

/** Forwarded on MCP subrequests so governed endpoints record the real client. */
export const AGENT_CLIENT_HEADER = "X-Chouse-Agent-Client";

const KNOWN_CLIENTS: Array<[RegExp, string]> = [
  [/claude[-_ ]?code/i, "Claude Code"],
  [/claude[-_ ]?desktop|claude-ai|anthropic/i, "Claude"],
  [/cursor/i, "Cursor"],
  [/codex/i, "Codex"],
  [/opencode/i, "OpenCode"],
  [/windsurf|codeium/i, "Windsurf"],
  [/visual studio code|vscode|copilot/i, "VS Code"],
  [/zed/i, "Zed"],
  [/goose/i, "Goose"],
  [/chouse-cli/i, "chouse CLI"],
  [/mcp-inspector|inspector/i, "MCP Inspector"],
  [/^curl\//i, "curl"],
  [/python-httpx|python-requests|aiohttp|python/i, "Python client"],
  [/^node|undici|axios|node-fetch/i, "Node.js client"],
  [/^go-http-client/i, "Go client"],
];

const MAX_LENGTH = 80;

/**
 * Friendly client name from MCP `clientInfo.name` or a User-Agent. Unknown
 * clients keep their first product token (`foo-agent/1.2 (x)` → `foo-agent`).
 * Null when there is nothing usable, including our own internal agent.
 */
export function describeAgentClient(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || value === INTERNAL_MCP_USER_AGENT) return null;
  for (const [pattern, name] of KNOWN_CLIENTS) if (pattern.test(value)) return name;
  const product = value.split(/[\s(]/)[0].split("/")[0].trim();
  return (product || value).slice(0, MAX_LENGTH);
}

/** `clientInfo.name` from an MCP JSON-RPC `initialize` message (or a batch containing one). */
export function initializeClientName(body: unknown): string | null {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (!("method" in message) || message.method !== "initialize" || !("params" in message)) continue;
    const params = message.params;
    if (!params || typeof params !== "object" || !("clientInfo" in params)) continue;
    const info = params.clientInfo;
    if (info && typeof info === "object" && "name" in info && typeof info.name === "string") return info.name;
  }
  return null;
}
