import { describe, expect, it } from "vitest";

import { memoryExportFile, savedMemories } from "./aiMemories";

describe("savedMemories", () => {
  it("keeps successful remember calls once, from objects or JSON strings", () => {
    const saved = { saved: true, memoryId: "m1", scope: "user", status: "active", note: "Prefers UTC" };
    expect(savedMemories([
      { name: "list_tables", result: { rows: [] } },
      { name: "remember", result: saved },
      { name: "remember", result: JSON.stringify(saved) },
      { name: "remember", result: JSON.stringify({ saved: true, memoryId: "m2", scope: "connection", status: "proposed", note: "events.ts is UTC" }) },
    ])).toEqual([
      { memoryId: "m1", scope: "user", status: "active", note: "Prefers UTC" },
      { memoryId: "m2", scope: "connection", status: "proposed", note: "events.ts is UTC" },
    ]);
  });

  it("skips refused, already known and malformed results", () => {
    expect(savedMemories([
      { name: "remember", result: { saved: false, reason: "PII" } },
      { name: "remember", result: { saved: true, memoryId: "m1", note: "x", alreadyKnown: true } },
      { name: "remember", result: "{broken" },
      { name: "remember", result: { saved: true, note: "no id" } },
      { name: "remember" },
    ])).toEqual([]);
    expect(savedMemories(undefined)).toEqual([]);
  });
});

describe("memoryExportFile", () => {
  it("names the file by day and pretty-prints it", () => {
    const file = memoryExportFile("2026-10-24T08:00:00.000Z", [{ content: "a" }]);
    expect(file.name).toBe("chouse-memories-2026-10-24.json");
    expect(JSON.parse(file.text)).toEqual({ exportedAt: "2026-10-24T08:00:00.000Z", memories: [{ content: "a" }] });
  });
});
