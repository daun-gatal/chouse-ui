/**
 * Model factory tests — assert that per-model runtime params
 * (rbac_ai_models.params) land on the right constructor field of each
 * provider's LangChain chat model. Constructors only, no network calls.
 */
import { describe, it, expect } from "bun:test";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { initializeDeepAgentModel } from "./aiConfig";
import type { AiConfigWithKey } from "../rbac/services/aiModels";
import type { AiModelParams } from "../rbac/constants/aiModelParams";
import type { ProviderType } from "../rbac/constants/aiProviders";

// maxRetries lives on the protected AsyncCaller; Google transport options live
// on the underlying SDK client. Structural views keep the assertions typed.
function callerOf(model: unknown): { maxRetries?: number } {
  return (model as { caller: { maxRetries?: number } }).caller;
}

function googleRequestOptionsOf(model: unknown): { apiVersion?: string; baseUrl?: string } {
  return (model as { client: { _requestOptions?: { apiVersion?: string; baseUrl?: string } } }).client._requestOptions ?? {};
}

function fakeConfig(
  providerType: ProviderType,
  params: AiModelParams | null,
  baseUrl: string | null = null,
): AiConfigWithKey {
  const now = new Date();
  return {
    id: "config-1",
    modelId: "model-1",
    name: "Test deployment",
    isActive: true,
    isDefault: true,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    model: {
      id: "model-1",
      providerId: "provider-1",
      name: "Test model",
      modelId: providerType === "anthropic" ? "claude-sonnet-5" : providerType === "google" ? "gemini-2.5-pro" : "gpt-4o",
      params,
      createdAt: now,
      updatedAt: now,
    },
    provider: {
      id: "provider-1",
      name: "Test provider",
      providerType,
      baseUrl,
      isActive: true,
      apiKey: "test-key",
      createdAt: now,
      updatedAt: now,
    },
  };
}

describe("initializeDeepAgentModel · openai", () => {
  it("keeps the temperature-0 default when params are unset (status quo)", () => {
    const model = initializeDeepAgentModel(fakeConfig("openai", null));
    expect(model).toBeInstanceOf(ChatOpenAI);
    const m = model as ChatOpenAI;
    expect(m.temperature).toBe(0);
    expect(m.maxTokens).toBeUndefined();
  });

  it("applies sampling, output, reliability, and extra params", () => {
    const model = initializeDeepAgentModel(
      fakeConfig("openai", {
        temperature: 0.7,
        topP: 0.9,
        frequencyPenalty: 0.5,
        presencePenalty: -0.5,
        maxTokens: 4096,
        stopSequences: ["END"],
        reasoningEffort: "high",
        maxRetries: 3,
        requestTimeoutMs: 60_000,
        extra: { seed: 42 },
      }),
    );
    const m = model as ChatOpenAI;
    expect(m.temperature).toBe(0.7);
    expect(m.topP).toBe(0.9);
    expect(m.frequencyPenalty).toBe(0.5);
    expect(m.presencePenalty).toBe(-0.5);
    expect(m.maxTokens).toBe(4096);
    expect(m.stopSequences).toEqual(["END"]);
    expect(m.reasoning).toEqual({ effort: "high" });
    expect(callerOf(m).maxRetries).toBe(3);
    expect(m.timeout).toBe(60_000);
    expect(m.modelKwargs).toEqual({ seed: 42 });
  });
});

describe("initializeDeepAgentModel · openai-compatible", () => {
  it("requires a base URL", () => {
    expect(() => initializeDeepAgentModel(fakeConfig("openai-compatible", null))).toThrow();
  });

  it("applies params on top of the custom base URL", () => {
    const model = initializeDeepAgentModel(
      fakeConfig("openai-compatible", { temperature: 1.2, extra: { repetition_penalty: 1.1 } }, "http://localhost:11434/v1"),
    );
    const m = model as ChatOpenAI;
    expect(m.temperature).toBe(1.2);
    expect(m.modelKwargs).toEqual({ repetition_penalty: 1.1 });
  });
});

describe("initializeDeepAgentModel · anthropic", () => {
  it("keeps the temperature-0 default when params are unset (status quo)", () => {
    const model = initializeDeepAgentModel(fakeConfig("anthropic", null));
    expect(model).toBeInstanceOf(ChatAnthropic);
    const m = model as ChatAnthropic;
    expect(m.temperature).toBe(0);
  });

  it("applies sampling, thinking, transport, and extra params", () => {
    const model = initializeDeepAgentModel(
      fakeConfig("anthropic", {
        topP: 0.8,
        topK: 40,
        maxTokens: 16_000,
        stopSequences: ["Human:"],
        thinkingBudgetTokens: 4096,
        maxRetries: 2,
        requestTimeoutMs: 90_000,
        extra: { metadata: { user_id: "u1" } },
      }, "https://proxy.example.com"),
    );
    const m = model as ChatAnthropic;
    expect(m.topP).toBe(0.8);
    expect(m.topK).toBe(40);
    expect(m.maxTokens).toBe(16_000);
    expect(m.stopSequences).toEqual(["Human:"]);
    expect(m.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
    expect(callerOf(m).maxRetries).toBe(2);
    expect(m.clientOptions.baseURL).toBe("https://proxy.example.com");
    expect(m.clientOptions.timeout).toBe(90_000);
    expect(m.invocationKwargs).toEqual({ metadata: { user_id: "u1" } });
  });

  it("omits the temperature-0 default when extended thinking is enabled", () => {
    const model = initializeDeepAgentModel(
      fakeConfig("anthropic", { maxTokens: 16_000, thinkingBudgetTokens: 4096 }),
    );
    const m = model as ChatAnthropic;
    // Anthropic rejects temperature != 1 with thinking on; unset lets the API default apply.
    expect(m.temperature).toBeUndefined();
  });

  it("maps reasoningEffort to outputConfig.effort", () => {
    const model = initializeDeepAgentModel(fakeConfig("anthropic", { reasoningEffort: "medium" }));
    const m = model as ChatAnthropic;
    expect(m.outputConfig).toEqual({ effort: "medium" });
  });
});

describe("initializeDeepAgentModel · google", () => {
  it("keeps the temperature-0 default when params are unset (status quo)", () => {
    const model = initializeDeepAgentModel(fakeConfig("google", null));
    expect(model).toBeInstanceOf(ChatGoogleGenerativeAI);
    const m = model as ChatGoogleGenerativeAI;
    expect(m.temperature).toBe(0);
  });

  it("passes the provider base URL to the client (bug fix)", () => {
    const model = initializeDeepAgentModel(fakeConfig("google", null, "https://gemini-proxy.example.com"));
    expect(googleRequestOptionsOf(model).baseUrl).toBe("https://gemini-proxy.example.com");
  });

  it("applies sampling, output, thinking, and transport params", () => {
    const model = initializeDeepAgentModel(
      fakeConfig("google", {
        temperature: 1.5,
        topP: 0.95,
        topK: 40,
        maxTokens: 8192,
        stopSequences: ["STOP"],
        thinkingBudgetTokens: 2048,
        apiVersion: "v1beta",
        safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
        maxRetries: 4,
      }),
    );
    const m = model as ChatGoogleGenerativeAI;
    expect(m.temperature).toBe(1.5);
    expect(m.topP).toBe(0.95);
    expect(m.topK).toBe(40);
    expect(m.maxOutputTokens).toBe(8192);
    expect(m.stopSequences).toEqual(["STOP"]);
    expect(m.thinkingConfig).toEqual({ thinkingBudget: 2048 });
    expect(googleRequestOptionsOf(m).apiVersion).toBe("v1beta");
    expect(m.safetySettings).toEqual([{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }]);
    expect(callerOf(m).maxRetries).toBe(4);
  });
});
