
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Hono } from "hono";

// Control whether isAIEnabled() returns true or false per test
let _mockAiEnabled = false;

mock.module("../services/aiConfig", () => ({
  isAIEnabled: async () => _mockAiEnabled,
}));

// The Agents › MCP switch (ADR 0017): null makes the settings read fail.
let _mockMcpEnabled: boolean | null = false;

mock.module("../mcp/settings", () => ({
  getMcpSettings: async () => {
    if (_mockMcpEnabled === null) throw new Error("RBAC database not ready");
    return { enabled: _mockMcpEnabled };
  },
}));

import configRoute from "./config";

describe("Config Route", () => {
    let app: Hono;
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        _mockAiEnabled = false;
        _mockMcpEnabled = false;
        app = new Hono();
        app.route("/config", configRoute);
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it("should return default config when env vars are empty", async () => {
        delete process.env.CLICKHOUSE_PRESET_URLS;
        delete process.env.CLICKHOUSE_DEFAULT_URL;
        delete process.env.CLICKHOUSE_DEFAULT_USER;
        delete process.env.VERSION;

        const res = await app.request("/config");
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.data.clickhouse.presetUrls).toEqual([]);
        expect(body.data.clickhouse.defaultUrl).toBe("");
        expect(body.data.clickhouse.defaultUser).toBe("default");
        expect(body.data.app.version).toBe("dev");
        expect(body.data.features.aiOptimizer).toBe(false);
    });

    it("should parse preset URLs and other env vars", async () => {
        process.env.CLICKHOUSE_PRESET_URLS = "http://localhost:8123, http://example.com:8123";
        process.env.CLICKHOUSE_DEFAULT_URL = "http://localhost:8123";
        process.env.CLICKHOUSE_DEFAULT_USER = "admin";
        process.env.VERSION = "1.0.0";
        _mockAiEnabled = true;

        const res = await app.request("/config");
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.data.clickhouse.presetUrls).toEqual(["http://localhost:8123", "http://example.com:8123"]);
        expect(body.data.clickhouse.defaultUrl).toBe("http://localhost:8123");
        expect(body.data.clickhouse.defaultUser).toBe("admin");
        expect(body.data.app.version).toBe("1.0.0");
        expect(body.data.features.aiOptimizer).toBe(true);
    });

    it("reports mcpEnabled from the Agents › MCP setting", async () => {
        _mockMcpEnabled = true;

        const res = await app.request("/config");
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.data.features.mcpEnabled).toBe(true);
    });

    it("ignores the removed MCP_ENABLED env var", async () => {
        process.env.MCP_ENABLED = "true";

        const res = await app.request("/config");
        const body = await res.json();

        expect(body.data.features.mcpEnabled).toBe(false);
    });

    it("reports mcpEnabled false when the setting cannot be read", async () => {
        _mockMcpEnabled = null;

        const res = await app.request("/config");
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.data.features.mcpEnabled).toBe(false);
    });
});
