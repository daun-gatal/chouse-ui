import { describe, it, expect } from "bun:test";
import { handleAiError } from "./errors";
import { AppError } from "../../types";

function captured(fn: () => never): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
}

describe("handleAiError", () => {
  it("maps a LangGraph recursion-limit message to a friendly, actionable error", () => {
    const error = captured(() =>
      handleAiError(new Error("Recursion limit of 40 reached without hitting a stop condition."), "AI:test"),
    );
    expect(error.message).toContain("step limit");
    expect(error.message).toContain("Recursion limit");
    expect(error.statusCode).toBe(400);
  });

  it("maps the GRAPH_RECURSION_LIMIT lc_error_code even with an unexpected message", () => {
    const graphError = Object.assign(new Error("something opaque"), { lc_error_code: "GRAPH_RECURSION_LIMIT" });
    const error = captured(() => handleAiError(graphError, "AI:test"));
    expect(error.message).toContain("Recursion limit");
  });

  it("keeps rate-limit mapping intact", () => {
    const error = captured(() => handleAiError(new Error("rate limit exceeded"), "AI:test"));
    expect(error.message).toContain("rate limit");
  });

  it("falls through to the generic provider error", () => {
    const error = captured(() => handleAiError(new Error("boom"), "AI:test"));
    expect(error.message).toContain("AI provider error: boom");
  });

  it("re-throws AppError untouched", () => {
    const original = AppError.badRequest("custom");
    const error = captured(() => handleAiError(original, "AI:test"));
    expect(error).toBe(original);
  });
});
