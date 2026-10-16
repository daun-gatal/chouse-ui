import { describe, expect, it } from "vitest";

import { cachedShare, featureLabel, formatTokens, formatUsd, logsHoursCovering, providerLabel, queryLogsLink, requestCost, requestTokens } from "./lib";

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
