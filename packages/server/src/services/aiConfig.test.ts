/**
 * Model factory tests — assert that per-model runtime params
 * (rbac_ai_models.params) land on the right constructor field of each
 * provider's LangChain chat model. Constructors only, no network calls.
 */
import { describe, it, expect } from "bun:test";
import { ChatOpenAI, AzureChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatMistralAI } from "@langchain/mistralai";
import { ChatCohere } from "@langchain/cohere";
import { ChatOllama } from "@langchain/ollama";
import { ChatXAI } from "@langchain/xai";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatCerebras } from "@langchain/cerebras";
import { ChatBedrockConverse } from "@langchain/aws";
import { initializeDeepAgentModel, parseBedrockCredentials, DEFAULT_BASE_URLS } from "./aiConfig";
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

function openAiClientConfigOf(model: unknown): { baseURL?: string } {
  return (model as { clientConfig?: { baseURL?: string } }).clientConfig ?? {};
}

const BEDROCK_KEY_JSON = JSON.stringify({
  region: "us-east-1",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret",
});

function fakeConfig(
  providerType: ProviderType,
  params: AiModelParams | null,
  baseUrl: string | null = null,
  apiKey: string | null = "test-key",
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
      apiKey,
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

describe("initializeDeepAgentModel · azure-openai", () => {
  it("requires a base URL (Azure endpoint)", () => {
    expect(() => initializeDeepAgentModel(fakeConfig("azure-openai", null))).toThrow();
  });

  it("maps endpoint, deployment, api version, and openai params", () => {
    const model = initializeDeepAgentModel(
      fakeConfig("azure-openai", {
        temperature: 0.4,
        maxTokens: 2048,
        apiVersion: "2025-01-01-preview",
        maxRetries: 3,
      }, "https://myresource.openai.azure.com"),
    );
    expect(model).toBeInstanceOf(AzureChatOpenAI);
    const m = model as AzureChatOpenAI;
    expect(m.azureOpenAIApiDeploymentName).toBe("gpt-4o");
    expect(m.azureOpenAIApiVersion).toBe("2025-01-01-preview");
    expect(m.temperature).toBe(0.4);
    expect(m.maxTokens).toBe(2048);
    expect(callerOf(m).maxRetries).toBe(3);
  });

  it("falls back to a code-level default api version", () => {
    const model = initializeDeepAgentModel(fakeConfig("azure-openai", null, "https://myresource.openai.azure.com"));
    expect((model as AzureChatOpenAI).azureOpenAIApiVersion).toBe("2024-10-21");
  });
});

describe("initializeDeepAgentModel · groq", () => {
  it("applies params with the temperature-0 default", () => {
    const model = initializeDeepAgentModel(
      fakeConfig("groq", { topP: 0.9, maxTokens: 1024, stopSequences: ["END"], maxRetries: 2 }),
    );
    expect(model).toBeInstanceOf(ChatGroq);
    const m = model as ChatGroq;
    expect(m.temperature).toBe(0);
    expect(m.maxTokens).toBe(1024);
    expect(m.stopSequences).toEqual(["END"]);
    expect(callerOf(m).maxRetries).toBe(2);
  });
});

describe("initializeDeepAgentModel · mistral", () => {
  it("applies params and the base URL as serverURL", () => {
    const model = initializeDeepAgentModel(
      fakeConfig("mistral", { temperature: 0.5, topP: 0.8, maxTokens: 512, maxRetries: 1 }, "https://mistral-proxy.example.com"),
    );
    expect(model).toBeInstanceOf(ChatMistralAI);
    const m = model as ChatMistralAI;
    expect(m.temperature).toBe(0.5);
    expect(m.topP).toBe(0.8);
    expect(m.maxTokens).toBe(512);
    expect(m.serverURL).toBe("https://mistral-proxy.example.com");
    expect(callerOf(m).maxRetries).toBe(1);
  });
});

describe("initializeDeepAgentModel · cohere", () => {
  it("applies temperature and retries", () => {
    const model = initializeDeepAgentModel(fakeConfig("cohere", { temperature: 0.6, maxRetries: 2 }));
    expect(model).toBeInstanceOf(ChatCohere);
    const m = model as ChatCohere;
    expect(m.temperature).toBe(0.6);
    expect(callerOf(m).maxRetries).toBe(2);
  });
});

describe("initializeDeepAgentModel · ollama", () => {
  it("requires a base URL", () => {
    expect(() => initializeDeepAgentModel(fakeConfig("ollama", null, null, null))).toThrow();
  });

  it("works without an API key and maps maxTokens to numPredict", () => {
    const model = initializeDeepAgentModel(
      fakeConfig("ollama", { temperature: 0.2, topK: 20, maxTokens: 256, stopSequences: ["###"] }, "http://localhost:11434", null),
    );
    expect(model).toBeInstanceOf(ChatOllama);
    const m = model as ChatOllama;
    expect(m.temperature).toBe(0.2);
    expect(m.topK).toBe(20);
    expect(m.numPredict).toBe(256);
    expect(m.baseUrl).toBe("http://localhost:11434");
  });
});

describe("initializeDeepAgentModel · xai", () => {
  it("applies params with the temperature-0 default", () => {
    const model = initializeDeepAgentModel(
      fakeConfig("xai", { maxTokens: 2048, stopSequences: ["STOP"], maxRetries: 2 }),
    );
    expect(model).toBeInstanceOf(ChatXAI);
    const m = model as ChatXAI;
    expect(m.temperature).toBe(0);
    expect(m.maxTokens).toBe(2048);
    expect(callerOf(m).maxRetries).toBe(2);
  });
});

describe("initializeDeepAgentModel · deepseek", () => {
  it("applies the openai-style param set", () => {
    const model = initializeDeepAgentModel(
      fakeConfig("deepseek", {
        temperature: 0.9,
        topP: 0.7,
        frequencyPenalty: 0.2,
        presencePenalty: 0.1,
        maxTokens: 4096,
        maxRetries: 3,
        requestTimeoutMs: 30_000,
        extra: { seed: 7 },
      }),
    );
    expect(model).toBeInstanceOf(ChatDeepSeek);
    const m = model as ChatDeepSeek;
    expect(m.temperature).toBe(0.9);
    expect(m.topP).toBe(0.7);
    expect(m.maxTokens).toBe(4096);
    expect(callerOf(m).maxRetries).toBe(3);
    expect(m.timeout).toBe(30_000);
    expect(m.modelKwargs).toEqual({ seed: 7 });
  });
});

describe("initializeDeepAgentModel · cerebras", () => {
  it("applies params with the temperature-0 default", () => {
    const model = initializeDeepAgentModel(fakeConfig("cerebras", { maxTokens: 1024, maxRetries: 2 }));
    expect(model).toBeInstanceOf(ChatCerebras);
    const m = model as ChatCerebras;
    expect(m.maxCompletionTokens).toBe(1024);
    expect(callerOf(m).maxRetries).toBe(2);
  });
});

describe("initializeDeepAgentModel · bedrock", () => {
  it("builds ChatBedrockConverse from JSON credentials", () => {
    const model = initializeDeepAgentModel(
      fakeConfig("bedrock", { temperature: 0.3, topP: 0.9, maxTokens: 2048 }, null, BEDROCK_KEY_JSON),
    );
    expect(model).toBeInstanceOf(ChatBedrockConverse);
    const m = model as ChatBedrockConverse;
    expect(m.region).toBe("us-east-1");
    expect(m.temperature).toBe(0.3);
    expect(m.topP).toBe(0.9);
    expect(m.maxTokens).toBe(2048);
  });

  it("rejects a missing or malformed credentials payload", () => {
    expect(() => initializeDeepAgentModel(fakeConfig("bedrock", null, null, null))).toThrow();
    expect(() => initializeDeepAgentModel(fakeConfig("bedrock", null, null, "not-json"))).toThrow();
    expect(() => initializeDeepAgentModel(
      fakeConfig("bedrock", null, null, JSON.stringify({ region: "us-east-1" })),
    )).toThrow();
  });
});

describe("parseBedrockCredentials", () => {
  it("round-trips a complete payload", () => {
    expect(parseBedrockCredentials(BEDROCK_KEY_JSON)).toEqual({
      region: "us-east-1",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    });
  });

  it("rejects empty-string fields", () => {
    expect(() => parseBedrockCredentials(JSON.stringify({ region: "", accessKeyId: "a", secretAccessKey: "b" }))).toThrow();
  });
});

describe("initializeDeepAgentModel · openai-compatible presets", () => {
  const presets = ["fireworks", "together", "openrouter"] as const;

  for (const preset of presets) {
    it(`${preset}: applies the preset base URL when none is stored`, () => {
      const model = initializeDeepAgentModel(fakeConfig(preset, null));
      expect(model).toBeInstanceOf(ChatOpenAI);
      expect(openAiClientConfigOf(model).baseURL).toBe(DEFAULT_BASE_URLS[preset]);
    });
  }

  it("a stored base URL overrides the preset", () => {
    const model = initializeDeepAgentModel(fakeConfig("fireworks", null, "https://fireworks-proxy.example.com"));
    expect(openAiClientConfigOf(model).baseURL).toBe("https://fireworks-proxy.example.com");
  });
});
