/**
 * MCP server configuration (ADR 0013).
 *
 * All knobs come from `MCP_*` environment variables, which the existing
 * config-loader flattens from CHOUSE_CONFIG_PATH YAML 1:1 (`mcp.enabled` ->
 * MCP_ENABLED). The write policy is deliberately server-side: an agent can
 * never opt into writes, only an operator can.
 */

export const MCP_TOOLSETS = [
  "core",
  "explore",
  "query",
  "observe",
  "ops",
  "writes",
  "destructive",
  "ai",
] as const;
export type McpToolset = (typeof MCP_TOOLSETS)[number];

export const DEFAULT_TOOLSETS: McpToolset[] = ["core", "explore", "query", "observe", "ops"];

export const MCP_DEFAULT_PORT = 8752;
export const MCP_DEFAULT_TIMEOUT_SECONDS = 60;
export const MCP_TIMEOUT_MIN_SECONDS = 1;
export const MCP_TIMEOUT_MAX_SECONDS = 600;

export interface McpConfig {
  enabled: boolean;
  host: string;
  port: number;
  allowWrites: boolean;
  allowDestructive: boolean;
  toolsets: McpToolset[];
  allowedOrigins: string[];
  timeoutSeconds: number;
}

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return TRUTHY.has(value.trim().toLowerCase());
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function clampTimeout(seconds: number): number {
  if (!Number.isFinite(seconds)) return MCP_DEFAULT_TIMEOUT_SECONDS;
  return Math.min(MCP_TIMEOUT_MAX_SECONDS, Math.max(MCP_TIMEOUT_MIN_SECONDS, seconds));
}

export interface McpConfigResult {
  config?: McpConfig;
  errors: string[];
}

/**
 * Parse and validate the MCP_* environment. Returns every error at once so a
 * broken configuration fails startup with a complete explanation rather than
 * the first problem found.
 */
export function loadMcpConfig(
  env: Record<string, string | undefined> = process.env
): McpConfigResult {
  const errors: string[] = [];

  const enabled = parseBool(env.MCP_ENABLED, env.NODE_ENV !== "production");

  const port = Number.parseInt(env.MCP_PORT ?? String(MCP_DEFAULT_PORT), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`MCP_PORT must be an integer between 1 and 65535 (got ${env.MCP_PORT ?? "unset"})`);
  }

  const toolsetsRaw = env.MCP_TOOLSETS
    ? parseCsv(env.MCP_TOOLSETS)
    : DEFAULT_TOOLSETS;
  const known = new Set<string>(MCP_TOOLSETS);
  const unknown = toolsetsRaw.filter((toolset) => !known.has(toolset));
  if (unknown.length > 0) {
    errors.push(
      `MCP_TOOLSETS contains unknown toolset(s): ${unknown.join(", ")} (known: ${MCP_TOOLSETS.join(", ")})`
    );
  }

  const allowWrites = parseBool(env.MCP_ALLOW_WRITES, false);
  const allowDestructive = parseBool(env.MCP_ALLOW_DESTRUCTIVE, false);
  if (allowDestructive && !allowWrites) {
    errors.push("MCP_ALLOW_DESTRUCTIVE=true requires MCP_ALLOW_WRITES=true");
  }

  const timeoutSeconds = clampTimeout(Number.parseInt(env.MCP_TIMEOUT_SECONDS ?? String(MCP_DEFAULT_TIMEOUT_SECONDS), 10));
  if (Number.isNaN(timeoutSeconds)) {
    errors.push(`MCP_TIMEOUT_SECONDS must be an integer (got ${env.MCP_TIMEOUT_SECONDS ?? "unset"})`);
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    errors,
    config: {
      enabled,
      // Production binds all interfaces like the web port does (an operator
      // who sets MCP_ENABLED=true intends the endpoint to be reachable —
      // exposure is the Service/ingress's job). Development stays on
      // localhost for the dev-only convenience default.
      host: env.MCP_HOST?.trim() || (env.NODE_ENV === "production" ? "0.0.0.0" : "localhost"),
      port,
      allowWrites,
      allowDestructive,
      toolsets: toolsetsRaw as McpToolset[],
      allowedOrigins: parseCsv(env.MCP_ALLOWED_ORIGINS),
      timeoutSeconds,
    },
  };
}
