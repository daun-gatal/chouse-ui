/**
 * DDL parsing for the schema change preflight (ADR 0016 §11).
 *
 * A deliberately small, allowlist parser: it recognises the statements whose
 * effect on dependents we can reason about (ALTER column operations, DROP /
 * RENAME / TRUNCATE / EXCHANGE TABLE, DROP DATABASE). Anything else is
 * reported as `unknown` and the preflight treats it as "impact not analysed",
 * never as safe.
 */

export type ColumnChange =
  | { op: "add_column"; column: string; type: string | null }
  | { op: "drop_column"; column: string }
  | { op: "rename_column"; column: string; to: string }
  | { op: "modify_column"; column: string; type: string | null }
  | { op: "other"; text: string };

export type ParsedDdl =
  | { kind: "alter"; database: string | null; table: string; onCluster: string | null; changes: ColumnChange[] }
  | { kind: "drop_table"; database: string | null; table: string; onCluster: string | null }
  | { kind: "truncate"; database: string | null; table: string; onCluster: string | null }
  | { kind: "rename_table"; database: string | null; table: string; toDatabase: string | null; toTable: string; onCluster: string | null }
  | { kind: "exchange_tables"; database: string | null; table: string; otherDatabase: string | null; otherTable: string; onCluster: string | null }
  | { kind: "drop_database"; database: string; onCluster: string | null }
  | { kind: "unknown" };

const IDENT = String.raw`(?:\x60[^\x60]+\x60|"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)`;
const QUALIFIED = String.raw`(${IDENT})(?:\s*\.\s*(${IDENT}))?`;
const CLUSTER = String.raw`(?:\s+ON\s+CLUSTER\s+(${IDENT}|'[^']+'))?`;

export function unquote(identifier: string | undefined | null): string | null {
  if (!identifier) return null;
  const trimmed = identifier.trim();
  if ((trimmed.startsWith("`") && trimmed.endsWith("`")) || (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function qualified(first: string, second: string | undefined): { database: string | null; table: string } {
  return second ? { database: unquote(first), table: unquote(second)! } : { database: null, table: unquote(first)! };
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trim().replace(/;\s*$/, "");
}

/** Split an ALTER's comma-separated commands, ignoring commas inside parentheses and quotes. */
function splitCommands(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of body) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseCommand(command: string): ColumnChange {
  let m = new RegExp(String.raw`^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})\s*(.*)$`, "is").exec(command);
  if (m) return { op: "add_column", column: unquote(m[1])!, type: m[2]?.trim().split(/\s+(?:DEFAULT|MATERIALIZED|ALIAS|CODEC|TTL|COMMENT|AFTER|FIRST)\b/i)[0] || null };
  m = new RegExp(String.raw`^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(${IDENT})`, "i").exec(command);
  if (m) return { op: "drop_column", column: unquote(m[1])! };
  m = new RegExp(String.raw`^RENAME\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(${IDENT})\s+TO\s+(${IDENT})`, "i").exec(command);
  if (m) return { op: "rename_column", column: unquote(m[1])!, to: unquote(m[2])! };
  m = new RegExp(String.raw`^MODIFY\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(${IDENT})\s*(.*)$`, "is").exec(command);
  if (m) return { op: "modify_column", column: unquote(m[1])!, type: m[2]?.trim().split(/\s+(?:DEFAULT|MATERIALIZED|ALIAS|CODEC|TTL|COMMENT|REMOVE)\b/i)[0] || null };
  return { op: "other", text: command };
}

export function parseDdl(input: string): ParsedDdl {
  const sql = stripComments(input);
  let m = new RegExp(String.raw`^ALTER\s+TABLE\s+${QUALIFIED}${CLUSTER}\s+([\s\S]+)$`, "i").exec(sql);
  if (m) {
    const { database, table } = qualified(m[1], m[2]);
    return { kind: "alter", database, table, onCluster: unquote(m[3]), changes: splitCommands(m[4]).map(parseCommand) };
  }
  m = new RegExp(String.raw`^DROP\s+(?:TABLE|VIEW|DICTIONARY)\s+(?:IF\s+EXISTS\s+)?${QUALIFIED}${CLUSTER}`, "i").exec(sql);
  if (m) return { kind: "drop_table", ...qualified(m[1], m[2]), onCluster: unquote(m[3]) };
  m = new RegExp(String.raw`^TRUNCATE\s+(?:TABLE\s+)?(?:IF\s+EXISTS\s+)?${QUALIFIED}${CLUSTER}`, "i").exec(sql);
  if (m) return { kind: "truncate", ...qualified(m[1], m[2]), onCluster: unquote(m[3]) };
  m = new RegExp(String.raw`^RENAME\s+(?:TABLE|DICTIONARY)\s+${QUALIFIED}\s+TO\s+${QUALIFIED}${CLUSTER}`, "i").exec(sql);
  if (m) {
    const from = qualified(m[1], m[2]);
    const to = qualified(m[3], m[4]);
    return { kind: "rename_table", database: from.database, table: from.table, toDatabase: to.database, toTable: to.table, onCluster: unquote(m[5]) };
  }
  m = new RegExp(String.raw`^EXCHANGE\s+TABLES\s+${QUALIFIED}\s+AND\s+${QUALIFIED}${CLUSTER}`, "i").exec(sql);
  if (m) {
    const a = qualified(m[1], m[2]);
    const b = qualified(m[3], m[4]);
    return { kind: "exchange_tables", database: a.database, table: a.table, otherDatabase: b.database, otherTable: b.table, onCluster: unquote(m[5]) };
  }
  m = new RegExp(String.raw`^DROP\s+DATABASE\s+(?:IF\s+EXISTS\s+)?(${IDENT})${CLUSTER}`, "i").exec(sql);
  if (m) return { kind: "drop_database", database: unquote(m[1])!, onCluster: unquote(m[2]) };
  return { kind: "unknown" };
}

/** Does `text` reference `column` as a whole identifier? */
export function referencesColumn(text: string, column: string): boolean {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`(?:^|[^A-Za-z0-9_])\x60?${escaped}\x60?(?:[^A-Za-z0-9_]|$)`).test(text);
}

/** Does `text` reference `db.table` (or bare `table` when `allowBare`)? */
export function referencesTable(text: string, database: string, table: string, allowBare: boolean): boolean {
  const t = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const d = database.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const qualifiedRe = new RegExp(String.raw`\x60?${d}\x60?\s*\.\s*\x60?${t}\x60?(?:[^A-Za-z0-9_]|$)`, "i");
  if (qualifiedRe.test(text)) return true;
  if (!allowBare) return false;
  return new RegExp(String.raw`(?:FROM|JOIN|INTO|TABLE)\s+\x60?${t}\x60?(?:[^A-Za-z0-9_.]|$)`, "i").test(text);
}
