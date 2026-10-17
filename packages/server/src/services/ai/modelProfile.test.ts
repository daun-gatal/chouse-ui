import { describe, expect, it } from "bun:test";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { computeSummarizationDefaults, createDeepAgent } from "deepagents";
import { createMiddleware, type AgentMiddleware } from "langchain";

import { applyContextWindow, profileContextWindow } from "./modelProfile";
import { detectProfileContextWindow } from "../aiConfig";

describe("model context window", () => {
  it("reads LangChain's profile for known models", () => {
    expect(profileContextWindow(new ChatOpenAI({ model: "gpt-4o", apiKey: "x" }))).toBe(128_000);
    expect(detectProfileContextWindow("openai", "gpt-4o")).toBe(128_000);
  });

  it("reports unknown models as null", () => {
    expect(profileContextWindow(new ChatOpenAI({ model: "my-local-llm", apiKey: "x" }))).toBeNull();
    expect(detectProfileContextWindow("openai-compatible", "my-local-llm", "http://localhost:8000/v1")).toBeNull();
    expect(detectProfileContextWindow("ollama", "llama3.1:8b")).toBeNull();
  });

  it("refuses a model with no window from either source", () => {
    expect(() => applyContextWindow(new ChatOpenAI({ model: "my-local-llm", apiKey: "x" }), undefined, "Local")).toThrow(/Set a context window for the AI model 'Local'/);
  });

  it("keeps a known profile when no window is configured", () => {
    const model = applyContextWindow(new ChatOpenAI({ model: "gpt-4o", apiKey: "x" }), undefined, "GPT");
    expect(profileContextWindow(model)).toBe(128_000);
  });

  it("puts the configured window on this instance only", () => {
    const model = applyContextWindow(new ChatOpenAI({ model: "my-local-llm", apiKey: "x" }), 32_768, "Local");
    expect(profileContextWindow(model)).toBe(32_768);
    expect(profileContextWindow(new ChatOpenAI({ model: "my-local-llm", apiKey: "x" }))).toBeNull();
    // Overrides a known profile too.
    expect(profileContextWindow(applyContextWindow(new ChatOpenAI({ model: "gpt-4o", apiKey: "x" }), 64_000, "GPT"))).toBe(64_000);
  });

  it("switches DeepAgents to fraction-based summarization", () => {
    const model = applyContextWindow(new ChatOpenAI({ model: "my-local-llm", apiKey: "x" }), 32_768, "Local");
    expect(computeSummarizationDefaults(model as never).trigger).toEqual({ type: "fraction", value: 0.85 });
  });

  // Guard against a DeepAgents/LangChain upgrade that stops handing middleware
  // the configured instance (the summarizer reads request.model.profile). A
  // real ChatOpenAI matters: its bindTools builds a new instance, which a fake
  // returning `this` would hide.
  it("reaches DeepAgents middleware as request.model on a real provider model", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({
        id: "x", object: "chat.completion", created: 0, model: "my-local-llm",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "done" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });
    try {
      const model = applyContextWindow(new ChatOpenAI({ model: "my-local-llm", apiKey: "x", configuration: { baseURL: `http://localhost:${server.port}/v1` } }), 32_768, "Local");
      const seen: Array<number | null> = [];
      const capture = createMiddleware({
        name: "CaptureProfile",
        wrapModelCall: async (request, handler) => {
          seen.push(profileContextWindow(request.model as object));
          return handler(request);
        },
      }) as AgentMiddleware;
      const agent = createDeepAgent({ model: model as never, middleware: [capture] });
      await agent.invoke({ messages: [new HumanMessage("hi")] });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((value) => value === 32_768)).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});
