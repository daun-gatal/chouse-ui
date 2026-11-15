import { describe, expect, it } from "bun:test";

import { impersonate, isWrapOf, wrapBuilt, wrapperFor, WRAPPABLE_KINDS, type PrintoutPort } from "./impersonate";

/** Printouts as ClickHouse 26.3.63.123 gave them. */
const SELECT_ALONE = [
  "SelectWithUnionQuery (children 1)",
  " ExpressionList (children 1)",
  "  SelectQuery (children 1)",
  "   ExpressionList (children 1)",
  "    Literal UInt64_1",
];
const SELECT_WITH_SET = [
  "SelectWithUnionQuery (children 1)",
  " ExpressionList (children 1)",
  "  SelectQuery (children 2)",
  "   ExpressionList (children 1)",
  "    Literal UInt64_1",
  "   Set",
];
const wrapped = (inner: string[], user = "bob", head = "ExecuteAsQuery (children 2)"): string[] => [head, " UserNameWithHost (children 1)", `  Identifier ${user}`, ...inner.map((line) => ` ${line}`)];

describe("isWrapOf: the second parse (ADR 0033 §7.2)", () => {
  it("accepts the wrapper around exactly the typed statement", () => {
    expect(isWrapOf(wrapped(SELECT_ALONE), SELECT_ALONE, "bob", 0)).toBe(true);
    expect(isWrapOf(wrapped(SELECT_WITH_SET), SELECT_WITH_SET, "bob", 0)).toBe(true);
  });

  it("accepts one added SETTINGS clause only when one was expected", () => {
    expect(isWrapOf(wrapped(SELECT_WITH_SET), SELECT_ALONE, "bob", 1)).toBe(true);
    expect(isWrapOf(wrapped(SELECT_WITH_SET), SELECT_ALONE, "bob", 0)).toBe(false);
    expect(isWrapOf(wrapped(SELECT_ALONE), SELECT_ALONE, "bob", 1)).toBe(false);
  });

  it("refuses another target user", () => {
    expect(isWrapOf(wrapped(SELECT_ALONE, "alice"), SELECT_ALONE, "bob", 0)).toBe(false);
    expect(isWrapOf(wrapped(SELECT_ALONE, "bob2"), SELECT_ALONE, "bob", 0)).toBe(false);
  });

  it("refuses a clause ClickHouse attached to the wrapper (a FORMAT, or SETTINGS after it)", () => {
    // EXECUTE AS bob SELECT 1 FORMAT JSON SETTINGS readonly = 1, as 26.3 printed it.
    const onWrapper = ["ExecuteAsQuery (children 4)", " UserNameWithHost (children 1)", "  Identifier bob", " Identifier JSON", " Set", ...SELECT_ALONE.map((line) => ` ${line}`)];
    expect(isWrapOf(onWrapper, SELECT_ALONE, "bob", 0)).toBe(false);
    expect(isWrapOf(onWrapper, SELECT_ALONE, "bob", 1)).toBe(false);
  });

  it("refuses a different statement inside, a nested wrapper, and a printout that is not a wrapper", () => {
    const other = SELECT_ALONE.map((line) => line.replace("UInt64_1", "UInt64_2"));
    expect(isWrapOf(wrapped(other), SELECT_ALONE, "bob", 0)).toBe(false);
    expect(isWrapOf(wrapped([...SELECT_ALONE, " Literal UInt64_9"]), SELECT_ALONE, "bob", 0)).toBe(false);
    expect(isWrapOf(wrapped(wrapped(SELECT_ALONE)), wrapped(SELECT_ALONE), "bob", 0)).toBe(false);
    expect(isWrapOf(SELECT_ALONE, SELECT_ALONE, "bob", 0)).toBe(false);
    expect(isWrapOf([], SELECT_ALONE, "bob", 0)).toBe(false);
    expect(isWrapOf(wrapped(SELECT_ALONE), [], "bob", 0)).toBe(false);
    // A line that is not under the wrapper.
    expect(isWrapOf([...wrapped(SELECT_ALONE), "SelectQuery (children 1)"], SELECT_ALONE, "bob", 0)).toBe(false);
  });
});

/** A parse port that answers from a table of exact texts. Anything else is a syntax error. */
function port(answers: Record<string, string[] | "unavailable">): PrintoutPort & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async explainAst(sql: string) {
      asked.push(sql);
      const answer = answers[sql];
      if (answer === "unavailable") return { ok: false, code: "CHECK_UNAVAILABLE", message: "no answer" };
      if (!answer) return { ok: false, code: "SQL_SYNTAX", message: "Syntax error" };
      return { ok: true, lines: answer };
    },
  };
}

describe("impersonate: the texts that may be sent", () => {
  it("wraps a read and adds readonly in a new SETTINGS clause", async () => {
    const result = await impersonate("SELECT 1", undefined, "select", SELECT_ALONE, "bob", port({
      "EXECUTE AS `bob` SELECT 1": wrapped(SELECT_ALONE),
      "EXECUTE AS `bob` SELECT 1\nSETTINGS readonly = 1": wrapped(SELECT_WITH_SET),
    }));
    expect(result).toEqual({ ok: true, value: { user: "bob", sql: "EXECUTE AS `bob` SELECT 1", readOnlySql: "EXECUTE AS `bob` SELECT 1\nSETTINGS readonly = 1" } });
  });

  it("extends the statement's own trailing SETTINGS clause, after dropping a trailing semicolon", async () => {
    const result = await impersonate("SELECT 1 SETTINGS max_threads = 1; ", undefined, "select", SELECT_WITH_SET, "bob", port({
      "EXECUTE AS `bob` SELECT 1 SETTINGS max_threads = 1; ": wrapped(SELECT_WITH_SET),
      "EXECUTE AS `bob` SELECT 1 SETTINGS max_threads = 1\n, readonly = 1": wrapped(SELECT_WITH_SET),
    }));
    expect(result.ok && result.value.readOnlySql).toBe("EXECUTE AS `bob` SELECT 1 SETTINGS max_threads = 1\n, readonly = 1");
  });

  it("gives no read-only text when ClickHouse confirms neither placement", async () => {
    const result = await impersonate("SELECT 1", undefined, "select", SELECT_ALONE, "bob", port({ "EXECUTE AS `bob` SELECT 1": wrapped(SELECT_ALONE) }));
    expect(result).toEqual({ ok: true, value: { user: "bob", sql: "EXECUTE AS `bob` SELECT 1", readOnlySql: null } });
  });

  it("a kind that cannot write and cannot carry the clause is its own read-only text; a write has none", async () => {
    const show = ["ShowTables (children 1)", " Identifier secret"];
    const shown = await impersonate("SHOW TABLES FROM secret", undefined, "show", show, "bob", port({ "EXECUTE AS `bob` SHOW TABLES FROM secret": wrapped(show) }));
    expect(shown.ok && shown.value.readOnlySql).toBe("EXECUTE AS `bob` SHOW TABLES FROM secret");
    const drop = ["DropQuery  secret t (children 1)", " Identifier t"];
    const asked = port({ "EXECUTE AS `bob` DROP TABLE secret.t": wrapped(drop) });
    const dropped = await impersonate("DROP TABLE secret.t", undefined, "drop", drop, "bob", asked);
    expect(dropped.ok && dropped.value.readOnlySql).toBeNull();
    // No read-only candidate is even asked about for a write.
    expect(asked.asked).toEqual(["EXECUTE AS `bob` DROP TABLE secret.t"]);
  });

  it("refuses when the wrapped text is not the wrapper around the typed statement", async () => {
    const result = await impersonate("SELECT 1", undefined, "select", SELECT_ALONE, "bob", port({ "EXECUTE AS `bob` SELECT 1": wrapped(SELECT_ALONE, "alice") }));
    expect(result).toMatchObject({ ok: false, unavailable: false });
    const syntax = await impersonate("SELECT 1", undefined, "select", SELECT_ALONE, "bob", port({}));
    expect(syntax).toMatchObject({ ok: false, unavailable: false });
  });

  it("reports an unanswered parse as unavailable, never as allowed", async () => {
    expect(await impersonate("SELECT 1", undefined, "select", SELECT_ALONE, "bob", port({ "EXECUTE AS `bob` SELECT 1": "unavailable" }))).toMatchObject({ ok: false, unavailable: true });
    expect(await impersonate("SELECT 1", undefined, "select", SELECT_ALONE, "bob", port({
      "EXECUTE AS `bob` SELECT 1": wrapped(SELECT_ALONE),
      "EXECUTE AS `bob` SELECT 1\nSETTINGS readonly = 1": "unavailable",
    }))).toMatchObject({ ok: false, unavailable: true });
  });
});

describe("wrapBuilt: text CHouse built", () => {
  it("quotes the user, so a name that is a keyword stays a name", () => {
    expect(wrapperFor("format")).toBe("EXECUTE AS `format` ");
    expect(wrapBuilt("bob", "  SELECT 1;\n", false)).toBe("EXECUTE AS `bob` SELECT 1");
  });

  it("puts readonly into a read's own SETTINGS clause", () => {
    expect(wrapBuilt("bob", "SELECT 1", true)).toBe("EXECUTE AS `bob` SELECT 1\nSETTINGS readonly = 1");
    expect(wrapBuilt("bob", "-- why\n  WITH x AS (SELECT 1) SELECT * FROM x", true)).toEndWith("\nSETTINGS readonly = 1");
    expect(wrapBuilt("bob", "(SELECT 1) UNION ALL (SELECT 2)", true)).toEndWith("\nSETTINGS readonly = 1");
    expect(wrapBuilt("bob", "/* c */ EXPLAIN SELECT 1", true)).toEndWith("\nSETTINGS readonly = 1");
  });

  it("sends a kind that cannot write as it is, and refuses anything else that asked to be read-only", () => {
    for (const text of ["SHOW DATABASES", "DESCRIBE TABLE t", "desc t", "EXISTS TABLE t", "CHECK TABLE t"]) expect(wrapBuilt("bob", text, true)).toBe(`EXECUTE AS \`bob\` ${text}`);
    for (const text of ["DROP TABLE t", "INSERT INTO t SELECT 1", "ALTER TABLE t DELETE WHERE 1", "", "SYSTEM FLUSH LOGS"]) expect(() => wrapBuilt("bob", text, true)).toThrow("read-only request");
  });

  it("does not wrap SET or USE as a kind", () => {
    expect(WRAPPABLE_KINDS.has("set")).toBe(false);
    expect(WRAPPABLE_KINDS.has("use")).toBe(false);
  });
});
