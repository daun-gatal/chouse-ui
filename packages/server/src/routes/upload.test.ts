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
let permissions: string[] = ["table:insert"];
const mockCheckTableAccess = mock(async () => true);

mock.module("../rbac/middleware/rbacAuth", () => ({
    rbacAuthMiddleware: async (c: any, next: any) => {
        if (!authorized) {
            const { AppError } = await import("../types");
            throw AppError.unauthorized("No authentication token provided");
        }
        await next();
    },
}));

mock.module("../middleware/dataAccess", () => ({
    checkTableAccess: mockCheckTableAccess,
}));

mock.module("../middleware/connectionContext", () => ({
    CONNECTION_ID_HEADER: "X-Connection-Id",
    CONNECTION_ID_COOKIE: "ch_connection",
    connectionContextMiddleware: async (c: any, next: any) => {
        if (!authorized) {
            const { AppError } = await import("../types");
            throw AppError.unauthorized("RBAC authentication is required.");
        }
        c.set("service", { insertStream: mockInsertStream });
        c.set("rbacUserId", "user-1");
        c.set("rbacPermissions", permissions);
        c.set("isRbacAdmin", false);
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
        mockCheckTableAccess.mockReset();
        mockCheckTableAccess.mockResolvedValue(true);
        authorized = true;
        permissions = ["table:insert"];
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

        it("requires a signed-in user", async () => {
            authorized = false;
            const formData = new FormData();
            formData.append("file", new File(["id\n1"], "t.csv", { type: "text/csv" }));

            const res = await app.request("/upload/preview", { method: "POST", body: formData });

            expect(res.status).toBe(401);
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

        const post = (query: string) => app.request(`/upload/create?${query}`, {
            method: "POST",
            headers: { "X-Connection-Id": "conn-1" },
            body: "csv,data\n1,2",
        });

        it("requires the table:insert permission", async () => {
            permissions = ["table:select"];
            const res = await post("database=default&table=test");
            expect(res.status).toBe(403);
            expect(mockInsertStream).not.toHaveBeenCalled();
        });

        it("applies data access rules to the target table", async () => {
            mockCheckTableAccess.mockResolvedValue(false);
            const res = await post("database=secret&table=t");
            expect(res.status).toBe(403);
            expect(mockCheckTableAccess).toHaveBeenCalledWith("user-1", false, "secret", "t", undefined, "write");
            expect(mockInsertStream).not.toHaveBeenCalled();
        });

        it("rejects formats the import wizard doesn't send", async () => {
            const res = await post("database=default&table=test&format=Native");
            expect(res.status).toBe(400);
            expect(mockInsertStream).not.toHaveBeenCalled();
        });
    });
});
