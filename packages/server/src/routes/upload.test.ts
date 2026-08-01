import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error";

// Mock dependencies.
//
// ADR 0010: the route no longer looks a session up in a pod-local map — it takes
// its ClickHouseService from the shared connection-context middleware, so that
// is what the tests stub.
const mockInsertStream = mock(() => Promise.resolve({ queryId: "test-id" }));
let authorized = true;

mock.module("../middleware/connectionContext", () => ({
    CONNECTION_ID_HEADER: "X-Connection-Id",
    CONNECTION_ID_COOKIE: "ch_connection",
    connectionContextMiddleware: async (c: any, next: any) => {
        if (!authorized) {
            const { AppError } = await import("../types");
            throw AppError.unauthorized("RBAC authentication is required.");
        }
        c.set("service", { insertStream: mockInsertStream });
        await next();
    },
}));

// Imported AFTER mock.module so the route picks up the stubbed middleware.
const upload = (await import("./upload")).default;

describe("Upload Routes", () => {
    // Setup Hono app for testing
    const app = new Hono();
    app.onError(errorHandler);
    app.route("/upload", upload);

    beforeEach(() => {
        mockInsertStream.mockClear();
        authorized = true;
    });

    describe("POST /preview", () => {
        it("should return inferred schema for valid CSV", async () => {
            const formData = new FormData();
            const file = new File(["id,name\n1,Test"], "test.csv", { type: "text/csv" });
            formData.append("file", file);

            const res = await app.request("/upload/preview", {
                method: "POST",
                body: formData,
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.columns).toHaveLength(2);
            expect(json.data.columns[0].name).toBe("id");
            expect(json.data.columns[0].type).toBe("Int64");
            expect(json.data.preview).toHaveLength(1);
        });

        it("should return 400 if no file provided", async () => {
            const formData = new FormData();
            // No file appended

            const res = await app.request("/upload/preview", {
                method: "POST",
                body: formData,
            });

            expect(res.status).toBe(400);
        });
    });

    describe("POST /create", () => {
        it("should call insertStream and return queryId", async () => {
            const res = await app.request("/upload/create?database=default&table=test", {
                method: "POST",
                headers: {
                    "X-Connection-Id": "conn-1"
                },
                body: "csv,data\n1,2"
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.queryId).toBe("test-id");

            expect(mockInsertStream).toHaveBeenCalled();
        });

        it("should return 400 for missing params", async () => {
            const res = await app.request("/upload/create", { // Missing params
                method: "POST",
                headers: {
                    "X-Connection-Id": "conn-1"
                },
                body: "data"
            });

            expect(res.status).toBe(400);
        });

        it("should return 401 if unauthorized", async () => {
            authorized = false;

            const res = await app.request("/upload/create?database=default&table=test", {
                method: "POST",
                headers: {
                    "X-Connection-Id": "conn-1"
                },
                body: "data"
            });

            expect(res.status).toBe(401);
        });
    });
});
