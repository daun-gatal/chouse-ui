import { describe, expect, it } from "bun:test";

import { checkedForTests } from "./checked.test-util";
import { readonlyFor } from "./settings";

describe("readonlyFor (ADR 0033 §4)", () => {
  const read = checkedForTests({ sql: "SELECT 1", isRead: true, mayWrite: true });
  const write = checkedForTests({ sql: "INSERT INTO t VALUES (1)", isRead: false, mayWrite: true });
  const forcedWrite = checkedForTests({ sql: "INSERT INTO t VALUES (1)", isRead: false, mayWrite: false });

  it("sends 2 for a read, whoever sends it", () => {
    expect(readonlyFor(read)).toBe("2");
    expect(readonlyFor(checkedForTests({ sql: "SELECT 1", isRead: true, mayWrite: false }))).toBe("2");
  });

  it("sends none for a write from a person who may write", () => {
    expect(readonlyFor(write)).toBeUndefined();
  });

  it("sends 2 for anything from a person who may write nothing, so ClickHouse refuses what CHouse let through", () => {
    expect(readonlyFor(forcedWrite)).toBe("2");
  });

  it("sends a read-only feature's own level for every person and statement", () => {
    expect(readonlyFor(write, 1)).toBe("1");
    expect(readonlyFor(write, 2)).toBe("2");
    expect(readonlyFor(read, 1)).toBe("1");
  });
});
