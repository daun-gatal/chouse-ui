import { describe, expect, it } from "vitest";

import { resultColumnAccessors } from "./resultColumns";

describe("resultColumnAccessors", () => {
  it("reads dotted and bracketed names as literal keys, not paths", () => {
    const row = {
      "device.name": "firewall-01",
      "n.a": [1, 2],
      "j.device.name": "fw",
      "a[0]": 7,
      device: { name: "nested-should-not-win" },
    };
    const accessors = resultColumnAccessors(["device.name", "n.a", "j.device.name", "a[0]"]);

    expect(accessors.map((a) => a.accessorFn(row))).toEqual(["firewall-01", [1, 2], "fw", 7]);
  });

  it("keeps the exact column name as the id, dots included", () => {
    const ids = resultColumnAccessors(["device.name", "events"]).map((a) => a.id);

    expect(ids).toEqual(["device.name", "events"]);
  });

  it("gives `a.b` and `a_b` different ids", () => {
    const ids = resultColumnAccessors(["a.b", "a_b"]).map((a) => a.id);

    expect(new Set(ids).size).toBe(2);
  });

  it("suffixes repeated names so every id is unique", () => {
    const ids = resultColumnAccessors(["1", "1", "x", "x#2", "x"]).map((a) => a.id);

    expect(ids).toEqual(["1", "1#2", "x", "x#2", "x#3"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not hand out a suffixed id that a later column already uses", () => {
    const ids = resultColumnAccessors(["x", "x", "x#2"]).map((a) => a.id);

    expect(new Set(ids).size).toBe(3);
    expect(ids[2]).toBe("x#2");
  });

  it("reads the same key for every column that shares a name", () => {
    const accessors = resultColumnAccessors(["1", "1"]);

    expect(accessors.map((a) => a.accessorFn({ 1: 1 }))).toEqual([1, 1]);
  });

  it("keeps null values and returns undefined for a missing key", () => {
    const [present, missing] = resultColumnAccessors(["v", "gone"]);

    expect(present.accessorFn({ v: null })).toBeNull();
    expect(missing.accessorFn({ v: 1 })).toBeUndefined();
  });

  it("never returns inherited Object.prototype members", () => {
    const accessors = resultColumnAccessors(["constructor", "toString", "__proto__"]);

    expect(accessors.map((a) => a.accessorFn({}))).toEqual([undefined, undefined, undefined]);
  });

  it("returns an empty list for no columns", () => {
    expect(resultColumnAccessors([])).toEqual([]);
  });
});
