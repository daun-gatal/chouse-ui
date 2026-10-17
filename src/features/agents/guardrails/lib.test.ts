import { describe, expect, it } from "vitest";

import type { Guardrail, GuardrailKindInfo } from "@/api/aiGuardrails";
import { allowedActions, appliesToAgent, blankGuardrail, kindStages, linesOf, listOf, moveId, uniqueSlug, withStages } from "./lib";

const PATTERN: GuardrailKindInfo = {
  label: "Pattern match", description: "",
  stages: { input: ["log", "warn", "redact", "block"], tool_call: ["log", "warn", "block"], tool_result: ["log", "warn", "redact", "block"], output: ["log", "warn", "redact", "block"] },
};
const SQL: GuardrailKindInfo = { label: "SQL safety", description: "", stages: { tool_call: ["log", "warn", "block"] } };

describe("guardrails lib", () => {
  it("lists a kind's stages in run order and the actions every chosen stage allows", () => {
    expect(kindStages(PATTERN)).toEqual(["input", "tool_call", "tool_result", "output"]);
    expect(allowedActions(PATTERN, ["tool_result", "tool_call"])).toEqual(["log", "warn", "block"]);
    expect(allowedActions(PATTERN, [])).toEqual([]);
  });

  it("starts a new guardrail in shadow mode after the others", () => {
    const blank = blankGuardrail("sql", SQL, [{ position: 40 } as Guardrail, { position: 70 } as Guardrail]);
    expect(blank).toEqual(expect.objectContaining({ stages: ["tool_call"], action: "block", mode: "shadow", position: 80 }));
    expect(blankGuardrail("pattern", PATTERN, []).action).toBe("redact");
  });

  it("keeps the action valid and drops MCP without the tool result stage", () => {
    const base = { ...blankGuardrail("pattern", PATTERN, []), stages: ["tool_result" as const], scope: { agents: "all" as const, features: "all" as const, mcp: true } };
    const next = withStages(base, PATTERN, ["tool_call"]);
    expect(next.action).toBe("block");
    expect(next.scope.mcp).toBe(false);
    expect(withStages(base, PATTERN, ["output", "input"]).stages).toEqual(["input", "output"]);
  });

  it("makes unique slugs", () => {
    expect(uniqueSlug("Employee IDs!", ["employee-ids"])).toBe("employee-ids-2");
    expect(uniqueSlug("", [])).toBe("guardrail");
  });

  it("matches agents in scope", () => {
    expect(appliesToAgent({ enabled: true, scope: { agents: "all", features: "all", mcp: false } }, "a")).toBe(true);
    expect(appliesToAgent({ enabled: true, scope: { agents: ["b"], features: "all", mcp: false } }, "a")).toBe(false);
    expect(appliesToAgent({ enabled: false, scope: { agents: "all", features: "all", mcp: false } }, "a")).toBe(false);
  });

  it("round-trips line lists and moves ids", () => {
    expect(listOf(linesOf([" a ", "b"]).concat("\n\n c"))).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveId(["a", "b"], "a", "x")).toEqual(["a", "b"]);
  });
});
