import { describe, expect, it } from "bun:test";

import { buildProfileQuery, isPiiColumn, MAX_PROFILED_COLUMNS, parseProfile, planProfile, PROFILE_MAX_ROWS, profileKind, quoteIdent, safeTopValues } from "./profile";

describe("table profile", () => {
  it("quotes catalog identifiers so names cannot break out of the query", () => {
    expect(quoteIdent("orders")).toBe("`orders`");
    expect(quoteIdent("we`ird\\name")).toBe("`we\\`ird\\\\name`");
  });

  it("classifies column types and skips complex ones", () => {
    expect(profileKind("Nullable(UInt64)")).toBe("numeric");
    expect(profileKind("LowCardinality(Nullable(String))")).toBe("text");
    expect(profileKind("DateTime64(3, 'UTC')")).toBe("temporal");
    expect(profileKind("Enum8('a' = 1)")).toBe("text");
    expect(profileKind("UUID")).toBe("identifier");
    expect(profileKind("Array(String)")).toBeNull();
    expect(profileKind("Map(String, UInt64)")).toBeNull();
    expect(profileKind("AggregateFunction(uniq, UInt64)")).toBeNull();
  });

  it("recognises personal-looking column names", () => {
    for (const name of ["email", "user_email", "phone_number", "client_ip", "ip", "first_name", "card_last4", "password_hash", "birth_date"]) {
      expect({ name, pii: isPiiColumn(name) }).toEqual({ name, pii: true });
    }
    for (const name of ["order_id", "amount", "status", "created_at", "shipping_method", "description"]) {
      expect({ name, pii: isPiiColumn(name) }).toEqual({ name, pii: false });
    }
  });

  it("only aggregates, and never reads values from personal columns", () => {
    const { planned, skipped } = planProfile([
      { name: "status", type: "LowCardinality(String)" },
      { name: "email", type: "String" },
      { name: "amount", type: "Nullable(Decimal(18, 2))" },
      { name: "ts", type: "DateTime" },
      { name: "src_ip", type: "IPv4" },
      { name: "items", type: "Array(UInt64)" },
    ], false);
    expect(skipped).toEqual(["items"]);
    const query = buildProfileQuery("shop", "orders", planned);
    expect(query).toStartWith("SELECT count() AS rows, ");
    expect(query).toEndWith("FROM `shop`.`orders`");
    expect(query).toContain("topK(5)(`status`)");
    expect(query).toContain("countIf(isNull(`amount`))");
    expect(query).toContain("toString(min(`ts`))");
    // Personal columns: distinct count only — no min/max/topK.
    expect(query).toContain("uniq(`email`)");
    expect(query).not.toMatch(/topK\(5\)\(`email`\)|min\(`email`\)/);
    expect(query).not.toMatch(/min\(`src_ip`\)|topK\(5\)\(`src_ip`\)/);
    expect(query).not.toMatch(/\bLIMIT\b|\bWHERE\b|SELECT \*/);
  });

  it("treats every column of a table tagged pii as personal", () => {
    const { planned } = planProfile([{ name: "status", type: "String" }], true);
    expect(buildProfileQuery("a", "b", planned)).not.toContain("topK");
  });

  it("caps how many columns are profiled", () => {
    const columns = Array.from({ length: MAX_PROFILED_COLUMNS + 5 }, (_, i) => ({ name: `c${i}`, type: "UInt8" }));
    const { planned, skipped } = planProfile(columns, false);
    expect(planned).toHaveLength(MAX_PROFILED_COLUMNS);
    expect(skipped).toHaveLength(5);
  });

  it("shares top values only for low-cardinality columns, screened", () => {
    const { planned, skipped } = planProfile([{ name: "status", type: "String" }, { name: "sku", type: "String" }, { name: "email", type: "String" }], false);
    const profile = parseProfile({ rows: 100, c0_uniq: 3, c0_top: ["paid", "refunded", "a@b.co"], c1_uniq: 5000, c1_top: ["X1"], c2_uniq: 90 }, planned, skipped, 100);
    expect(profile.columns[0].topValues).toEqual(["paid", "refunded"]);
    expect(profile.columns[1].topValues).toBeNull();
    expect(profile.columns[2]).toMatchObject({ pii: true, topValues: null, min: null, max: null, distinct: 90 });
    expect(profile.partial).toBe(false);
    expect(parseProfile({ rows: PROFILE_MAX_ROWS }, [], [], PROFILE_MAX_ROWS * 3).partial).toBe(true);
  });

  it("drops value-shaped personal data and secrets from top values", () => {
    expect(safeTopValues(["ok", "x@y.z", "0812345678901", 7, "ch_pat_abcdefghijklmnopqrstuvwxyz"])).toEqual(["ok", "ch_pat_***"]);
    expect(safeTopValues("nope")).toEqual([]);
  });
});
