import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import {
  clearStructuredOutputStrategyCache,
  structuredOutput,
} from "./structuredOutput";

const OutputSchema = z.object({ answer: z.string() });

interface StatusError extends Error {
  status: number;
}

function providerError(message: string, status: number): StatusError {
  return Object.assign(new Error(message), { status });
}

function baseOptions(model: ChatOpenAI) {
  return {
    model,
    schema: OutputSchema,
    raw: "not json",
    fallbackMessages: [{ role: "user" as const, content: "return an answer" }],
  };
}

describe("structuredOutput", () => {
  beforeEach(() => {
    clearStructuredOutputStrategyCache();
  });

  it("returns schema-valid raw JSON without another model call", async () => {
    const model = new ChatOpenAI({ apiKey: "test", model: "unused" });
    const invoke = mock(async () => ({ content: "unused" }));
    Object.defineProperty(model, "invoke", { value: invoke });

    const result = await structuredOutput({
      ...baseOptions(model),
      raw: '{"answer":"raw"}',
    });

    expect(result).toEqual({ answer: "raw" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("lets the adapter choose its preferred method in auto mode", async () => {
    const model = new ChatOpenAI({ apiKey: "test", model: "gateway-model" });
    const invoke = mock(async () => ({ answer: "adapter" }));
    const withStructuredOutput = mock((_schema: z.ZodType<unknown>, _options?: { method?: string }) => ({ invoke }));
    Object.defineProperty(model, "withStructuredOutput", { value: withStructuredOutput });

    const result = await structuredOutput(baseOptions(model));

    expect(result).toEqual({ answer: "adapter" });
    expect(withStructuredOutput.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("falls back from an unsupported adapter method to tool calling", async () => {
    const model = new ChatOpenAI({ apiKey: "test", model: "gateway-model" });
    const methods: Array<string | undefined> = [];
    const withStructuredOutput = mock((_schema: z.ZodType<unknown>, options?: { method?: string }) => {
      methods.push(options?.method);
      return {
        invoke: async () => {
          if (options?.method === undefined) throw providerError("response_format unsupported", 400);
          return { answer: "tool" };
        },
      };
    });
    Object.defineProperty(model, "withStructuredOutput", { value: withStructuredOutput });

    const result = await structuredOutput(baseOptions(model));

    expect(result).toEqual({ answer: "tool" });
    expect(methods).toEqual([undefined, "functionCalling"]);
  });

  it("uses plain JSON repair after schema-invalid structured output", async () => {
    const model = new ChatOpenAI({ apiKey: "test", model: "gateway-model" });
    const methods: Array<string | undefined> = [];
    const withStructuredOutput = mock((_schema: z.ZodType<unknown>, options?: { method?: string }) => {
      methods.push(options?.method);
      return { invoke: async () => ({ answer: 42 }) };
    });
    const repairInvoke = mock(async () => ({ content: '```json\n{"answer":"repaired"}\n```' }));
    Object.defineProperty(model, "withStructuredOutput", { value: withStructuredOutput });
    Object.defineProperty(model, "invoke", { value: repairInvoke });

    const result = await structuredOutput(baseOptions(model));

    expect(result).toEqual({ answer: "repaired" });
    expect(methods).toEqual([undefined]);
    const repairMessages = repairInvoke.mock.calls[0]?.[0];
    expect(repairMessages.at(-1)?.content).toContain("JSON Schema");
    expect(repairMessages.at(-1)?.content).toContain('"answer"');
  });

  it("does not cascade transient provider failures into billed fallback calls", async () => {
    const model = new ChatOpenAI({ apiKey: "test", model: "gateway-model" });
    const withStructuredOutput = mock(() => ({
      invoke: async () => {
        throw providerError("failed to parse upstream rate-limit response", 429);
      },
    }));
    const repairInvoke = mock(async () => ({ content: '{"answer":"unexpected"}' }));
    Object.defineProperty(model, "withStructuredOutput", { value: withStructuredOutput });
    Object.defineProperty(model, "invoke", { value: repairInvoke });

    await expect(structuredOutput(baseOptions(model))).rejects.toThrow("failed to parse upstream");
    expect(withStructuredOutput).toHaveBeenCalledTimes(1);
    expect(repairInvoke).not.toHaveBeenCalled();
  });

  it("does not cascade authentication failures into fallback calls", async () => {
    const model = new ChatOpenAI({ apiKey: "test", model: "gateway-model" });
    const withStructuredOutput = mock(() => ({
      invoke: async () => {
        throw providerError("API key is invalid", 401);
      },
    }));
    const repairInvoke = mock(async () => ({ content: '{"answer":"unexpected"}' }));
    Object.defineProperty(model, "withStructuredOutput", { value: withStructuredOutput });
    Object.defineProperty(model, "invoke", { value: repairInvoke });

    await expect(structuredOutput(baseOptions(model))).rejects.toThrow("API key is invalid");
    expect(withStructuredOutput).toHaveBeenCalledTimes(1);
    expect(repairInvoke).not.toHaveBeenCalled();
  });

  it("honors explicit native, tool, json, and plain policies", async () => {
    const expectedMethods = new Map([
      ["native", "jsonSchema"],
      ["tool", "functionCalling"],
      ["json", "jsonMode"],
    ]);

    for (const [policy, expectedMethod] of expectedMethods) {
      const model = new ChatOpenAI({ apiKey: "test", model: `${policy}-model` });
      const withStructuredOutput = mock((_schema: z.ZodType<unknown>, options?: { method?: string }) => ({
        invoke: async () => ({ answer: options?.method ?? "missing" }),
      }));
      Object.defineProperty(model, "withStructuredOutput", { value: withStructuredOutput });

      const result = await structuredOutput({
        ...baseOptions(model),
        policy: policy === "native" || policy === "tool" || policy === "json" ? policy : "auto",
      });

      expect(result).toEqual({ answer: expectedMethod });
      expect(withStructuredOutput.mock.calls[0]?.[1]?.method).toBe(expectedMethod);
    }

    const plainModel = new ChatOpenAI({ apiKey: "test", model: "plain-model" });
    const withStructuredOutput = mock(() => ({ invoke: async () => ({ answer: "unexpected" }) }));
    const plainInvoke = mock(async () => ({ content: '{"answer":"plain"}' }));
    Object.defineProperty(plainModel, "withStructuredOutput", { value: withStructuredOutput });
    Object.defineProperty(plainModel, "invoke", { value: plainInvoke });

    const plainResult = await structuredOutput({ ...baseOptions(plainModel), policy: "plain" });
    expect(plainResult).toEqual({ answer: "plain" });
    expect(withStructuredOutput).not.toHaveBeenCalled();
  });

  it("repairs JSON when the adapter has no structured-output API", async () => {
    const model = new ChatOpenAI({ apiKey: "test", model: "basic-model" });
    const repairInvoke = mock(async () => ({ content: '{"answer":"plain"}' }));
    Object.defineProperty(model, "withStructuredOutput", { value: undefined });
    Object.defineProperty(model, "invoke", { value: repairInvoke });

    const result = await structuredOutput(baseOptions(model));

    expect(result).toEqual({ answer: "plain" });
    expect(repairInvoke).toHaveBeenCalledTimes(1);
  });

  it("caches a successful auto strategy for the versioned model key", async () => {
    const model = new ChatOpenAI({ apiKey: "test", model: "gateway-model" });
    const methods: Array<string | undefined> = [];
    const withStructuredOutput = mock((_schema: z.ZodType<unknown>, options?: { method?: string }) => {
      methods.push(options?.method);
      return {
        invoke: async () => {
          if (options?.method === undefined) throw providerError("response_format unsupported", 400);
          return { answer: "tool" };
        },
      };
    });
    Object.defineProperty(model, "withStructuredOutput", { value: withStructuredOutput });

    const opts = { ...baseOptions(model), strategyCacheKey: "provider:model:v1" };
    expect(await structuredOutput(opts)).toEqual({ answer: "tool" });
    expect(await structuredOutput(opts)).toEqual({ answer: "tool" });
    expect(methods).toEqual([undefined, "functionCalling", "functionCalling"]);
  });

  it("renegotiates an auto strategy after its cache entry expires", async () => {
    const originalNow = Date.now;
    let now = 1_000;
    Object.defineProperty(Date, "now", { configurable: true, value: () => now });
    try {
      const model = new ChatOpenAI({ apiKey: "test", model: "gateway-model" });
      const methods: Array<string | undefined> = [];
      const withStructuredOutput = mock((_schema: z.ZodType<unknown>, options?: { method?: string }) => {
        methods.push(options?.method);
        return {
          invoke: async () => {
            if (options?.method === undefined) throw providerError("response_format unsupported", 400);
            return { answer: "tool" };
          },
        };
      });
      Object.defineProperty(model, "withStructuredOutput", { value: withStructuredOutput });

      const opts = { ...baseOptions(model), strategyCacheKey: "provider:model:v1" };
      expect(await structuredOutput(opts)).toEqual({ answer: "tool" });
      expect(await structuredOutput(opts)).toEqual({ answer: "tool" });
      now += 16 * 60_000;
      expect(await structuredOutput(opts)).toEqual({ answer: "tool" });

      expect(methods).toEqual([
        undefined,
        "functionCalling",
        "functionCalling",
        undefined,
        "functionCalling",
      ]);
    } finally {
      Object.defineProperty(Date, "now", { configurable: true, value: originalNow });
    }
  });
});
