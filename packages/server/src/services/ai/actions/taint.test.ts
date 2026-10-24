import { describe, expect, it } from "bun:test";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

import { EMPTY_ANSWER_NUDGE } from "../runtime/internalMessages";
import { turnIsTainted, UNTRUSTED_RESULT_TOOLS } from "./taint";

const tool = (name: string): ToolMessage => new ToolMessage({ content: "{}", tool_call_id: `c-${name}`, name });

describe("untrusted data in a turn (ADR 0025)", () => {
  it("is tainted once the turn read rows, other people's text or another agent's summary", () => {
    for (const name of ["run_select_query", "get_table_sample", "audit_log", "task", "js_eval"]) {
      expect(UNTRUSTED_RESULT_TOOLS.has(name)).toBe(true);
      expect(turnIsTainted([new HumanMessage("go"), new AIMessage("x"), tool(name)])).toBe(true);
    }
  });

  it("is not tainted by schema reads", () => {
    expect(turnIsTainted([new HumanMessage("go"), tool("list_tables"), tool("get_table_schema")])).toBe(false);
  });

  it("only counts the current turn: the person speaking again resets it", () => {
    expect(turnIsTainted([new HumanMessage("first"), tool("run_select_query"), new AIMessage("a"), new HumanMessage("now save it")])).toBe(false);
  });

  it("does not let CHouse's own nudge reset it", () => {
    expect(turnIsTainted([new HumanMessage("go"), tool("run_select_query"), new HumanMessage(EMPTY_ANSWER_NUDGE)])).toBe(true);
  });

  it("reads plain message objects too", () => {
    expect(turnIsTainted([{ role: "user", content: "go" }, { type: "tool", name: "get_slow_queries" }])).toBe(true);
    expect(turnIsTainted([])).toBe(false);
  });
});
