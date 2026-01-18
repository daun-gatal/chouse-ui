
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import configRoute from "./config";

describe("Config Route", () => {
    let app: Hono;
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
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
    });

    it("should parse preset URLs and other env vars", async () => {
        process.env.CLICKHOUSE_PRESET_URLS = "http://localhost:8123, http://example.com:8123";
        process.env.CLICKHOUSE_DEFAULT_URL = "http://localhost:8123";
        process.env.CLICKHOUSE_DEFAULT_USER = "admin";
        process.env.VERSION = "1.0.0";

        const res = await app.request("/config");
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.data.clickhouse.presetUrls).toEqual(["http://localhost:8123", "http://example.com:8123"]);
        expect(body.data.clickhouse.defaultUrl).toBe("http://localhost:8123");
        expect(body.data.clickhouse.defaultUser).toBe("admin");
        expect(body.data.app.version).toBe("1.0.0");
    });
});
