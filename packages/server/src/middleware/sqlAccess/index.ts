/**
 * Fail-closed SQL access checks (ADR 0030): lex, gate, parse with ClickHouse,
 * read the tree strictly, walk it under the policy. `dataAccess.ts` turns the
 * result into permission and data access rule decisions.
 */
import { analyzeStatement, type DenyCode, type StatementAccess } from "./analyze";
import type { SqlParsePort } from "./clickhouseParse";
import { readExplainTree } from "./explainTree";
import { isPlainName, keywordAt, lex, type Token } from "./lexer";

export type { DenyCode, NameRef, StatementAccess, StatementType } from "./analyze";
export { clickhouseParsePort, resetDefaultDatabaseCache, type SqlParsePort } from "./clickhouseParse";

export type ParsedAccess =
  | { ok: true; access: StatementAccess; defaultDatabase: string }
  | { ok: false; code: DenyCode; reason: string };

const AMBIGUOUS =
  "Names with dots, spaces, quotes or brackets inside backticks or double quotes can't be checked against your data access rules. Rename the object or ask an admin.";

/** `{name:Identifier}` parameter names in the statement. */
function identifierParams(tokens: Token[]): string[] {
  const names: string[] = [];
  for (let i = 0; i + 4 < tokens.length; i++) {
    const [open, name, colon, type, close] = tokens.slice(i, i + 5);
    if (open.kind === "symbol" && open.value === "{" && name.kind === "word" && colon.kind === "symbol" && colon.value === ":" &&
        keywordAt(tokens, i + 3) === "IDENTIFIER" && type.kind === "word" && close.kind === "symbol" && close.value === "}") {
      names.push(name.value);
    }
  }
  return names;
}

/** §3: refuse names the printout can't carry safely, before asking ClickHouse. */
function gate(tokens: Token[], params: Record<string, unknown> | undefined): ParsedAccess | null {
  for (const token of tokens) {
    if (token.kind === "quotedName" && !isPlainName(token.value)) return { ok: false, code: "AMBIGUOUS_NAME", reason: AMBIGUOUS };
  }
  for (const name of identifierParams(tokens)) {
    const value = params?.[name];
    if (value === undefined) continue; // ClickHouse reports the unbound parameter
    if (typeof value !== "string" || !value.split(".").every(isPlainName) || value.split(".").length > 2) {
      return { ok: false, code: "AMBIGUOUS_NAME", reason: AMBIGUOUS };
    }
  }
  return null;
}

/** Parse one statement (the exact text that will run) and apply the policy. */
export async function parseStatementAccess(sql: string, params: Record<string, unknown> | undefined, port: SqlParsePort): Promise<ParsedAccess> {
  const lexed = lex(sql);
  if (!lexed.ok) return { ok: false, code: "SQL_SYNTAX", reason: `Syntax error: ${lexed.reason}` };
  if (lexed.tokens.length === 0) return { ok: false, code: "SQL_SYNTAX", reason: "No SQL statement found" };

  const refused = gate(lexed.tokens, params);
  if (refused) return refused;

  // Raw INSERT data isn't SQL and ClickHouse's EXPLAIN would try to lex it; parse the header only.
  const statement = lexed.dataStart === undefined ? sql : sql.slice(0, lexed.dataStart);
  const printout = await port.explainAst(statement, params);
  if (!printout.ok) {
    if (printout.code === "CHECK_UNAVAILABLE") {
      return { ok: false, code: "CHECK_UNAVAILABLE", reason: "The query couldn't be checked against your data access rules because ClickHouse didn't answer. Try again." };
    }
    return { ok: false, code: printout.code, reason: printout.message };
  }

  const tree = readExplainTree(printout.lines);
  if (!tree.ok) {
    return { ok: false, code: "INCOMPLETE_TREE", reason: `The query couldn't be fully checked against your data access rules (${tree.reason}).` };
  }

  const analyzed = analyzeStatement(tree.root, lexed.tokens);
  if (!analyzed.ok) return analyzed;

  let defaultDatabase: string;
  try {
    defaultDatabase = await port.defaultDatabase();
  } catch {
    return { ok: false, code: "CHECK_UNAVAILABLE", reason: "The query couldn't be checked against your data access rules because ClickHouse didn't answer. Try again." };
  }
  return { ok: true, access: analyzed.access, defaultDatabase };
}
