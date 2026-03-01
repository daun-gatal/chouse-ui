import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { AppError } from "../types";
import { requestId } from "./requestId";
import { ZodError } from "zod";

const mockError = vi.fn();
const mockWarn = vi.fn();
vi.mock("../utils/logger", () => ({
  requestLogger: () => ({ error: mockError, warn: mockWarn }),
}));

const { errorHandler } = await import("./error");

describe("Error Handler Middleware", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        // Simplified request ID for testing
        app.use("*", async (c, next) => {
            c.set('requestId', 'test-req-id');
            await next();
        });
        // Register error handler
        app.onError(errorHandler);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("should handle AppError correctly", async () => {
        app.get("/error", () => {
            throw AppError.badRequest("Bad Request Test");
        });

        const res = await app.request("/error");
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data).toEqual({
            success: false,
            error: {
                id: 'test-req-id',
                code: "BAD_REQUEST",
                message: "Bad Request Test",
                category: "validation",
                details: undefined,
                stack: undefined, // Stack hidden by default in test env (unless explicitly enabled)
            },
        });
    });

    it("should handle ZodError correctly", async () => {
        app.get("/zod", () => {
            throw new ZodError([{
                code: "invalid_type",
                expected: "string",
                received: "number",
                path: ["username"],
                message: "Expected string, received number"
            }]);
        });

        const res = await app.request("/zod");
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error.code).toBe("VALIDATION_ERROR");
        expect(data.error.category).toBe("validation");
        expect(data.error.details).toHaveLength(1);
        expect(data.error.details[0].path).toEqual(["username"]);
    });

    it("should handle generic Error as Internal Server Error", async () => {
        app.get("/crash", () => {
            throw new Error("Something blew up");
        });

        const res = await app.request("/crash");
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error.code).toBe("INTERNAL_ERROR");
        expect(mockError).toHaveBeenCalled();
    });

    it("should suppress 404 logs loudness", async () => {
        app.get("/not-found", () => {
            throw AppError.notFound("Resource missing");
        });

        const res = await app.request("/not-found");

        expect(res.status).toBe(404);
        expect(mockWarn).toHaveBeenCalled();
        expect(mockError).not.toHaveBeenCalled();
    });

    it("should mask internal details in production", async () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";

        try {
            app.get("/prod-crash", () => {
                throw new Error("Secret database details");
            });

            const res = await app.request("/prod-crash");
            const data = await res.json();

            expect(res.status).toBe(500);
            expect(data.error.message).toBe("An unexpected error occurred");
            expect(data.error.stack).toBeUndefined();
            expect(mockError).toHaveBeenCalled();
        } finally {
            process.env.NODE_ENV = originalEnv;
        }
    });
});
