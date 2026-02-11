import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import upload from "./upload";
import { errorHandler } from "../middleware/error";

// Mock dependencies
const mockInsertStream = mock(() => Promise.resolve({ queryId: "test-id" }));
const mockGetSession = mock(() => ({
    service: {
        insertStream: mockInsertStream
    }
}));

mock.module("../services/clickhouse", () => ({
    getSession: mockGetSession
}));

describe("Upload Routes", () => {
    // Setup Hono app for testing
    const app = new Hono();
    app.onError(errorHandler);
    app.route("/upload", upload);

    beforeEach(() => {
        mockInsertStream.mockClear();
        mockGetSession.mockClear();
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
                    "x-clickhouse-session-id": "valid-session"
                },
                body: "csv,data\n1,2"
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.queryId).toBe("test-id");

            expect(mockGetSession).toHaveBeenCalledWith("valid-session");
            expect(mockInsertStream).toHaveBeenCalled();
        });

        it("should return 400 for missing params", async () => {
            const res = await app.request("/upload/create", { // Missing params
                method: "POST",
                headers: {
                    "x-clickhouse-session-id": "valid-session"
                },
                body: "data"
            });

            expect(res.status).toBe(400);
        });

        it("should return 401 if unauthorized", async () => {
            mockGetSession.mockImplementationOnce(() => undefined as any); // Invalid session

            const res = await app.request("/upload/create?database=default&table=test", {
                method: "POST",
                headers: {
                    "x-clickhouse-session-id": "invalid-session"
                },
                body: "data"
            });

            expect(res.status).toBe(401);
        });
    });
});
