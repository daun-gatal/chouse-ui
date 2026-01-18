import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock JWT Service to support real middleware
let mockTokenPayload = {
    sub: 'user1',
    roles: ['admin'],
    permissions: [
        "saved_queries:view",
        "saved_queries:create",
        "saved_queries:update",
        "saved_queries:delete"
    ],
    sessionId: 'sess-1'
};

mock.module("../services/jwt", () => ({
    verifyAccessToken: mock(async () => mockTokenPayload),
    extractTokenFromHeader: mock((h) => h ? "valid_token" : null),
    verifyRefreshToken: mock(async () => mockTokenPayload)
}));

// Mock Dependencies
const mockGetSavedQueries = mock();
const mockGetSavedQueryById = mock();
const mockCreateSavedQuery = mock();
const mockUpdateSavedQuery = mock();
const mockDeleteSavedQuery = mock();
const mockGetQueryConnectionNames = mock();

mock.module("../rbac/services/savedQueries", () => ({
    getSavedQueries: mockGetSavedQueries,
    getSavedQueryById: mockGetSavedQueryById,
    createSavedQuery: mockCreateSavedQuery,
    updateSavedQuery: mockUpdateSavedQuery,
    deleteSavedQuery: mockDeleteSavedQuery,
    getQueryConnectionNames: mockGetQueryConnectionNames
}));

const mockUserHasPermission = mock();
const mockCreateAuditLog = mock();

mock.module("../rbac/services/rbac", () => ({
    userHasPermission: mockUserHasPermission,
    createAuditLog: mockCreateAuditLog,
    userHasAnyPermission: mock()
}));

// Mock Database to prevent crash
mock.module("../rbac/db/index", () => ({
    getDatabase: mock(() => ({})),
    initializeDatabase: mock(),
}));

import savedQueriesRouter from "./saved-queries";
import { errorHandler } from "../middleware/error";

describe("Saved Queries Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/saved-queries", savedQueriesRouter);

        mockGetSavedQueries.mockClear();
        mockGetSavedQueryById.mockClear();
        mockCreateSavedQuery.mockClear();
        mockUpdateSavedQuery.mockClear();
        mockDeleteSavedQuery.mockClear();
        mockGetQueryConnectionNames.mockClear();
        mockCreateAuditLog.mockClear();
    });

    afterAll(() => {
        mock.restore();
    });

    describe("GET /saved-queries", () => {
        it("should return saved queries", async () => {
            mockGetSavedQueries.mockResolvedValue([{ id: "q1", name: "Query 1" }]);

            const res = await app.request("/saved-queries", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data).toEqual([{ id: "q1", name: "Query 1" }]);
        });
    });

    describe("GET /saved-queries/:id", () => {
        it("should return single query", async () => {
            mockGetSavedQueryById.mockResolvedValue({ id: "q1", name: "Query 1" });

            const res = await app.request("/saved-queries/q1", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.id).toBe("q1");
        });

        it("should return 404 if not found", async () => {
            mockGetSavedQueryById.mockResolvedValue(null);

            const res = await app.request("/saved-queries/q1", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(404);
        });
    });

    describe("POST /saved-queries", () => {
        it("should create saved query", async () => {
            mockCreateSavedQuery.mockResolvedValue({ id: "q1", name: "New Query" });

            const res = await app.request("/saved-queries", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ name: "New Query", query: "SELECT 1" })
            });

            expect(res.status).toBe(200);
            expect(mockCreateSavedQuery).toHaveBeenCalled();
        });
    });

    describe("PUT /saved-queries/:id", () => {
        it("should update saved query", async () => {
            mockUpdateSavedQuery.mockResolvedValue({ id: "q1", name: "Updated Query" });

            const res = await app.request("/saved-queries/q1", {
                method: "PUT",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ name: "Updated Query" })
            });

            expect(res.status).toBe(200);
            expect(mockUpdateSavedQuery).toHaveBeenCalled();
        });
    });

    describe("DELETE /saved-queries/:id", () => {
        it("should delete saved query", async () => {
            mockDeleteSavedQuery.mockResolvedValue(true);

            const res = await app.request("/saved-queries/q1", {
                method: "DELETE",
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(mockDeleteSavedQuery).toHaveBeenCalled();
        });
    });
});
