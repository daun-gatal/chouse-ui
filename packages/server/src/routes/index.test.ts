
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";

// Mock sub-routes to avoid dependency issues
const mockConfig = new Hono();
mockConfig.get("/", (c) => c.text("config"));

const mockQuery = new Hono();
const mockExplorer = new Hono();
const mockMetrics = new Hono();
const mockSavedQueries = new Hono();
const mockRbac = new Hono();

mock.module("./config", () => config);
mock.module("./query", () => mockQuery);
mock.module("./explorer", () => mockExplorer);
mock.module("./metrics", () => mockMetrics);
mock.module("./saved-queries", () => mockSavedQueries);
mock.module("../rbac", () => ({ rbacRoutes: mockRbac }));

// Import AFTER mocking
import api from "./index";
import config from "./config"; // Import config to mock it correctly

describe("Server Index (API Protection)", () => {
    // We need to simulate the mounting at /api to test the middleware paths correctly
    // or we just acknowledge that the middleware checks full paths.

    it("should allow public path /api/health without header", async () => {
        // Because apiProtectionMiddleware checks /api/health specifically
        // We need to ensure c.req.path is /api/health
        // But api.get('/health') expects /health
        // This mismatch usually implies api is mounted at /api.
        // To test this in isolation, we can mount api at /api in a test app

        const mainApp = new Hono();
        mainApp.route("/api", api);

        const res = await mainApp.request("/api/health");
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.status).toBe("healthy");
    });

    it("should allow /api/config without header", async () => {
        const mainApp = new Hono();
        mainApp.route("/api", api);

        // Mock config route behavior for this test
        // Original config route returns json, but we mocked the module?
        // Wait, I imported 'config' from './config'. If I mocked it, it should use the mock.
        // But in bun:test, 'mock.module' mocks ES modules.

        const res = await mainApp.request("/api/config");
        // Check if status is 200 (allowed) vs 403
        expect(res.status).not.toBe(403);
    });

    it("should block direct access to protected routes", async () => {
        const mainApp = new Hono();
        mainApp.route("/api", api);

        // Add a dummy protected route to api for testing
        api.get("/protected", (c) => c.text("protected"));

        const res = await mainApp.request("/api/protected");
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.code).toBe("DIRECT_ACCESS_DENIED");
    });

    it("should allow access with X-Requested-With header", async () => {
        const mainApp = new Hono();
        api.get("/protected-ok", (c) => c.text("ok"));
        mainApp.route("/api", api);

        const res = await mainApp.request("/api/protected-ok", {
            headers: { "X-Requested-With": "XMLHttpRequest" }
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("ok");
    });
});
