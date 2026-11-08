/**
 * The whole pipeline against real ClickHouse printouts (fixtures/explain-ast.json,
 * recorded from 23.8 and 26.5 by fixtures/record.ts).
 */
import { describe, expect, it } from "bun:test";
import { parseStatementAccess } from "./index";
import { classifyParseError } from "./clickhouseParse";
import { CASES, type Expected } from "./fixtures/cases";
import { fixtureParser, linesParser, RECORDED_VERSIONS } from "./fixtures/fakeParser";
import type { NameRef } from "./analyze";

const names = (refs: NameRef[]): string[] => refs.map((r) => `${r.database ?? "·"}.${r.table}`);

for (const version of RECORDED_VERSIONS) {
  describe(`access check on ClickHouse ${version} printouts`, () => {
    for (const c of CASES) {
      const expected = c.syntaxErrorOn?.includes(version) ? "SQL_SYNTAX" : c.expect;
      it(`${typeof expected === "string" ? expected : "allows"}: ${c.sql.replace(/\n/g, "⏎").slice(0, 90)}`, async () => {
        const result = await parseStatementAccess(c.sql, c.params, fixtureParser(version));
        if (typeof expected === "string") {
          expect(result.ok ? "allowed" : result.code).toBe(expected);
          return;
        }
        if (!result.ok) throw new Error(`${result.code}: ${result.reason}`);
        const want: Required<Expected> = { targets: [], reads: [], databases: [], ...expected };
        expect({
          type: result.access.type,
          permission: result.access.permission,
          targets: names(result.access.targets),
          reads: names(result.access.reads),
          databases: result.access.databases,
        }).toEqual(want);
      });
    }
  });
}

describe("parse channel failures", () => {
  it("refuses names before asking ClickHouse", async () => {
    const parser = fixtureParser("26.5");
    const result = await parseStatementAccess("SELECT * FROM `secret.s`", undefined, parser);
    expect(result.ok ? "allowed" : result.code).toBe("AMBIGUOUS_NAME");
    expect(parser.calls).toBe(0);
  });

  it("reports an unreachable ClickHouse as CHECK_UNAVAILABLE, never as a denial of access", async () => {
    const result = await parseStatementAccess("SELECT 1", undefined, {
      explainAst: async () => ({ ok: false, code: "CHECK_UNAVAILABLE", message: "ECONNREFUSED" }),
      defaultDatabase: async () => "db",
    });
    expect(result).toMatchObject({ ok: false, code: "CHECK_UNAVAILABLE" });
    if (!result.ok) expect(result.reason).not.toContain("denied");
  });

  it("refuses a printout that doesn't match its own children counts", async () => {
    const result = await parseStatementAccess("SELECT 1", undefined, linesParser(["SelectWithUnionQuery (children 2)", " ExpressionList"]));
    expect(result.ok ? "allowed" : result.code).toBe("INCOMPLETE_TREE");
  });

  it("refuses a node it doesn't know", async () => {
    const result = await parseStatementAccess("SELECT 1", undefined, linesParser(["SelectWithUnionQuery (children 1)", " MysteryNode"]));
    expect(result.ok ? "allowed" : result.code).toBe("UNSUPPORTED_SHAPE");
  });

  it("refuses a statement kind the lexer and the printout disagree on", async () => {
    // ATTACH also prints as CreateQuery; only CREATE is checked as one.
    const result = await parseStatementAccess("ATTACH TABLE public.t", undefined, linesParser(["CreateQuery public t (children 2)", " Identifier public", " Identifier t"]));
    expect(result.ok ? "allowed" : result.code).toBe("UNSUPPORTED_SHAPE");
  });

  it("parses only the header of an INSERT with raw data", async () => {
    let seen = "";
    const result = await parseStatementAccess("INSERT INTO public.t FORMAT CSV\n1,it's\n", undefined, {
      explainAst: async (sql) => {
        seen = sql;
        return { ok: true, lines: ["InsertQuery   (children 2)", " Identifier public", " Identifier t"] };
      },
      defaultDatabase: async () => "db",
    });
    expect(seen).toBe("INSERT INTO public.t FORMAT CSV");
    expect(result.ok && result.access.targets).toEqual([{ database: "public", table: "t" }]);
  });

  it("refuses empty or unclosed text as a syntax error", async () => {
    for (const sql of ["", "  -- only a comment", "SELECT 'a"]) {
      const result = await parseStatementAccess(sql, undefined, linesParser([]));
      expect(result.ok ? "allowed" : result.code).toBe("SQL_SYNTAX");
    }
  });
});

describe("classifyParseError", () => {
  it("separates bad SQL, unbound parameters and an unavailable server", () => {
    expect(classifyParseError(Object.assign(new Error("Syntax error"), { code: "62" })).code).toBe("SQL_SYNTAX");
    expect(classifyParseError(new Error("Code: 456. Substitution `p` is not set")).code).toBe("QUERY_PARAM_UNBOUND");
    expect(classifyParseError(Object.assign(new Error("Authentication failed"), { code: "516" })).code).toBe("CHECK_UNAVAILABLE");
    expect(classifyParseError(new Error("connect ECONNREFUSED")).code).toBe("CHECK_UNAVAILABLE");
    expect(classifyParseError(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:8123"), { code: "ECONNREFUSED" })).code).toBe("CHECK_UNAVAILABLE");
    expect(classifyParseError(new DOMException("The operation timed out.", "TimeoutError")).code).toBe("CHECK_UNAVAILABLE");
    // Positions count from the user's text, not from the EXPLAIN AST prefix.
    expect(classifyParseError(Object.assign(new Error("Syntax error: failed at position 19 (1)"), { code: "62" })).message).toBe("Syntax error: failed at position 7 (1)");
    expect(classifyParseError(new Error("The operation was aborted due to timeout")).code).toBe("CHECK_UNAVAILABLE");
    expect(classifyParseError(Object.assign(new Error("Timeout exceeded"), { code: "159" })).code).toBe("CHECK_UNAVAILABLE");
    // A parameter ClickHouse can't parse is the statement's problem, not an outage.
    expect(classifyParseError(Object.assign(new Error("Cannot parse DateTime: value 0"), { code: "41" })).code).toBe("SQL_SYNTAX");
  });
});
