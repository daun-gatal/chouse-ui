/**
 * AI Governance › MCP helpers: the endpoint URL, ready-to-paste client configs, and
 * catalog grouping/filtering. Snippets read the token from the
 * `CH_HOUSE_PAT` environment variable (or the client's secret prompt) so a
 * token never lands in a config file.
 */

import type { McpTool, McpToolAccess, McpToolCategory } from "@/api/agents";

export const MCP_TOKEN_ENV = "CH_HOUSE_PAT";

export const MCP_CATEGORY_LABELS: Record<McpToolCategory, string> = {
  identity: "Identity & connections",
  explore: "Explore",
  query: "Query",
  monitoring: "Monitoring",
  scheduling: "Scheduled queries",
  data_health: "Data health",
  data_observability: "Data observability",
  performance: "Performance, capacity & upgrades",
  dashboards: "Dashboards",
  ai: "Chouse AI",
  ai_governance: "AI governance",
  access: "Access",
};

export const MCP_CATEGORY_ORDER: McpToolCategory[] = [
  "identity",
  "explore",
  "query",
  "data_observability",
  "data_health",
  "performance",
  "dashboards",
  "monitoring",
  "scheduling",
  "ai",
  "ai_governance",
  "access",
];

export const MCP_ACCESS_LABELS: Record<McpToolAccess, string> = {
  read: "Read",
  write: "Write",
  destructive: "Destructive",
};

export type McpEndpointSource = "settings" | "env" | "page";

export interface ResolvedMcpEndpoint {
  url: string;
  source: McpEndpointSource;
  /** Only this machine can reach it (localhost, 127.0.0.0/8, ::1). */
  local: boolean;
}

/** True for hosts no other machine can reach. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host) || host === "0.0.0.0";
}

/**
 * The endpoint agents connect to: the public address set in AI Governance › MCP,
 * else the server's PUBLIC_BASE_URL, else this page's origin plus the app's
 * base path — right whenever people and agents use the same address (the
 * usual Ingress setup).
 */
export function mcpEndpointUrl(
  endpoint: { path: string; url: string | null; source?: "settings" | "env" | null },
  origin: string,
  basePath: string,
): ResolvedMcpEndpoint {
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const url = endpoint.url ?? `${origin}${base}${endpoint.path}`;
  const source: McpEndpointSource = endpoint.url ? (endpoint.source ?? "env") : "page";
  let local = false;
  try {
    local = isLocalHost(new URL(url).hostname);
  } catch {
    local = false;
  }
  return { url, source, local };
}

export const MCP_ENDPOINT_SOURCE_LABELS: Record<McpEndpointSource, string> = {
  settings: "Set below as the public address",
  env: "From the server's PUBLIC_BASE_URL",
  page: "From the address you opened this page on",
};

/**
 * Parse the public address box: empty clears it; otherwise a bare http(s)
 * address (an optional base path is kept), without a trailing slash.
 */
export function parsePublicUrl(text: string): { value: string | null } | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "Use an http:// or https:// address." };
    if (url.search || url.hash) return { error: "Leave out the query and fragment." };
    return { value: `${url.origin}${url.pathname}`.replace(/\/+$/, "") };
  } catch {
    return { error: "Enter a full address, e.g. https://chouse.example.com" };
  }
}

type McpClientId = "claude-code" | "codex" | "cursor" | "vscode" | "opencode" | "curl";

export interface McpClientSnippet {
  id: McpClientId;
  label: string;
  /** Where the snippet goes. */
  target: string;
  language: "bash" | "json";
  code: string;
}

/** Ready-to-paste setup for each supported client. */
export function mcpClientSnippets(url: string): McpClientSnippet[] {
  const env = MCP_TOKEN_ENV;
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      target: "Terminal (add --scope user for every project)",
      language: "bash",
      code: `claude mcp add --transport http chouse ${url} \\\n  --header "Authorization: Bearer $${env}"`,
    },
    {
      id: "codex",
      label: "Codex CLI",
      target: "Terminal",
      language: "bash",
      code: `codex mcp add chouse --url ${url} --bearer-token-env-var ${env}`,
    },
    {
      id: "cursor",
      label: "Cursor",
      target: ".cursor/mcp.json",
      language: "json",
      code: JSON.stringify(
        { mcpServers: { chouse: { url, headers: { Authorization: `Bearer \${env:${env}}` } } } },
        null,
        2,
      ),
    },
    {
      id: "vscode",
      label: "VS Code",
      target: ".vscode/mcp.json",
      language: "json",
      code: JSON.stringify(
        {
          servers: { chouse: { type: "http", url, headers: { Authorization: "Bearer ${input:chouse_pat}" } } },
          inputs: [{ id: "chouse_pat", type: "promptString", description: "CHouse UI personal access token", password: true }],
        },
        null,
        2,
      ),
    },
    {
      id: "opencode",
      label: "OpenCode",
      target: "opencode.json",
      language: "json",
      code: JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            chouse: { type: "remote", url, enabled: true, oauth: false, headers: { Authorization: `Bearer {env:${env}}` }, timeout: 60000 },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "curl",
      label: "curl",
      target: "Smoke test: lists the tools your token gets",
      language: "bash",
      code: [
        `curl -s ${url} \\`,
        `  -H "Authorization: Bearer $${env}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "Accept: application/json, text/event-stream" \\`,
        `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
      ].join("\n"),
    },
  ];
}

export interface McpSignInSnippet {
  /** Where the snippet goes. */
  target: string;
  language: "bash" | "json";
  code: string;
  /** What to do after adding it, so the client opens the browser to sign in. */
  then: string;
}

/**
 * Setup for each client when agents sign in with OAuth (ADR 0028): the same
 * server entry without a token; the client opens CHouse in the browser to
 * sign in. curl has no browser, so it gets a check of what agents discover.
 */
export function mcpSignInSnippets(url: string): Record<McpClientId, McpSignInSnippet> {
  const metadata = (() => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}/.well-known/oauth-protected-resource${parsed.pathname}`;
    } catch {
      return `${url}/.well-known/oauth-protected-resource`;
    }
  })();
  return {
    "claude-code": {
      target: "Terminal (add --scope user for every project)",
      language: "bash",
      code: `claude mcp add --transport http chouse ${url}`,
      then: "Then run /mcp in Claude Code, pick chouse and choose Authenticate.",
    },
    codex: {
      target: "Terminal",
      language: "bash",
      code: `codex mcp add chouse --url ${url}
codex mcp login chouse`,
      then: "The login command opens the browser to sign in.",
    },
    cursor: {
      target: ".cursor/mcp.json",
      language: "json",
      code: JSON.stringify({ mcpServers: { chouse: { url } } }, null, 2),
      then: "Then open Cursor Settings › MCP and choose Connect (or Needs login) next to chouse.",
    },
    vscode: {
      target: ".vscode/mcp.json",
      language: "json",
      code: JSON.stringify({ servers: { chouse: { type: "http", url } } }, null, 2),
      then: "Then start the chouse server from the file or the MCP view; VS Code asks to sign in.",
    },
    opencode: {
      target: "opencode.json",
      language: "json",
      code: JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { chouse: { type: "remote", url, enabled: true, timeout: 60000 } } }, null, 2),
      then: "Then run opencode mcp auth chouse, or use the server and OpenCode opens the browser itself.",
    },
    curl: {
      target: "Check what agents discover (curl can't sign in: use a token for scripts)",
      language: "bash",
      code: [
        `curl -si ${url} -X POST -H "Content-Type: application/json" -d '{}' | grep -i www-authenticate`,
        `curl -s ${metadata}`,
      ].join("\n"),
      then: "The first line should name the resource metadata; the second shows where agents sign in.",
    },
  };
}

export interface McpToolFilter {
  search: string;
  access: McpToolAccess | "all";
  state: "all" | "enabled" | "disabled";
}

export function filterMcpTools(tools: McpTool[], filter: McpToolFilter): McpTool[] {
  const needle = filter.search.trim().toLowerCase();
  return tools.filter((tool) => {
    if (filter.access !== "all" && tool.access !== filter.access) return false;
    if (filter.state === "enabled" && !tool.enabled) return false;
    if (filter.state === "disabled" && tool.enabled) return false;
    if (!needle) return true;
    return [tool.name, tool.title, tool.description, ...tool.permissions].some((text) => text.toLowerCase().includes(needle));
  });
}

/** Tools grouped by category in display order; empty categories are left out. */
export function groupMcpTools(tools: McpTool[]): Array<{ category: McpToolCategory; label: string; tools: McpTool[] }> {
  return MCP_CATEGORY_ORDER.map((category) => ({
    category,
    label: MCP_CATEGORY_LABELS[category],
    tools: tools.filter((tool) => tool.category === category),
  })).filter((group) => group.tools.length > 0);
}

/** Overrides that set every given tool to `enabled`. */
export function bulkToolOverrides(tools: McpTool[], enabled: boolean): Record<string, boolean> {
  return Object.fromEntries(tools.map((tool) => [tool.name, enabled]));
}

/** Overrides that put every tool back to its default state. */
export function defaultToolOverrides(tools: McpTool[]): Record<string, boolean> {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool.enabledByDefault]));
}

/** Parse the allowed-origins text box: one origin per line or comma-separated. */
export function parseOrigins(text: string): { origins: string[]; invalid: string[] } {
  const entries = text.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    try {
      const url = new URL(entry);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.origin === entry.replace(/\/$/, "")) {
        if (!origins.includes(url.origin)) origins.push(url.origin);
      } else {
        invalid.push(entry);
      }
    } catch {
      invalid.push(entry);
    }
  }
  return { origins, invalid };
}

/** A host an agent may return to after sign-in: `example.com` or `*.example.com` (ADR 0028). */
const REDIRECT_HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Split the allowed-hosts box into hosts (lowercased, deduplicated) and entries that aren't hosts. */
export function parseRedirectHosts(text: string): { hosts: string[]; invalid: string[] } {
  const hosts: string[] = [];
  const invalid: string[] = [];
  for (const entry of text.split(/[\s,]+/).map((part) => part.trim().toLowerCase()).filter(Boolean)) {
    if (REDIRECT_HOST.test(entry)) {
      if (!hosts.includes(entry)) hosts.push(entry);
    } else {
      invalid.push(entry);
    }
  }
  return { hosts, invalid };
}

/** How long an agent's access may last at most (ADR 0028). */
export const OAUTH_MAX_DAY_OPTIONS = [7, 30, 90, 180, 365] as const;

/** How agents may connect to MCP, from the sign-in settings (ADR 0028). */
export type McpConnectMode = "tokens" | "both" | "sign-in";

/** Tokens only while sign-in is off or has no usable address; otherwise what "How agents connect" says. */
export function mcpConnectMode(settings: { oauthEnabled: boolean; oauthPatsAllowed: boolean }, issuer: string | null): McpConnectMode {
  if (!settings.oauthEnabled || !issuer) return "tokens";
  return settings.oauthPatsAllowed ? "both" : "sign-in";
}
