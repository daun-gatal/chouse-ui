import { describe, expect, it } from "vitest";

import { caseFromConsole, caseProblems, caseSummary, isRunning, parseToolList, percent, thresholdFromPercent, uniqueInOrder } from "./lib";

describe("evals lib", () => {
  it("keeps tool names once, in order", () => {
    expect(uniqueInOrder(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
    expect(parseToolList(" list_tables,run_select_query\nlist_tables ")).toEqual(["list_tables", "run_select_query"]);
    expect(parseToolList("")).toEqual([]);
  });

  it("reads the threshold as a percentage", () => {
    expect(thresholdFromPercent("80")).toBe(0.8);
    expect(thresholdFromPercent(" ")).toBeNull();
    expect(thresholdFromPercent("0")).toBe("invalid");
    expect(thresholdFromPercent("101")).toBe("invalid");
    expect(thresholdFromPercent("abc")).toBe("invalid");
    expect(percent(0.756)).toBe("76%");
    expect(percent(null)).toBe("—");
  });

  it("summarizes what a case asks", () => {
    expect(caseSummary({ kind: "chat", input: { messages: [{ role: "user", content: "first" }, { role: "assistant", content: "x" }, { role: "user", content: "last" }] } })).toBe("last");
    expect(caseSummary({ kind: "feature", input: { query: "SELECT 1" } })).toBe('{"query":"SELECT 1"}');
  });

  it("turns a console run into a case", () => {
    expect(caseFromConsole({ kind: "chat", message: "How many tables?", tools: ["list_tables", "list_tables", "run_select_query"] })).toEqual({
      name: "How many tables?", kind: "chat", input: { messages: [{ role: "user", content: "How many tables?" }] }, expectedTools: ["list_tables", "run_select_query"], rubric: null,
    });
    expect(caseFromConsole({ kind: "feature", featureId: "debug-query", featureTitle: "Debug query", input: { query: "SELEC 1" }, tools: [] })).toMatchObject({ name: "Debug query case", kind: "feature", featureId: "debug-query" });
  });

  it("explains what a case draft is missing", () => {
    expect(caseProblems({ name: "", kind: "chat", message: "", inputText: "", featureId: null })).toEqual(["Give the case a name.", "Write the message the agent gets."]);
    expect(caseProblems({ name: "x", kind: "feature", message: "", inputText: "[1]", featureId: null })).toEqual(["Pick the feature.", "The feature input is a JSON object."]);
    expect(caseProblems({ name: "x", kind: "feature", message: "", inputText: "{", featureId: "f" })).toEqual(["The feature input is not valid JSON."]);
    expect(caseProblems({ name: "x", kind: "chat", message: "hi", inputText: "", featureId: null })).toEqual([]);
  });

  it("knows a running run", () => {
    expect(isRunning({ status: "running" })).toBe(true);
    expect(isRunning({ status: "completed" })).toBe(false);
    expect(isRunning(null)).toBe(false);
  });
});
