
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { errorHandler, notFoundHandler } from "./error";
import { AppError } from "../types";

describe("Error Middleware", () => {
    let mockContext: any;

    beforeEach(() => {
        mockContext = {
            json: mock(),
            req: {
                method: "GET",
                path: "/unknown"
            }
        };
    });

    describe("errorHandler", () => {
        it("should handle AppError", () => {
            const error = new AppError("Test error", "TEST_ERR", "validation", 400);
            errorHandler(error, mockContext);

            expect(mockContext.json).toHaveBeenCalledTimes(1);
            const [body, status] = mockContext.json.mock.calls[0];

            expect(status).toBe(400);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("TEST_ERR");
            expect(body.error.message).toBe("Test error");
        });

        it("should handle ZodError", () => {
            const error = {
                name: "ZodError",
                errors: [{ path: ["field"], message: "Invalid" }]
            } as any;

            errorHandler(error, mockContext);

            const [body, status] = mockContext.json.mock.calls[0];
            expect(status).toBe(400);
            expect(body.error.code).toBe("VALIDATION_ERROR");
            expect(body.error.details).toBeDefined();
        });

        it("should handle generic Error in production (masking)", () => {
            // Mock NODE_ENV production
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = "production";

            const error = new Error("Secret DB failed");
            errorHandler(error, mockContext);

            const [body, status] = mockContext.json.mock.calls[0];
            expect(status).toBe(500);
            expect(body.error.message).toBe("An unexpected error occurred");
            expect(body.error.message).not.toContain("Secret");

            process.env.NODE_ENV = originalEnv;
        });

        it("should show generic Error message in development", () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = "development";

            const error = new Error("Visible error");
            errorHandler(error, mockContext);

            const [body] = mockContext.json.mock.calls[0];
            expect(body.error.message).toBe("Visible error");

            process.env.NODE_ENV = originalEnv;
        });
    });

    describe("notFoundHandler", () => {
        it("should return 404", () => {
            notFoundHandler(mockContext);

            const [body, status] = mockContext.json.mock.calls[0];
            expect(status).toBe(404);
            expect(body.error.code).toBe("NOT_FOUND");
        });
    });
});
