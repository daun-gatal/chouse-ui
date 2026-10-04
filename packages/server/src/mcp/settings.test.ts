/**
 * MCP settings (ADR 0017): stored in obs_settings, safe defaults, per-tool
 * switches, and the Agents › MCP API that reads and writes them. Runs
 * against a real in-memory RBAC database.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase, rawAll, rawRun } from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import agents from "../routes/agents";
import {
  DEFAULT_MCP_SETTINGS,
  getMcpSettings,
  isToolEnabled,
  legacyMcpEnvKeys,
  resetMcpSettingsCache,
  saveMcpSettings,
  toolEnabledByDefault,
} from "./settings";

const USER = "mcp-settings-user";
let app: Hono;

async function token(permissions: string[]): Promise<string> {
  return generateAccessToken({ sub: USER, email: "m@test.local", username: "mcp", roles: ["custom"], permissions, sessionId: "s1" });
}

async function put(body: unknown): Promise<Response> {
  return app.request("/agents/mcp", {
    method: "PUT",
    headers: { Authorization: `Bearer ${await token(["agents:manage"])}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'm@test.local', 'mcp', 'x', 1, unixepoch(), unixepoch())`);
  app = new Hono();
  app.onError(errorHandler);
  app.route("/agents", agents);
});

beforeEach(async () => {
  await rawRun(sql`DELETE FROM obs_settings WHERE setting_key = 'mcp_settings'`);
  resetMcpSettingsCache();
});

afterAll(async () => {
  await closeDatabase();
});

describe("MCP settings store", () => {
  it("starts with the endpoint off and no overrides", async () => {
    expect(await getMcpSettings()).toEqual({ ...DEFAULT_MCP_SETTINGS, updatedBy: null, updatedAt: null });
  });

  it("saves a partial update and merges tool switches", async () => {
    await saveMcpSettings({ enabled: true, toolOverrides: { kill_query: true } }, USER);
    const saved = await saveMcpSettings({ toolOverrides: { audit_list: false } }, USER);
    expect(saved.enabled).toBe(true);
    expect(saved.toolOverrides).toEqual({ kill_query: true, audit_list: false });
    expect(saved.updatedBy).toBe(USER);
  });

  it("falls back to the defaults (endpoint off) when the stored document is corrupt", async () => {
    await rawRun(sql`INSERT INTO obs_settings (setting_key, value, updated_by, updated_at) VALUES ('mcp_settings', '{not json', NULL, 1)`);
    expect((await getMcpSettings()).enabled).toBe(false);
  });

  it("rejects an out-of-range timeout", async () => {
    await expect(saveMcpSettings({ timeoutSeconds: 0 }, USER)).rejects.toThrow();
  });
});

describe("tool defaults", () => {
  it("turns on reads and keeps writes, destructive and LLM-spending tools off", () => {
    expect(toolEnabledByDefault({ access: "read" })).toBe(true);
    expect(toolEnabledByDefault({ access: "read", spendsLlm: true })).toBe(false);
    expect(toolEnabledByDefault({ access: "write" })).toBe(false);
    expect(toolEnabledByDefault({ access: "destructive" })).toBe(false);
  });

  it("lets an override win over the default", () => {
    expect(isToolEnabled({ toolOverrides: { kill_query: true } }, { name: "kill_query", access: "destructive" })).toBe(true);
    expect(isToolEnabled({ toolOverrides: { query: false } }, { name: "query", access: "read" })).toBe(false);
  });
});

describe("legacy env", () => {
  it("reports the MCP_* keys that are set", () => {
    expect(legacyMcpEnvKeys({ MCP_ENABLED: "true", MCP_PORT: "8752", OTHER: "x", MCP_TOOLSETS: "" })).toEqual(["MCP_ENABLED", "MCP_PORT"]);
  });
});

describe("GET/PUT /agents/mcp", () => {
  it("returns the settings, the endpoint path and the tool catalog", async () => {
    const res = await app.request("/agents/mcp", { headers: { Authorization: `Bearer ${await token(["agents:view"])}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { settings: { enabled: boolean }; endpoint: { path: string }; tools: Array<{ name: string; enabled: boolean; access: string }> } };
    expect(body.data.settings.enabled).toBe(false);
    expect(body.data.endpoint.path).toBe("/mcp");
    const kill = body.data.tools.find((tool) => tool.name === "kill_query");
    expect(kill).toMatchObject({ access: "destructive", enabled: false });
  });

  it("turns MCP on, switches a tool and audits the change", async () => {
    const res = await put({ enabled: true, toolOverrides: { kill_query: true } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { settings: { enabled: boolean }; tools: Array<{ name: string; enabled: boolean }> } };
    expect(body.data.settings.enabled).toBe(true);
    expect(body.data.tools.find((tool) => tool.name === "kill_query")?.enabled).toBe(true);
    const audit = await rawAll(sql`SELECT action FROM rbac_audit_logs WHERE action = 'agent.mcp_update'`);
    expect(audit.length).toBeGreaterThan(0);
  });

  it("refuses unknown tools and unknown fields", async () => {
    expect((await put({ toolOverrides: { not_a_tool: true } })).status).toBe(400);
    expect((await put({ toolsets: ["core"] })).status).toBe(400);
  });

  it("refuses an invalid origin", async () => {
    expect((await put({ allowedOrigins: ["not a url"] })).status).toBe(400);
  });
});
