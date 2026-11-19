import { describe, expect, it } from "vitest";

import { OBJECT_PREVIEW_LENGTH, formatResultCell } from "./resultCells";

describe("formatResultCell", () => {
  it("keeps HTML-looking strings as plain text", () => {
    for (const value of ['é "q" <b>bold</b>', "a<b", "<img src=x onerror=alert(1)>", "&amp; &lt;", "<script>x</script>"]) {
      expect(formatResultCell(value)).toEqual({ text: value, className: "cell-string", title: value });
    }
  });

  it("shows NULL for null and undefined", () => {
    expect(formatResultCell(null)).toEqual({ text: "NULL", className: "cell-null", title: "NULL" });
    expect(formatResultCell(undefined).text).toBe("NULL");
  });

  it("does not round fractions to three digits", () => {
    expect(formatResultCell(1.23456789).text).toBe((1.23456789).toLocaleString(undefined, { maximumFractionDigits: 20 }));
    expect(formatResultCell(1.23456789).text).toContain("23456789");
    expect(formatResultCell(1.5e-7).text).toContain("00000015");
    expect(formatResultCell(-0.000123).text).toContain("000123");
  });

  it("keeps the exponent form for magnitudes too small to show in 20 digits", () => {
    expect(formatResultCell(5e-324).text).toBe("5e-324");
    expect(formatResultCell(-1e-25).text).toBe("-1e-25");
  });

  it("formats zero and integers with digit grouping and keeps the raw number in the title", () => {
    expect(formatResultCell(0).text).toBe((0).toLocaleString());
    expect(formatResultCell(1234567)).toEqual({
      text: (1234567).toLocaleString(undefined, { maximumFractionDigits: 20 }),
      className: "cell-number",
      title: "1234567",
    });
  });

  it("shows booleans as TRUE and FALSE", () => {
    expect(formatResultCell(true).text).toBe("TRUE");
    expect(formatResultCell(false).text).toBe("FALSE");
  });

  it("formats ISO date-times and keeps the raw value in the title", () => {
    const cell = formatResultCell("2026-11-19T05:04:07");
    expect(cell).toEqual({ text: "2026-11-19 05:04:07", className: "cell-date", title: "2026-11-19T05:04:07" });
  });

  it("falls back to the raw string for an ISO-looking value that is not a date", () => {
    expect(formatResultCell("2026-13-45T99:99:99 <b>")).toEqual({
      text: "2026-13-45T99:99:99 <b>",
      className: "cell-string",
      title: "2026-13-45T99:99:99 <b>",
    });
  });

  it("does not throw for an invalid Date object", () => {
    expect(formatResultCell(new Date("not a date")).className).toBe("cell-string");
  });

  it("leaves ClickHouse's space-separated DateTime strings as they are", () => {
    expect(formatResultCell("2026-11-19 05:04:07")).toEqual({
      text: "2026-11-19 05:04:07",
      className: "cell-string",
      title: "2026-11-19 05:04:07",
    });
  });

  it("previews objects as truncated JSON with the full JSON in the title", () => {
    const value = { device: { name: "<b>fw</b>" }, list: Array.from({ length: 20 }, (_, i) => i) };
    const cell = formatResultCell(value);

    expect(cell.className).toBe("cell-object-preview");
    expect(cell.text).toBe(`${JSON.stringify(value).substring(0, OBJECT_PREVIEW_LENGTH)}...`);
    expect(cell.title).toBe(JSON.stringify(value, null, 2));
    expect(formatResultCell([1, 2]).text).toBe("[1,2]");
  });
});
