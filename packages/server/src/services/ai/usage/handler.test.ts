import { describe, expect, it } from "bun:test";

import { toolCallsFromResult } from "./handler";

describe("toolCallsFromResult", () => {
  it("lists the tools a call asked for and names the subagent of a hand-off", () => {
    const result = {
      generations: [[{
        message: {
          tool_calls: [
            { name: "task", args: { description: "check", subagent_type: "chouse-admin" } },
            { name: "run_select_query", args: { sql: "SELECT 1" } },
            { name: "task", args: {} },
          ],
        },
      }]],
    };
    expect(toolCallsFromResult(result)).toEqual([{ tool: "task", agent: "chouse-admin" }, { tool: "run_select_query" }, { tool: "task" }]);
  });

  it("returns nothing for an answer or an unexpected shape", () => {
    expect(toolCallsFromResult({ generations: [[{ message: { content: "done", tool_calls: [] } }]] })).toEqual([]);
    expect(toolCallsFromResult({ generations: [] })).toEqual([]);
    expect(toolCallsFromResult(null)).toEqual([]);
    expect(toolCallsFromResult({ generations: [[{ message: { tool_calls: [null, { args: {} }] } }]] })).toEqual([]);
  });
});
