/**
 * MCP resources (ADR 0013 §3): context reads keyed by URI, so agents can
 * reference entities without calling tools. Every read goes through the
 * projected API — same permissions, same data-access policies, same caps.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { McpDeps } from "./types";
import { toolContext, runApiTool } from "./tools/helpers";
import type { ToolExtra } from "./tools/helpers";

async function readResource(
  extra: ToolExtra,
  deps: McpDeps,
  resource: string,
  id: string,
  call: (api: ReturnType<McpDeps["clientFor"]>) => Promise<unknown>,
  uri: URL
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const ctx = toolContext(extra);
  const result = await runApiTool(ctx, deps.clientFor(ctx), resource, id, () =>
    call(deps.clientFor(ctx))
  );
  const text = (result.content[0] as { text: string }).text;
  return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
}

function lastSegment(uri: URL, indexFromEnd = 1): string {
  const parts = uri.pathname.split("/").filter((part) => part.length > 0);
  return decodeURIComponent(parts[parts.length - indexFromEnd] ?? "");
}

export function registerResources(mcp: McpServer, deps: McpDeps): void {
  mcp.registerResource(
    "connection",
    "chouse://connection/{id}",
    { title: "ClickHouse connection details", mimeType: "text/plain" },
    async (uri, extra) => {
      const id = lastSegment(uri);
      return readResource(extra, deps, "resource:connection", id, (api) =>
        api.request("GET", `/api/rbac/connections/${encodeURIComponent(id)}`)
      , uri);
    }
  );

  mcp.registerResource(
    "database",
    "chouse://database/{name}",
    { title: "Database tables (data-access filtered)", mimeType: "text/plain" },
    async (uri, extra) => {
      const name = lastSegment(uri);
      return readResource(extra, deps, "resource:database", name, (api) =>
        api.request("GET", "/api/explorer/databases")
      , uri);
    }
  );

  mcp.registerResource(
    "table",
    "chouse://table/{database}/{table}",
    { title: "Table schema and metadata", mimeType: "text/plain" },
    async (uri, extra) => {
      const table = lastSegment(uri, 1);
      const database = lastSegment(uri, 2);
      return readResource(extra, deps, "resource:table", `${database}.${table}`, (api) =>
        api.request("GET", `/api/explorer/table/${encodeURIComponent(database)}/${encodeURIComponent(table)}`)
      , uri);
    }
  );

  mcp.registerResource(
    "saved-query",
    "chouse://saved-query/{id}",
    { title: "Saved query definition", mimeType: "text/plain" },
    async (uri, extra) => {
      const id = lastSegment(uri);
      return readResource(extra, deps, "resource:saved-query", id, (api) =>
        api.request("GET", `/api/saved-queries/${encodeURIComponent(id)}`)
      , uri);
    }
  );

  mcp.registerResource(
    "scheduled-job",
    "chouse://scheduled-job/{id}",
    { title: "Scheduled query definition", mimeType: "text/plain" },
    async (uri, extra) => {
      const id = lastSegment(uri);
      return readResource(extra, deps, "resource:scheduled-job", id, (api) =>
        api.request("GET", `/api/scheduled-queries/${encodeURIComponent(id)}`)
      , uri);
    }
  );

  mcp.registerResource(
    "health-check",
    "chouse://health-check/{id}",
    { title: "Data-health check definition and incidents", mimeType: "text/plain" },
    async (uri, extra) => {
      const id = lastSegment(uri);
      return readResource(extra, deps, "resource:health-check", id, (api) =>
        api.request("GET", `/api/data-health/${encodeURIComponent(id)}`)
      , uri);
    }
  );

  mcp.registerResource(
    "doctor-report",
    "chouse://doctor-report/{id}",
    { title: "AI doctor report", mimeType: "text/plain" },
    async (uri, extra) => {
      const id = lastSegment(uri);
      return readResource(extra, deps, "resource:doctor-report", id, (api) =>
        api.request("GET", `/api/fleet/doctor/reports/${encodeURIComponent(id)}`)
      , uri);
    }
  );
}
