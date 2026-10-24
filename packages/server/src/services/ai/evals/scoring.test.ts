import { describe, expect, it } from "bun:test";

import { parseJudgeAnswer } from "./judge";
import { agentDraftHash, casePassed, matchToolSequence, runScore } from "./scoring";

describe("matchToolSequence", () => {
  it("accepts the expected tools in order, with other calls between", () => {
    expect(matchToolSequence(["list_tables", "run_select_query"], ["list_databases", "list_tables", "get_table_schema", "run_select_query"])).toEqual({ ok: true, missing: [] });
    expect(matchToolSequence([], ["anything"])).toEqual({ ok: true, missing: [] });
  });

  it("reports what is missing from the first tool not found", () => {
    expect(matchToolSequence(["run_select_query", "list_tables"], ["list_tables", "run_select_query"])).toEqual({ ok: false, missing: ["list_tables"] });
    expect(matchToolSequence(["a", "b", "c"], ["a"])).toEqual({ ok: false, missing: ["b", "c"] });
  });

  it("needs a repeated tool to be called as often as expected", () => {
    expect(matchToolSequence(["q", "q"], ["q"]).ok).toBe(false);
    expect(matchToolSequence(["q", "q"], ["q", "x", "q"]).ok).toBe(true);
  });
});

describe("agentDraftHash", () => {
  const agent = {
    id: "a1", slug: "data", name: "Data", description: "x", kind: "agent", systemPrompt: "Be precise", taskTemplate: null, modelConfigId: null, harnessId: "h",
    tuning: { stepBudget: 10, memory: false, evalThreshold: 0.8 }, requiredPermissions: [], tools: ["list_tables"], skills: [], subagents: [], enabled: true,
  };

  it("depends on behaviour, not on key order, names or the threshold", () => {
    const reordered = Object.fromEntries(Object.entries(agent).reverse());
    expect(agentDraftHash(reordered)).toBe(agentDraftHash(agent));
    expect(agentDraftHash({ ...agent, name: "Renamed", description: "y", version: 9 })).toBe(agentDraftHash(agent));
    expect(agentDraftHash({ ...agent, tuning: { ...agent.tuning, evalThreshold: 0.5 } })).toBe(agentDraftHash(agent));
  });

  it("changes with the prompt, tools or tuning", () => {
    expect(agentDraftHash({ ...agent, systemPrompt: "Be brief" })).not.toBe(agentDraftHash(agent));
    expect(agentDraftHash({ ...agent, tools: ["list_tables", "run_select_query"] })).not.toBe(agentDraftHash(agent));
    expect(agentDraftHash({ ...agent, tuning: { ...agent.tuning, stepBudget: 11 } })).not.toBe(agentDraftHash(agent));
  });
});

describe("case and run scores", () => {
  it("passes a case that ran, called its tools and met its rubric", () => {
    expect(casePassed({ toolsOk: true, judgePass: true, error: null })).toBe(true);
    expect(casePassed({ toolsOk: null, judgePass: null, error: null })).toBe(true);
    expect(casePassed({ toolsOk: false, judgePass: true, error: null })).toBe(false);
    expect(casePassed({ toolsOk: true, judgePass: false, error: null })).toBe(false);
    expect(casePassed({ toolsOk: null, judgePass: null, error: "boom" })).toBe(false);
  });

  it("scores a run as the share of cases passed", () => {
    expect(runScore(3, 4)).toBe(0.75);
    expect(runScore(0, 0)).toBeNull();
  });
});

describe("parseJudgeAnswer", () => {
  it("reads the verdict from surrounding text", () => {
    expect(parseJudgeAnswer('Sure: {"pass": true, "reason": "Covers both points"} done')).toEqual({ pass: true, reason: "Covers both points" });
    expect(parseJudgeAnswer('{"pass": false}')).toEqual({ pass: false, reason: "" });
  });

  it("refuses an answer without a verdict", () => {
    expect(() => parseJudgeAnswer("no json")).toThrow("did not answer with JSON");
    expect(() => parseJudgeAnswer('{"pass": "yes"}')).toThrow("no 'pass' verdict");
  });
});
