/**
 * ddlSimulator — parse a ClickHouse mutation (ALTER TABLE … UPDATE/DELETE) for
 * the read-only DDL impact simulator. ClickHouse's mutation syntax isn't
 * standard SQL (node-sql-parser can't parse it), so this is a deliberately
 * strict allowlist parser: it accepts ONLY ALTER TABLE … UPDATE/DELETE and
 * rejects everything else. The parsed pieces are used solely to build read-only
 * estimate queries — the simulator never executes the ALTER.
 */

export interface ParsedMutation {
  /** Null means "use the connection's default database". */
  database: string | null;
  table: string;
  kind: "update" | "delete";
  /** Predicate after WHERE; empty string means the statement had no WHERE. */
  where: string;
}

export type ParseResult =
  | { ok: true; value: ParsedMutation }
  | { ok: false; error: string };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Strip ClickHouse line (`--`) and block (`/* *​/`) comments. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

export function parseMutationStatement(input: string): ParseResult {
  if (!input || !input.trim()) {
    return { ok: false, error: "Empty statement." };
  }

  let sql = stripComments(input).trim();
  // Allow a single trailing semicolon; reject anything that looks like more
  // than one statement (defence-in-depth, even though we never execute it).
  sql = sql.replace(/;\s*$/, "");
  if (sql.includes(";")) {
    return { ok: false, error: "Only a single statement is supported." };
  }

  // ALTER TABLE [db.]table [ON CLUSTER name] <UPDATE…|DELETE…>
  const head = sql.match(
    /^ALTER\s+TABLE\s+(?:(`?[A-Za-z_][A-Za-z0-9_]*`?)\.)?(`?[A-Za-z_][A-Za-z0-9_]*`?)\s+(?:ON\s+CLUSTER\s+\S+\s+)?(.*)$/is,
  );
  if (!head) {
    return {
      ok: false,
      error: "Only ALTER TABLE … UPDATE/DELETE statements can be simulated.",
    };
  }

  const database = head[1] ? head[1].replace(/`/g, "") : null;
  const table = head[2].replace(/`/g, "");
  const rest = head[3].trim();

  if (database !== null && !IDENT.test(database)) {
    return { ok: false, error: `Invalid database name: ${database}` };
  }
  if (!IDENT.test(table)) {
    return { ok: false, error: `Invalid table name: ${table}` };
  }

  const kindMatch = rest.match(/^(UPDATE|DELETE)\b/i);
  if (!kindMatch) {
    return {
      ok: false,
      error:
        "Only UPDATE and DELETE mutations are supported (ADD/DROP/MODIFY and other ALTERs are not part-rewriting mutations).",
    };
  }
  const kind = kindMatch[1].toLowerCase() as "update" | "delete";

  // The mutation predicate is everything after the first WHERE. UPDATE without
  // WHERE / DELETE without WHERE → empty predicate (affects the whole table).
  const whereMatch = rest.match(/\bWHERE\b(.+)$/is);
  const where = whereMatch ? whereMatch[1].trim() : "";

  // A predicate must not smuggle a second statement.
  if (where.includes(";")) {
    return { ok: false, error: "Invalid predicate." };
  }

  return { ok: true, value: { database, table, kind, where } };
}
