/**
 * A parse port backed by the recorded EXPLAIN AST printouts, for tests.
 */
import fixtures from "./explain-ast.json";
import { caseKey } from "./cases";
import type { SqlParsePort } from "../clickhouseParse";

type Recorded = Record<string, Record<string, { lines?: string[]; code?: string }>>;
const RECORDED = fixtures as Recorded;

export const RECORDED_VERSIONS = ["26.5", "23.8"] as const;

export interface FakeParser extends SqlParsePort {
  calls: number;
}

/** A port that answers from the fixtures for `version`; an unrecorded statement fails the test loudly. */
export function fixtureParser(version: string, defaultDb = "db"): FakeParser {
  const port: FakeParser = {
    calls: 0,
    async explainAst(sql, params) {
      port.calls++;
      const recorded = RECORDED[caseKey({ sql, params: params as Record<string, string> | undefined })]?.[version];
      if (!recorded) throw new Error(`No recorded printout for ${JSON.stringify(sql)} on ${version}`);
      if (recorded.lines) return { ok: true, lines: recorded.lines };
      return { ok: false, code: recorded.code as "SQL_SYNTAX", message: `${recorded.code} (recorded)` };
    },
    async defaultDatabase() {
      return defaultDb;
    },
  };
  return port;
}

/** A port that returns the given printout lines for any statement. */
export function linesParser(lines: string[], defaultDb = "db"): FakeParser {
  const port: FakeParser = {
    calls: 0,
    async explainAst() {
      port.calls++;
      return { ok: true, lines };
    },
    async defaultDatabase() {
      return defaultDb;
    },
  };
  return port;
}

/**
 * A stand-in for ClickHouse's `EXPLAIN AST` for route tests whose subject isn't
 * the parser: it prints a valid tree for a simple SELECT (tables after FROM /
 * JOIN, `{p:Identifier}` parameters bound, one `in` node per IN word) or
 * DROP TABLE. The parser itself is tested on real printouts (explain-ast.json).
 */
export function fakeExplainPrintout(sql: string, params: Record<string, unknown> = {}): string[] {
  const text = sql.replace(/^EXPLAIN AST /, "").replace(/'(?:[^'\\]|\\.)*'/g, "''");
  const bind = (name: string): string => name.replace(/\{(\w+):Identifier\}/g, (_m, p: string) => String(params[p] ?? p)).replace(/`/g, "");
  const drop = /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.`{}:]+)/i.exec(text);
  if (drop) {
    const [db, table] = bind(drop[1]).split(".");
    return table ? [`DropQuery ${db} ${table} (children 2)`, ` Identifier ${db}`, ` Identifier ${table}`] : [`DropQuery  ${db} (children 1)`, ` Identifier ${db}`];
  }
  const tables = [...text.matchAll(/\b(?:FROM|JOIN)\s+([\w.`{}:]+)/gi)].map((m) => bind(m[1]));
  const ins = (text.match(/\bIN\b/gi) ?? []).length;
  const lines = ["SelectWithUnionQuery (children 1)", " ExpressionList (children 1)"];
  lines.push(`  SelectQuery (children ${1 + (tables.length ? 1 : 0) + (ins ? 1 : 0)})`, "   ExpressionList (children 1)", "    Asterisk");
  if (tables.length) {
    lines.push(`   TablesInSelectQuery (children ${tables.length})`);
    for (const t of tables) lines.push("    TablesInSelectQueryElement (children 1)", "     TableExpression (children 1)", `      TableIdentifier ${t}`);
  }
  if (ins) {
    lines.push(`   ExpressionList (children ${ins})`);
    for (let i = 0; i < ins; i++) lines.push("    Function in (children 1)", "     ExpressionList (children 2)", "      Identifier x", "      Literal 'a'");
  }
  return lines;
}

/** `client.exec` for mocked ClickHouse clients: answers `EXPLAIN AST` with fakeExplainPrintout. */
export async function fakeExec(args: { query: string; query_params?: Record<string, unknown> }): Promise<{ stream: AsyncIterable<string> }> {
  const body = fakeExplainPrintout(args.query, args.query_params).map((line) => JSON.stringify({ explain: line })).join("\n");
  return { stream: (async function* () { yield body; })() };
}
