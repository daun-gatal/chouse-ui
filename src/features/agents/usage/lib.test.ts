import { describe, expect, it, vi } from "vitest";

import type { AiUsageStep } from "@/api/aiUsage";

import { buildTimeline, cachedShare, featureLabel, formatOffset, OPEN_CHAT_THREAD_EVENT, openChatThread, plural, requestOrigin, formatTokens, formatUsd, logsHoursCovering, providerLabel, queryLogsLink, requestCost, requestTokens } from "./lib";

describe("formatUsd", () => {
  it("shows unknown cost as a dash, never $0", () => {
    expect(formatUsd(null)).toBe("–");
    expect(formatUsd(undefined)).toBe("–");
    expect(formatUsd(Number.NaN)).toBe("–");
  });

  it("formats real amounts, and tiny ones as <$0.01", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(0.31)).toBe("$0.31");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});

describe("formatTokens", () => {
  it("abbreviates", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(22_900)).toBe("22.9k");
    expect(formatTokens(3_200_000)).toBe("3.2M");
    expect(formatTokens(4_100_000_000)).toBe("4.1B");
  });
});

describe("request totals", () => {
  it("marks token counts a lower bound when a call reported nothing", () => {
    expect(requestTokens({ inputTokens: 3_000, outputTokens: 100, incompleteCalls: 0 })).toBe("3.1k");
    expect(requestTokens({ inputTokens: 3_000, outputTokens: 100, incompleteCalls: 1 })).toBe("≥ 3.1k");
  });

  it("shows cost as unknown, exact, or a lower bound", () => {
    expect(requestCost({ costUsd: null, unpricedCalls: 2, incompleteCalls: 0 })).toBe("–");
    expect(requestCost({ costUsd: 0.31, unpricedCalls: 0, incompleteCalls: 0 })).toBe("$0.31");
    expect(requestCost({ costUsd: 0.31, unpricedCalls: 1, incompleteCalls: 0 })).toBe("≥ $0.31");
    expect(requestCost({ costUsd: 0.31, unpricedCalls: 0, incompleteCalls: 1 })).toBe("≥ $0.31");
  });
});

describe("labels", () => {
  it("names providers and features", () => {
    expect(providerLabel("anthropic")).toBe("Anthropic");
    expect(providerLabel("azure-openai")).toBe("Azure OpenAI");
    expect(providerLabel("acme")).toBe("acme");
    expect(providerLabel(null)).toBe("Unknown provider");
    expect(featureLabel("optimize-query")).toBe("Optimize query");
    expect(featureLabel("chat")).toBe("Chat");
    expect(featureLabel("")).toBe("AI feature");
  });
});

describe("query logs deep link", () => {
  it("links to one query around the time it ran", () => {
    expect(queryLogsLink("chouse-ai-r1-2", 1_700_000_000_000.4)).toBe("/monitoring/logs?q=chouse-ai-r1-2&at=1700000000000");
  });

  it("opens the smallest whole-hour window that covers the query", () => {
    const now = 1_700_000_000_000;
    expect(logsHoursCovering(String(now - 5 * 60_000), now)).toBe(1);
    expect(logsHoursCovering(String(now - 50 * 60_000), now)).toBe(2);
    expect(logsHoursCovering(String(now - 3 * 86_400_000), now)).toBe(73);
    expect(logsHoursCovering(String(now + 60_000), now)).toBe(1);
  });

  it("ignores a missing or bad `at`", () => {
    expect(logsHoursCovering(null)).toBeNull();
    expect(logsHoursCovering("soon")).toBeNull();
    expect(logsHoursCovering("-5")).toBeNull();
  });
});

describe("cachedShare", () => {
  it("is the cached percent of input, or null with no input", () => {
    expect(cachedShare(1_000, 380)).toBe(38);
    expect(cachedShare(0, 0)).toBeNull();
  });
});

describe("plural / requestOrigin", () => {
  it("pluralizes counts", () => {
    expect(plural(1, "row")).toBe("1 row");
    expect(plural(3, "row")).toBe("3 rows");
    expect(plural(12_000, "row", "12k")).toBe("12k rows");
  });

  it("names the feature only when it adds something", () => {
    expect(requestOrigin("chat", "chat")).toBe("Chat");
    expect(requestOrigin("feature", "optimize-query")).toBe("Feature · Optimize query");
    expect(requestOrigin("background", "doctor-scan")).toBe("Background · Doctor scan");
  });
});

function step(seq: number, kind: "llm" | "tool", agentPath: string | null, calls: AiUsageStep["calls"], startedAt = 1_000 + seq * 100): AiUsageStep {
  return {
    id: `s${seq}`, seq, kind, agentPath, name: kind === "llm" ? "m" : "list_users", modelConfigId: null, providerType: null, modelId: null,
    startedAt, durationMs: 10, status: "ok", usageReported: true, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    costUsd: null, chQueries: 0, chReadRows: 0, chReadBytes: 0, resultBytes: 0, queries: [], calls, error: null,
  };
}

describe("buildTimeline", () => {
  const A = "chouse-assistant";
  const B = `${A} › chouse-admin`;
  const C = `${B} › access-auditor`;

  it("numbers steps in start order, nests subagents and tools, and marks hand-offs, answers and the final answer", () => {
    const steps = [
      step(6, "llm", A, []),
      step(0, "llm", A, [{ tool: "task", agent: "chouse-admin" }]),
      step(1, "llm", B, [{ tool: "task", agent: "access-auditor" }]),
      step(2, "llm", C, [{ tool: "list_users" }]),
      step(3, "tool", C, null),
      step(4, "llm", C, []),
      step(5, "llm", B, []),
    ];
    const t = buildTimeline(steps, 1_000);
    expect(t.map((x) => [x.number, x.step.seq, x.depth, x.offsetMs])).toEqual([
      [1, 0, 0, 0], [2, 1, 1, 100], [3, 2, 2, 200], [4, 3, 3, 300], [5, 4, 2, 400], [6, 5, 1, 500], [7, 6, 0, 600],
    ]);
    expect(t.map((x) => x.flow)).toEqual([
      { kind: "handoff", agents: ["chouse-admin"] },
      { kind: "handoff", agents: ["access-auditor"] },
      { kind: "tools", tools: ["list_users"] },
      null,
      { kind: "answer", to: "chouse-admin" },
      { kind: "answer", to: "chouse-assistant" },
      { kind: "final" },
    ]);
  });

  it("leaves the flow out when calls weren't recorded, and caps indentation", () => {
    const deep = "a › b › c › d › e › f";
    const t = buildTimeline([step(0, "llm", "a", null), step(1, "llm", deep, [])], 1_000);
    expect(t[0].flow).toBeNull();
    expect(t[1].depth).toBe(4);
  });

  it("only marks the root agent's last call as the final answer", () => {
    const t = buildTimeline([step(0, "llm", "root", []), step(1, "tool", "root", null), step(2, "llm", "root", [])], 1_000);
    expect(t.map((x) => x.flow)).toEqual([null, null, { kind: "final" }]);
  });
});

describe("formatOffset", () => {
  it("shows seconds, then minutes", () => {
    expect(formatOffset(0)).toBe("+0.0s");
    expect(formatOffset(12_340)).toBe("+12.3s");
    expect(formatOffset(125_000)).toBe("+2m 05s");
  });
});

describe("openChatThread", () => {
  it("asks the chat bubble to open a thread", () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_CHAT_THREAD_EVENT, listener);
    openChatThread("t-1");
    window.removeEventListener(OPEN_CHAT_THREAD_EVENT, listener);
    expect((listener.mock.calls[0][0] as CustomEvent<{ threadId: string }>).detail).toEqual({ threadId: "t-1" });
  });
});
