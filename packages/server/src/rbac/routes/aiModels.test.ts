import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock AI models service
const mockCreateAiModel = mock();
const mockGetAiModelById = mock();
const mockGetAiProviderById = mock();
const mockListAiModels = mock();
const mockUpdateAiModel = mock();
const mockDeleteAiModel = mock();

mock.module("../services/aiModels", () => ({
    createAiModel: mockCreateAiModel,
    getAiModelById: mockGetAiModelById,
    getAiProviderById: mockGetAiProviderById,
    listAiModels: mockListAiModels,
    updateAiModel: mockUpdateAiModel,
    deleteAiModel: mockDeleteAiModel,
}));

// Mock audit + permission double-checks
const mockCreateAuditLogWithContext = mock();
const mockUserHasPermission = mock(async () => false);

mock.module("../services/rbac", () => ({
    createAuditLog: mock(),
    createAuditLogWithContext: mockCreateAuditLogWithContext,
    userHasPermission: mockUserHasPermission,
    userHasAnyPermission: mock(async () => false),
    userHasAllPermissions: mock(async () => false),
}));

// Mock JWT so the token payload carries the AI model permissions directly
const mockTokenPayload = {
    sub: "admin-id",
    roles: ["super_admin"],
    permissions: ["ai_models:view", "ai_models:create", "ai_models:update", "ai_models:delete"],
    sessionId: "sess-1",
};

mock.module("../services/jwt", () => ({
    verifyAccessToken: mock(async () => mockTokenPayload),
    extractTokenFromHeader: mock((h: string | undefined) => (h ? "valid_token" : null)),
    verifyRefreshToken: mock(async () => mockTokenPayload),
}));

import aiModelsRoutes from "./aiModels";
import { errorHandler } from "../../middleware/error";

const AUTH = { Authorization: "Bearer token", "Content-Type": "application/json" };

const openaiProvider = { id: "prov-openai", name: "OpenAI", providerType: "openai", baseUrl: null, isActive: true, createdAt: new Date(), updatedAt: new Date() };
const anthropicProvider = { ...openaiProvider, id: "prov-anthropic", name: "Anthropic", providerType: "anthropic" };
const googleProvider = { ...openaiProvider, id: "prov-google", name: "Google", providerType: "google" };

const storedModel = {
    id: "model-1",
    providerId: "prov-openai",
    name: "GPT-4o",
    modelId: "gpt-4o",
    params: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

function post(app: Hono, body: unknown): Promise<Response> {
    return app.request("/ai-base-models", { method: "POST", headers: AUTH, body: JSON.stringify(body) });
}

function patch(app: Hono, id: string, body: unknown): Promise<Response> {
    return app.request(`/ai-base-models/${id}`, { method: "PATCH", headers: AUTH, body: JSON.stringify(body) });
}

describe("RBAC AI Models Routes · params", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/ai-base-models", aiModelsRoutes);

        mockCreateAiModel.mockClear();
        mockGetAiModelById.mockClear();
        mockGetAiProviderById.mockClear();
        mockUpdateAiModel.mockClear();
        mockCreateAuditLogWithContext.mockClear();

        mockGetAiProviderById.mockImplementation(async (id: string) => {
            if (id === "prov-openai") return openaiProvider;
            if (id === "prov-anthropic") return anthropicProvider;
            if (id === "prov-google") return googleProvider;
            return null;
        });
        mockCreateAiModel.mockResolvedValue(storedModel);
        mockUpdateAiModel.mockResolvedValue(storedModel);
        mockGetAiModelById.mockResolvedValue(storedModel);
    });

    afterAll(() => {
        mock.restore();
    });

    describe("POST /", () => {
        it("accepts valid openai params and passes them to the service", async () => {
            const params = { temperature: 0.7, maxTokens: 4096, recursionLimit: 64, extra: { seed: 42 } };
            const res = await post(app, { providerId: "prov-openai", name: "GPT-4o", modelId: "gpt-4o", params });
            expect(res.status).toBe(201);
            expect(mockCreateAiModel).toHaveBeenCalledWith(expect.objectContaining({ params }));
        });

        it("rejects an unknown provider", async () => {
            const res = await post(app, { providerId: "prov-missing", name: "X", modelId: "x" });
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error.code).toBe("INVALID_PROVIDER");
        });

        it("rejects unknown param keys at the schema layer", async () => {
            const res = await post(app, { providerId: "prov-openai", name: "X", modelId: "x", params: { bogus: 1 } });
            expect(res.status).toBe(400);
            expect(mockCreateAiModel).not.toHaveBeenCalled();
        });

        it("rejects topK for an openai provider", async () => {
            const res = await post(app, { providerId: "prov-openai", name: "X", modelId: "x", params: { topK: 40 } });
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error.code).toBe("INVALID_PARAMS");
            expect(body.error.message).toContain("topK");
        });

        it("rejects temperature above 1 for an anthropic provider", async () => {
            const res = await post(app, { providerId: "prov-anthropic", name: "X", modelId: "x", params: { temperature: 1.5 } });
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error.code).toBe("INVALID_PARAMS");
            expect(body.error.message).toContain("temperature");
        });

        it("rejects extra kwargs for a google provider", async () => {
            const res = await post(app, { providerId: "prov-google", name: "X", modelId: "x", params: { extra: { a: 1 } } });
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error.code).toBe("INVALID_PARAMS");
        });

        it("rejects anthropic thinking budget without maxTokens", async () => {
            const res = await post(app, { providerId: "prov-anthropic", name: "X", modelId: "x", params: { thinkingBudgetTokens: 4096 } });
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error.message).toContain("maxTokens");
        });

        it("audit-logs the param keys", async () => {
            await post(app, { providerId: "prov-openai", name: "GPT-4o", modelId: "gpt-4o", params: { temperature: 0.5, topP: 0.9 } });
            expect(mockCreateAuditLogWithContext).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                "admin-id",
                expect.objectContaining({
                    details: expect.objectContaining({ paramsKeys: ["temperature", "topP"] }),
                }),
            );
        });
    });

    describe("PATCH /:id", () => {
        it("validates params against the model's provider type", async () => {
            mockGetAiModelById.mockResolvedValue({ ...storedModel, providerId: "prov-anthropic" });
            const res = await patch(app, "model-1", { params: { frequencyPenalty: 1 } });
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error.code).toBe("INVALID_PARAMS");
            expect(body.error.message).toContain("frequencyPenalty");
            expect(mockUpdateAiModel).not.toHaveBeenCalled();
        });

        it("accepts valid params for the model's provider", async () => {
            const params = { topK: 40, maxTokens: 8192 };
            mockGetAiModelById.mockResolvedValue({ ...storedModel, providerId: "prov-anthropic" });
            const res = await patch(app, "model-1", { params });
            expect(res.status).toBe(200);
            expect(mockUpdateAiModel).toHaveBeenCalledWith("model-1", expect.objectContaining({ params }));
        });

        it("clears params with null (no provider validation needed)", async () => {
            const res = await patch(app, "model-1", { params: null });
            expect(res.status).toBe(200);
            expect(mockGetAiProviderById).not.toHaveBeenCalled();
            expect(mockUpdateAiModel).toHaveBeenCalledWith("model-1", expect.objectContaining({ params: null }));
            expect(mockCreateAuditLogWithContext).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                "admin-id",
                expect.objectContaining({
                    details: expect.objectContaining({ paramsCleared: true }),
                }),
            );
        });

        it("404s when params are sent for a missing model", async () => {
            mockGetAiModelById.mockResolvedValue(null);
            const res = await patch(app, "model-x", { params: { temperature: 0.5 } });
            expect(res.status).toBe(404);
        });
    });
});
