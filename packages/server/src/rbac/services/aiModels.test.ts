/**
 * Integration test for the AI models service.
 *
 * Boots a real in-memory SQLite RBAC database and runs all migrations, then
 * drives the provider/model/config CRUD end-to-end — focused on the runtime
 * `params` JSON column: persistence roundtrip, replace/clear/leave-unchanged
 * semantics, and the getAiConfigWithKey path that feeds the AI engine.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { AiModelParams } from "../constants/aiModelParams";

// Use an in-memory SQLite DB for this test process.
process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { initializeDatabase, closeDatabase } = await import("../db");
const { runMigrations } = await import("../db/migrations");
const {
  createAiProvider,
  createAiModel,
  getAiModelById,
  updateAiModel,
  listAiModels,
  createAiConfig,
  getAiConfigWithKey,
  listAiConfigs,
} = await import("./aiModels");

let providerId = "";

const sampleParams: AiModelParams = {
  temperature: 0.4,
  topP: 0.9,
  maxTokens: 8192,
  stopSequences: ["END"],
  maxRetries: 3,
  recursionLimit: 64,
  runTimeoutMs: 120_000,
  extra: { seed: 42 },
};

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });

  const provider = await createAiProvider({
    name: "Test OpenAI",
    providerType: "openai",
    apiKey: "sk-test",
  });
  providerId = provider.id;
});

afterAll(async () => {
  await closeDatabase();
});

describe("AI models service · params", () => {
  it("creates a model without params (null)", async () => {
    const model = await createAiModel({ providerId, name: "Plain", modelId: "gpt-4o-mini" });
    expect(model.params).toBeNull();

    const fetched = await getAiModelById(model.id);
    expect(fetched?.params).toBeNull();
  });

  it("persists params on create and round-trips them through getAiModelById and listAiModels", async () => {
    const model = await createAiModel({ providerId, name: "Tuned", modelId: "gpt-4o", params: sampleParams });
    expect(model.params).toEqual(sampleParams);

    const fetched = await getAiModelById(model.id);
    expect(fetched?.params).toEqual(sampleParams);

    const listed = await listAiModels(providerId);
    const row = listed.find((m) => m.id === model.id);
    expect(row?.params).toEqual(sampleParams);
  });

  it("replaces the whole params object on update", async () => {
    const model = await createAiModel({ providerId, name: "Replace", modelId: "gpt-4o", params: sampleParams });

    const updated = await updateAiModel(model.id, { params: { temperature: 1.2 } });
    expect(updated?.params).toEqual({ temperature: 1.2 });
  });

  it("leaves params untouched when the update omits them", async () => {
    const model = await createAiModel({ providerId, name: "Keep", modelId: "gpt-4o", params: sampleParams });

    const updated = await updateAiModel(model.id, { name: "Keep 2" });
    expect(updated?.name).toBe("Keep 2");
    expect(updated?.params).toEqual(sampleParams);
  });

  it("clears params with an explicit null", async () => {
    const model = await createAiModel({ providerId, name: "Clear", modelId: "gpt-4o", params: sampleParams });

    const updated = await updateAiModel(model.id, { params: null });
    expect(updated?.params).toBeNull();
  });

  it("surfaces params on the engine path (getAiConfigWithKey) and listAiConfigs", async () => {
    const model = await createAiModel({ providerId, name: "Engine", modelId: "gpt-4o", params: sampleParams });
    const config = await createAiConfig({ modelId: model.id, name: "Engine deployment" });

    const withKey = await getAiConfigWithKey(config.id);
    expect(withKey?.model.params).toEqual(sampleParams);
    expect(withKey?.provider.apiKey).toBe("sk-test");

    const { configs } = await listAiConfigs();
    const row = configs.find((cfg) => cfg.id === config.id);
    expect(row?.model.params).toEqual(sampleParams);
  });
});
