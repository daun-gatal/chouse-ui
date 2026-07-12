import { describe, expect, it, mock } from "bun:test";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { structuredOutput } from "./structuredOutput";

describe("structuredOutput", () => {
  it("forces function calling for ChatOpenAI-compatible models", async () => {
    const model = new ChatOpenAI({ apiKey: "test", model: "deepseek-chat" });
    const invoke = mock(async () => ({ answer: "ok" }));
    const withStructuredOutput = mock((_schema: z.ZodType<unknown>, _options?: { method?: string }) => ({ invoke }));
    Object.defineProperty(model, "withStructuredOutput", { value: withStructuredOutput });

    const result = await structuredOutput({
      model,
      schema: z.object({ answer: z.string() }),
      raw: "not json",
      fallbackMessages: [{ role: "user", content: "return an answer" }],
    });

    expect(result).toEqual({ answer: "ok" });
    expect(withStructuredOutput.mock.calls[0]?.[1]).toEqual({ method: "functionCalling" });
  });
});
