/**
 * The targeted re-ask loop: failing sections go back to the drafter on their
 * own, at most MAX_REDRAFT_ROUNDS times, and a section that keeps failing
 * comes back flagged instead of blank.
 */

import { describe, expect, it } from "bun:test";

import { MAX_REDRAFT_ROUNDS, type DraftRequest, type DraftResult, type SectionStatus } from "./drafting";
import { runDraft, type DraftCall } from "./draftRunner";

interface Input {
  prompt: string;
  tools: string[];
}

function status(state: SectionStatus["state"], problems: string[] = []): SectionStatus {
  return { state, reason: state === "empty" ? "On purpose" : null, problems, rationale: [] };
}

function result(input: Input, sections: Record<string, SectionStatus>, rounds = 1): DraftResult<Input> {
  return {
    kind: "agent",
    mode: "draft",
    input,
    sections,
    meta: { reasons: {}, rationale: {} },
    summary: "summary",
    fixes: [],
    problems: [],
    suggestedSkills: [],
    rounds,
  };
}

/** A fake drafter: answers each call with the next scripted result and records the request. */
function scripted(answers: Array<DraftResult<Input>>): { call: DraftCall; requests: Array<DraftRequest<Input>> } {
  const requests: Array<DraftRequest<Input>> = [];
  const call = (async (_featureId: string, request: DraftRequest<Input>) => {
    requests.push(request);
    const next = answers.shift();
    if (!next) throw new Error("No more scripted answers");
    return next;
  }) as DraftCall;
  return { call, requests };
}

describe("runDraft", () => {
  it("returns the first draft when every section passes", async () => {
    const { call, requests } = scripted([result({ prompt: "p", tools: ["a"] }, { prompt: status("drafted"), tools: status("drafted") })]);
    const out = await runDraft<Input>("agent", { goal: "Explain sizes" }, {}, call);
    expect(requests).toHaveLength(1);
    expect(out.rounds).toBe(1);
  });

  it("re-asks only for the failing sections, with the validator messages", async () => {
    const first = result({ prompt: "short", tools: ["a"] }, { prompt: status("attention", ["System prompt is too short"]), tools: status("drafted") });
    const fixed = result({ prompt: "a complete prompt", tools: ["a"] }, { prompt: status("drafted"), tools: status("drafted") });
    const { call, requests } = scripted([first, fixed]);
    const out = await runDraft<Input>("agent", { goal: "Explain sizes", agentHints: { featureId: null, delegate: "no" } }, {}, call);

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      sections: ["prompt"],
      feedback: { prompt: ["System prompt is too short"] },
      current: first.input,
      currentMeta: first.meta,
      agentHints: { featureId: null, delegate: "no" },
      goal: "Explain sizes",
    });
    expect(out.input.prompt).toBe("a complete prompt");
    expect(out.sections.prompt.state).toBe("drafted");
    expect(out.rounds).toBe(2);
    expect(out.mode).toBe("draft");
  });

  it("stops after the last round and returns the section flagged, not blank", async () => {
    const failing = (n: number): DraftResult<Input> => result({ prompt: `try ${n}`, tools: ["a"] }, { prompt: status("attention", ["No safety rules"]), tools: status("drafted") });
    const { call, requests } = scripted(Array.from({ length: MAX_REDRAFT_ROUNDS + 1 }, (_, i) => failing(i)));
    const out = await runDraft<Input>("agent", { goal: "Explain sizes" }, {}, call);

    expect(requests).toHaveLength(MAX_REDRAFT_ROUNDS + 1);
    expect(out.sections.prompt).toMatchObject({ state: "attention", problems: ["No safety rules"] });
    expect(out.input.prompt).toBe(`try ${MAX_REDRAFT_ROUNDS}`);
    expect(out.rounds).toBe(MAX_REDRAFT_ROUNDS + 1);
  });

  it("keeps a section empty on purpose without re-asking", async () => {
    const { call, requests } = scripted([result({ prompt: "p", tools: [] }, { prompt: status("drafted"), tools: status("empty") })]);
    const out = await runDraft<Input>("agent", { goal: "Explain sizes" }, {}, call);
    expect(requests).toHaveLength(1);
    expect(out.sections.tools).toMatchObject({ state: "empty", reason: "On purpose" });
  });
});
