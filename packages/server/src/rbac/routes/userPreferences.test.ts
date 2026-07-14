
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
const mockGetUserOnboardingProgress = mock();
const mockUpdateUserOnboardingProgress = mock();
const mockGetUserById = mock();
const mockCompleteBootstrapOnboarding = mock();
const mockGetUserConnections = mock();
const mockListConnections = mock();

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
    updateUserPreferences: mockUpdateUserPreferences,
    getUserOnboardingProgress: mockGetUserOnboardingProgress,
    updateUserOnboardingProgress: mockUpdateUserOnboardingProgress,
}));

mock.module("../services/rbac", () => ({
    getUserById: mockGetUserById,
    completeBootstrapOnboarding: mockCompleteBootstrapOnboarding,
}));

mock.module("../services/connections", () => ({
    getUserConnections: mockGetUserConnections,
    listConnections: mockListConnections,
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
        mockGetUserOnboardingProgress.mockClear();
        mockUpdateUserOnboardingProgress.mockClear();
        mockGetUserById.mockClear();
        mockCompleteBootstrapOnboarding.mockClear();
        mockGetUserConnections.mockClear();
        mockListConnections.mockClear();

        mockGetUserById.mockResolvedValue({
            id: "user-123",
            bootstrapOnboardingPending: false,
            requiresPasswordChange: false,
        });
        mockGetUserOnboardingProgress.mockResolvedValue({
            formatRevision: 1,
            welcomeSeen: false,
            completedChapterIds: [],
            dismissedChapterIds: [],
            lastStepIndex: 0,
        });
        mockUpdateUserOnboardingProgress.mockImplementation(async (_userId, patch) => ({
            formatRevision: 1,
            welcomeSeen: patch.welcomeSeen ?? false,
            completedChapterIds: patch.completedChapterIds ?? [],
            dismissedChapterIds: patch.dismissedChapterIds ?? [],
            lastChapterId: patch.lastChapterId ?? undefined,
            lastStepId: patch.lastStepId ?? undefined,
            lastStepIndex: patch.lastStepIndex ?? 0,
        }));
        mockGetUserConnections.mockResolvedValue([{ id: "connection-1" }]);
        mockListConnections.mockResolvedValue({
            connections: [{ id: "connection-1" }],
            total: 1,
        });

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

    describe("GET /user-prefs/preferences/onboarding", () => {
        it("returns progress and bootstrap requirements for the current user", async () => {
            mockGetUserById.mockResolvedValue({
                id: "user-123",
                bootstrapOnboardingPending: true,
                requiresPasswordChange: true,
            });

            const res = await app.request("/user-prefs/preferences/onboarding", {
                headers: { "Authorization": "Bearer token" },
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.bootstrapOnboardingPending).toBe(true);
            expect(body.requiresPasswordChange).toBe(true);
            expect(mockGetUserOnboardingProgress).toHaveBeenCalledWith("user-123");
        });
    });

    describe("PATCH /user-prefs/preferences/onboarding", () => {
        it("merges bounded progress for the current user", async () => {
            const res = await app.request("/user-prefs/preferences/onboarding", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({
                    welcomeSeen: true,
                    completedChapterIds: ["shell"],
                    lastChapterId: "explorer",
                    lastStepId: "explorer.import",
                    lastStepIndex: 2,
                }),
            });

            expect(res.status).toBe(200);
            expect(mockUpdateUserOnboardingProgress).toHaveBeenCalledWith("user-123", {
                welcomeSeen: true,
                completedChapterIds: ["shell"],
                lastChapterId: "explorer",
                lastStepId: "explorer.import",
                lastStepIndex: 2,
            });
        });

        it("requires a connection before completing fresh-install setup", async () => {
            mockGetUserConnections.mockResolvedValue([]);

            const res = await app.request("/user-prefs/preferences/onboarding", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ bootstrapComplete: true }),
            });

            expect(res.status).toBe(400);
            expect(mockCompleteBootstrapOnboarding).not.toHaveBeenCalled();
        });

        it("completes bootstrap only after readiness checks pass", async () => {
            const res = await app.request("/user-prefs/preferences/onboarding", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ bootstrapComplete: true }),
            });

            expect(res.status).toBe(200);
            expect(mockCompleteBootstrapOnboarding).toHaveBeenCalledWith("user-123");
        });

        it("uses all active connections for a freshly seeded super administrator", async () => {
            mockTokenPayload.roles = ["super_admin"];
            mockGetUserById.mockResolvedValue({
                id: "user-123",
                bootstrapOnboardingPending: true,
                requiresPasswordChange: false,
            });
            mockGetUserConnections.mockResolvedValue([]);

            const res = await app.request("/user-prefs/preferences/onboarding", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ bootstrapComplete: true }),
            });

            expect(res.status).toBe(200);
            expect(mockListConnections).toHaveBeenCalledWith({ activeOnly: true });
            expect(mockGetUserConnections).not.toHaveBeenCalled();
            expect(mockCompleteBootstrapOnboarding).toHaveBeenCalledWith("user-123");
        });

        it("does not run a no-op progress write after committing bootstrap metadata", async () => {
            mockUpdateUserOnboardingProgress.mockRejectedValue(new Error("preference write failed"));

            const res = await app.request("/user-prefs/preferences/onboarding", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ bootstrapComplete: true }),
            });

            expect(res.status).toBe(200);
            expect(mockGetUserOnboardingProgress).toHaveBeenCalledWith("user-123");
            expect(mockUpdateUserOnboardingProgress).not.toHaveBeenCalled();
            expect(mockCompleteBootstrapOnboarding).toHaveBeenCalledWith("user-123");
        });

        it("does not commit bootstrap metadata when the response progress cannot be read", async () => {
            mockGetUserOnboardingProgress.mockRejectedValue(new Error("preference read failed"));

            const res = await app.request("/user-prefs/preferences/onboarding", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ bootstrapComplete: true }),
            });

            expect(res.status).toBe(500);
            expect(mockCompleteBootstrapOnboarding).not.toHaveBeenCalled();
        });

        it("rejects unbounded chapter identifiers", async () => {
            const res = await app.request("/user-prefs/preferences/onboarding", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
                body: JSON.stringify({ completedChapterIds: ["x".repeat(101)] }),
            });

            expect(res.status).toBe(400);
            expect(mockUpdateUserOnboardingProgress).not.toHaveBeenCalled();
        });
    });
});
