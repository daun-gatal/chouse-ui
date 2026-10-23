import { describe, expect, it } from "vitest";

import { argRows, argsToText, expiresIn, formatCountdown, parseArgsText } from "./aiApprovals";

describe("formatCountdown", () => {
  it("shows minutes and seconds, hours when long, and never goes negative", () => {
    expect(formatCountdown(14 * 60_000 + 5_000)).toBe("14:05");
    expect(formatCountdown(999)).toBe("0:01");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
    expect(formatCountdown(3_600_000 + 61_000)).toBe("1:01:01");
  });
});

describe("expiresIn", () => {
  it("rounds to the largest unit and says when it expired", () => {
    expect(expiresIn(10 + 3 * 3_600_000 + 5, 10)).toBe("in 3h");
    expect(expiresIn(12 * 60_000 + 500, 0)).toBe("in 12m");
    expect(expiresIn(40_000, 0)).toBe("in 40s");
    expect(expiresIn(5, 5)).toBe("expired");
  });
});

describe("parseArgsText", () => {
  it("round-trips the arguments it shows", () => {
    const args = { queryId: "q1", panels: [{ title: "x" }] };
    expect(parseArgsText(argsToText(args))).toEqual({ ok: true, args });
  });

  it("refuses broken JSON and anything but an object", () => {
    expect(parseArgsText("{")).toEqual({ ok: false, error: "Not valid JSON." });
    expect(parseArgsText("[1]")).toMatchObject({ ok: false });
    expect(parseArgsText("null")).toMatchObject({ ok: false });
    expect(parseArgsText('"q1"')).toMatchObject({ ok: false });
  });
});

describe("argRows", () => {
  it("drops empty values, shows objects as JSON and cuts long values", () => {
    expect(argRows({ queryId: "q1", empty: "", none: null, hour: 6, tags: ["a"], sql: "x".repeat(20) }, 10)).toEqual([
      ["queryId", "q1"],
      ["hour", "6"],
      ["tags", '["a"]'],
      ["sql", `${"x".repeat(9)}…`],
    ]);
  });
});
