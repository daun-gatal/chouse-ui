import { describe, expect, it } from "bun:test";

import { headline } from "./text";

describe("headline", () => {
  it("keeps short text as it is", () => {
    expect(headline("Disk full", 200)).toBe("Disk full");
  });

  it("keeps text of exactly max characters", () => {
    const text = "a".repeat(200);
    expect(headline(text, 200)).toBe(text);
  });

  it("cuts at a word boundary and ends with an ellipsis", () => {
    const out = headline("Identifier 'q.hostname' cannot be resolved from table with name q", 40);
    expect(out).toBe("Identifier 'q.hostname' cannot be…");
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it("never returns more than max characters", () => {
    const text = "word ".repeat(400);
    for (const max of [1, 2, 10, 160, 200]) expect(Array.from(headline(text, max)).length).toBeLessThanOrEqual(max);
  });

  it("cuts a single long token mid-word instead of emptying it", () => {
    expect(headline(`see ${"x".repeat(300)}`, 20)).toBe(`see ${"x".repeat(15)}…`);
  });

  it("drops trailing punctuation before the ellipsis", () => {
    expect(headline("first part, second part, third part", 25)).toBe("first part, second part…");
  });

  it("uses the first non-empty line and collapses whitespace", () => {
    expect(headline("\n\n  Code: 47.   DB::Exception\n  SELECT 1\n", 200)).toBe("Code: 47. DB::Exception");
    expect(headline("a\r\nb", 200)).toBe("a");
  });

  it("returns an empty string for blank text", () => {
    expect(headline("", 200)).toBe("");
    expect(headline(" \n\t \n", 200)).toBe("");
  });

  it("counts characters, not UTF-16 units", () => {
    const out = headline("😀".repeat(50), 10);
    expect(out).toBe(`${"😀".repeat(9)}…`);
  });
});
