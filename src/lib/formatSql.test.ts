import { describe, it, expect } from "vitest";
import { formatClickHouseSQL } from "./formatSql";

describe("formatClickHouseSQL", () => {
  it("returns empty string for empty input", () => {
    expect(formatClickHouseSQL("")).toBe("");
  });

  it("preserves the case of case-sensitive ClickHouse functions and identifiers", () => {
    const out = formatClickHouseSQL(
      "select toStartOfInterval(ts, INTERVAL 1 HOUR), argMax(value, ts), JSONExtractString(p, 'k') from db.events",
    );
    // ClickHouse is case-sensitive — these must NOT be uppercased.
    expect(out).toContain("toStartOfInterval");
    expect(out).toContain("argMax");
    expect(out).toContain("JSONExtractString");
    expect(out).not.toContain("TOSTARTOFINTERVAL");
    expect(out).not.toContain("ARGMAX");
  });

  it("preserves aliases that the dialect would otherwise treat as keywords (e.g. `h`)", () => {
    const out = formatClickHouseSQL("select a.userId as h from t as a group by h");
    expect(out).toContain("as h");
    expect(out).toContain("a.userId");
    // The single-letter alias must stay lowercase (was previously uppercased to H).
    expect(out).not.toMatch(/\bas H\b/);
  });

  it("still pretty-prints: one major clause per line", () => {
    const out = formatClickHouseSQL("select a, b from t where a > 1");
    expect(out).toMatch(/select[\s\S]*\n\s+a/i);
    expect(out.split("\n").length).toBeGreaterThan(1);
  });

  it("falls back to the trimmed input on unparseable SQL", () => {
    const garbage = "  )))not valid sql(((  ";
    expect(formatClickHouseSQL(garbage)).toBe(garbage.trim());
  });
});
