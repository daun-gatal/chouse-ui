import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";

// Mock AI models service
const mockCreateAiModel = mock();
const mockGetAiModelById = mock();
const mockGetAiProviderById = mock();
const mockListAiModels = mock();
const mockListAiProviders = mock();
const mockUpdateAiModel = mock();
const mockDeleteAiModel = mock();

mock.module("../services/aiModels", () => ({
    createAiModel: mockCreateAiModel,
    getAiModelById: mockGetAiModelById,
    getAiProviderById: mockGetAiProviderById,
    listAiModels: mockListAiModels,
    listAiProviders: mockListAiProviders,
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
            const params = { temperature: 0.7, maxTokens: 4096, recursionLimit: 64, structuredOutputPolicy: "auto", extra: { seed: 42 } };
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

        it("rejects an unknown structured-output policy at the schema layer", async () => {
            const res = await post(app, { providerId: "prov-openai", name: "X", modelId: "x", params: { structuredOutputPolicy: "magic" } });
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
            // gpt-4o is not in Anthropic's profile table, so the window is required.
            const params = { topK: 40, maxTokens: 8192, contextWindow: 200_000 };
            mockGetAiModelById.mockResolvedValue({ ...storedModel, providerId: "prov-anthropic" });
            const res = await patch(app, "model-1", { params });
            expect(res.status).toBe(200);
            expect(mockUpdateAiModel).toHaveBeenCalledWith("model-1", expect.objectContaining({ params }));
        });

        it("clears params with null for a model the profile knows", async () => {
            const res = await patch(app, "model-1", { params: null });
            expect(res.status).toBe(200);
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

describe("RBAC AI Models Routes · context window (ADR 0022)", () => {
    let app: Hono;
    const compatProvider = { ...openaiProvider, id: "prov-compat", providerType: "openai-compatible", baseUrl: "http://localhost:8000/v1" };

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/ai-base-models", aiModelsRoutes);
        mockCreateAiModel.mockClear();
        mockUpdateAiModel.mockClear();
        mockGetAiProviderById.mockImplementation(async (id: string) => (id === "prov-compat" ? compatProvider : openaiProvider));
        mockCreateAiModel.mockResolvedValue(storedModel);
        mockUpdateAiModel.mockResolvedValue(storedModel);
    });

    it("refuses a model LangChain does not know without a window", async () => {
        const res = await post(app, { providerId: "prov-compat", name: "Local", modelId: "my-local-llm" });
        expect(res.status).toBe(400);
        expect((await res.json()).error.message).toContain("Set a context window for the AI model 'Local'");
        expect(mockCreateAiModel).not.toHaveBeenCalled();
    });

    it("accepts it with a window", async () => {
        const res = await post(app, { providerId: "prov-compat", name: "Local", modelId: "my-local-llm", params: { contextWindow: 32_768 } });
        expect(res.status).toBe(201);
    });

    it("rejects maxTokens at or above the window", async () => {
        const res = await post(app, { providerId: "prov-compat", name: "Local", modelId: "my-local-llm", params: { contextWindow: 8_192, maxTokens: 8_192 } });
        expect(res.status).toBe(400);
        expect((await res.json()).error.message).toContain("'maxTokens' must be smaller than 'contextWindow'");
    });

    it("refuses an update that leaves a stored unknown model without a window", async () => {
        mockGetAiModelById.mockResolvedValue({ ...storedModel, providerId: "prov-compat", name: "Local", modelId: "my-local-llm" });
        const res = await patch(app, "model-1", { name: "Local 2" });
        expect(res.status).toBe(400);
        expect(mockUpdateAiModel).not.toHaveBeenCalled();
        expect((await patch(app, "model-1", { params: { contextWindow: 32_768 } })).status).toBe(200);
    });

    it("lists the window each model's profile reports", async () => {
        mockListAiModels.mockResolvedValue([storedModel, { ...storedModel, id: "model-2", providerId: "prov-compat", modelId: "my-local-llm" }]);
        mockListAiProviders.mockResolvedValue([openaiProvider, compatProvider]);
        const res = await app.request("/ai-base-models", { headers: AUTH });
        const body = await res.json();
        expect(body.data.map((m: { profileContextWindow: number | null }) => m.profileContextWindow)).toEqual([128_000, null]);
    });
});

describe("RBAC AI Models Routes · pricing (ADR 0020)", () => {
    let app: Hono;

    beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.route("/ai-base-models", aiModelsRoutes);
        mockCreateAiModel.mockClear();
        mockUpdateAiModel.mockClear();
        mockGetAiProviderById.mockImplementation(async () => openaiProvider);
        mockCreateAiModel.mockResolvedValue(storedModel);
        mockUpdateAiModel.mockResolvedValue(storedModel);
        mockGetAiModelById.mockResolvedValue(storedModel);
    });

    it("stores a price on create", async () => {
        const pricing = { input: 2.5, output: 10, cacheRead: 1.25 };
        const res = await post(app, { providerId: "prov-openai", name: "GPT", modelId: "gpt-4o", pricing });
        expect(res.status).toBe(201);
        expect(mockCreateAiModel).toHaveBeenCalledWith(expect.objectContaining({ pricing }));
    });

    it("accepts a model without a price", async () => {
        const res = await post(app, { providerId: "prov-openai", name: "GPT", modelId: "gpt-4o" });
        expect(res.status).toBe(201);
    });

    it.each([
        ["negative", { input: -1, output: 1 }],
        ["missing output", { input: 1 }],
        ["absurd", { input: 1_000_000, output: 1 }],
        ["unknown key", { input: 1, output: 1, perRequest: 2 }],
        ["string", { input: "3", output: 1 }],
    ])("rejects a %s price", async (_label, pricing) => {
        const res = await post(app, { providerId: "prov-openai", name: "GPT", modelId: "gpt", pricing });
        expect(res.status).toBe(400);
        expect(mockCreateAiModel).not.toHaveBeenCalled();
    });

    it("sets and clears the price on update", async () => {
        expect((await patch(app, "model-1", { pricing: { input: 0, output: 0 } })).status).toBe(200);
        expect(mockUpdateAiModel).toHaveBeenLastCalledWith("model-1", expect.objectContaining({ pricing: { input: 0, output: 0 } }));
        expect((await patch(app, "model-1", { pricing: null })).status).toBe(200);
        expect(mockUpdateAiModel).toHaveBeenLastCalledWith("model-1", expect.objectContaining({ pricing: null }));
    });
});
