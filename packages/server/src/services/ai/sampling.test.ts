import { describe, it, expect } from "bun:test";
import { acceptsSampling, samplingFields } from "./sampling";

describe("acceptsSampling · Claude", () => {
  it("accepts the 4.6 generation and older", () => {
    for (const id of [
      "claude-sonnet-4-6",
      "claude-opus-4-6",
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-1",
      "claude-opus-4-20250514",
      "claude-sonnet-4-0",
      "claude-3-5-sonnet-20241022",
      "claude-3-haiku-20240307",
      "claude-2.1",
      "claude-instant-1.2",
      "claude-opus-4-5@20251101",
    ]) {
      expect(acceptsSampling(id)).toBe(true);
    }
  });

  it("rejects every later generation", () => {
    for (const id of [
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-opus-5",
      "claude-opus-5-5",
      "claude-sonnet-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-fable-5-1",
      "claude-mythos-5-1",
      "claude-opus-6",
    ]) {
      expect(acceptsSampling(id)).toBe(false);
    }
  });

  it("treats an unrecognized Claude id as a new model", () => {
    expect(acceptsSampling("claude-latest")).toBe(false);
  });

  it("reads Claude ids behind Bedrock and OpenRouter prefixes", () => {
    expect(acceptsSampling("anthropic.claude-3-5-sonnet-20240620-v1:0")).toBe(true);
    expect(acceptsSampling("us.anthropic.claude-sonnet-4-6-v1:0")).toBe(true);
    expect(acceptsSampling("global.anthropic.claude-opus-5-5")).toBe(false);
    expect(acceptsSampling("anthropic.claude-haiku-5-5-v1:0")).toBe(false);
    expect(acceptsSampling("anthropic/claude-sonnet-5-5")).toBe(false);
    expect(acceptsSampling("Anthropic/Claude-Opus-4-6")).toBe(true);
  });
});

describe("acceptsSampling · OpenAI", () => {
  it("rejects reasoning models", () => {
    for (const id of ["o1", "o3-mini", "o4-mini", "gpt-5", "gpt-5-mini", "gpt-5.1", "openai/gpt-5"]) {
      expect(acceptsSampling(id)).toBe(false);
    }
  });

  it("accepts chat models", () => {
    for (const id of ["gpt-4o", "gpt-4.1-mini", "gpt-5-chat-latest", "gpt-oss-120b", "openai/gpt-oss-20b"]) {
      expect(acceptsSampling(id)).toBe(true);
    }
  });
});

describe("acceptsSampling · other providers", () => {
  it("accepts models outside the Claude and OpenAI reasoning families", () => {
    for (const id of ["gemini-2.5-pro", "mistral-large-latest", "llama3.1:8b", "grok-4", "deepseek-reasoner", "command-r-plus"]) {
      expect(acceptsSampling(id)).toBe(true);
    }
  });
});

describe("samplingFields", () => {
  it("passes configured values and the temperature default through", () => {
    expect(samplingFields({ topP: 0.9 }, "gpt-4o")).toEqual({
      temperature: 0,
      topP: 0.9,
      topK: undefined,
      frequencyPenalty: undefined,
      presencePenalty: undefined,
    });
    expect(samplingFields({ temperature: 0.4 }, "gpt-4o").temperature).toBe(0.4);
  });

  it("honours an absent default", () => {
    expect(samplingFields({}, "claude-sonnet-4-6", null).temperature).toBeUndefined();
  });

  it("returns nothing for a model that rejects sampling", () => {
    expect(samplingFields({ temperature: 0.4, topP: 0.9, topK: 10 }, "claude-haiku-5-5")).toEqual({});
  });
});
