
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock Services
const mockGetUserFavorites = mock();
const mockAddUserFavorite = mock();
const mockRemoveUserFavorite = mock();
const mockClearUserFavorites = mock();
const mockIsUserFavorite = mock();
const mockGetUserRecentItems = mock();
const mockAddUserRecentItem = mock();
const mockClearUserRecentItems = mock();
const mockGetUserPreferences = mock();
const mockUpdateUserPreferences = mock();

mock.module("../services/userPreferences", () => ({
    getUserFavorites: mockGetUserFavorites,
    addUserFavorite: mockAddUserFavorite,
    removeUserFavorite: mockRemoveUserFavorite,
    clearUserFavorites: mockClearUserFavorites,
    isUserFavorite: mockIsUserFavorite,
    getUserRecentItems: mockGetUserRecentItems,
    addUserRecentItem: mockAddUserRecentItem,
    clearUserRecentItems: mockClearUserRecentItems,
    getUserPreferences: mockGetUserPreferences,
    updateUserPreferences: mockUpdateUserPreferences
}));

// Mock JWT Service
let mockTokenPayload = {
    sub: 'user-123',
    roles: ['user'],
    permissions: [],
    sessionId: 'sess-1'
};

mock.module("../services/jwt", () => ({
    verifyAccessToken: mock(async () => mockTokenPayload),
    extractTokenFromHeader: mock((h) => h ? "valid_token" : null),
    verifyRefreshToken: mock(async () => mockTokenPayload)
}));

import userPreferencesRoutes from "./userPreferences";
import { errorHandler } from "../../middleware/error";

describe("RBAC User Preferences Routes", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/user-prefs", userPreferencesRoutes);

        mockGetUserFavorites.mockClear();
        mockAddUserFavorite.mockClear();
        mockRemoveUserFavorite.mockClear();
        mockClearUserFavorites.mockClear();
        mockIsUserFavorite.mockClear();
        mockGetUserRecentItems.mockClear();
        mockAddUserRecentItem.mockClear();
        mockClearUserRecentItems.mockClear();
        mockGetUserPreferences.mockClear();
        mockUpdateUserPreferences.mockClear();

        mockTokenPayload = {
            sub: 'user-123',
            roles: ['user'],
            permissions: [],
            sessionId: 'sess-1'
        };
    });

    afterAll(() => {
        mock.restore();
    });

    describe("GET /user-prefs/favorites", () => {
        it("should return favorites", async () => {
            mockGetUserFavorites.mockResolvedValue([]);
            const res = await app.request("/user-prefs/favorites", { headers: { "Authorization": "Bearer token" } });
            expect(res.status).toBe(200);
            expect(mockGetUserFavorites).toHaveBeenCalledWith("user-123");
        });
    });

    describe("POST /user-prefs/favorites", () => {
        it("should add favorite", async () => {
            mockAddUserFavorite.mockResolvedValue({ id: "f1", database: "db1" });

            const res = await app.request("/user-prefs/favorites", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ database: "db1", table: "t1" })
            });

            expect(res.status).toBe(201);
            expect(mockAddUserFavorite).toHaveBeenCalledWith("user-123", "db1", "t1", undefined, undefined);
        });
    });

    describe("DELETE /user-prefs/favorites/:id", () => {
        it("should remove favorite", async () => {
            mockRemoveUserFavorite.mockResolvedValue(true);

            const res = await app.request("/user-prefs/favorites/f1", {
                method: "DELETE",
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(mockRemoveUserFavorite).toHaveBeenCalledWith("user-123", "f1");
        });

        it("should 404 if not found", async () => {
            mockRemoveUserFavorite.mockResolvedValue(false);

            const res = await app.request("/user-prefs/favorites/f1", {
                method: "DELETE",
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(404);
        });
    });

    describe("GET /user-prefs/favorites/check", () => {
        it("should check favorite", async () => {
            mockIsUserFavorite.mockResolvedValue(true);

            const res = await app.request("/user-prefs/favorites/check?database=db1", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.isFavorite).toBe(true);
        });
    });

    describe("GET /user-prefs/recent", () => {
        it("should return recent items", async () => {
            mockGetUserRecentItems.mockResolvedValue([]);

            const res = await app.request("/user-prefs/recent", {
                headers: { "Authorization": "Bearer token" }
            });

            expect(res.status).toBe(200);
            expect(mockGetUserRecentItems).toHaveBeenCalledWith("user-123", 10);
        });
    });

    describe("GET /user-prefs/preferences", () => {
        it("should return preferences", async () => {
            mockGetUserPreferences.mockResolvedValue({});
            const res = await app.request("/user-prefs/preferences", { headers: { "Authorization": "Bearer token" } });
            expect(res.status).toBe(200);
        });
    });

    describe("PUT /user-prefs/preferences", () => {
        it("should update preferences", async () => {
            mockUpdateUserPreferences.mockResolvedValue({ explorerViewMode: 'list' });

            const res = await app.request("/user-prefs/preferences", {
                method: "PUT",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ explorerViewMode: 'list' })
            });

            expect(res.status).toBe(200);
            expect(mockUpdateUserPreferences).toHaveBeenCalled();
        });
    });
});
