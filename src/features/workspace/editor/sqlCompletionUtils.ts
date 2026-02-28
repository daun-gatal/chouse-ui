/**
 * Pure SQL completion utilities (no Monaco dependency).
 * Used by monacoConfig and testable without loading monaco-editor.
 */

import type { IntellisenseData } from "@/api/query";

export interface Column {
  name: string;
  type: string;
}

export interface Table {
  name: string;
  type: string;
  children: Column[];
}

export interface Database {
  name: string;
  type: string;
  children: Table[];
}

/** Position in the document (compatible with Monaco Position) */
export interface EditorPosition {
  lineNumber: number;
  column: number;
}

/** Context inferred from cursor position for suggestion ordering/filtering */
export type QueryContextKind =
  | "afterSelect"
  | "afterFrom"
  | "afterJoin"
  | "afterWhere"
  | "afterOn"
  | "afterGroupBy"
  | "afterOrderBy"
  | "afterHaving"
  | "afterPrewhere"
  | "afterInsertInto"
  | "afterSettings"
  | "afterEngine"
  | "afterUsing"
  | "afterValues"
  | "afterDataType"
  | "dbDot"
  | "dbTableDot"
  | "generic";

/** Table reference from FROM/JOIN before cursor (for column-level completion) */
export interface TableInScope {
  database?: string;
  table: string;
  alias?: string;
}

export interface ParseQueryContextResult {
  database?: string;
  table?: string;
  isTypingDatabase: boolean;
  kind: QueryContextKind;
  /** Tables from FROM/JOIN clauses before cursor; used to suggest columns in SELECT/WHERE/ON/GROUP BY/ORDER BY/HAVING */
  tablesInScope: TableInScope[];
}

/**
 * Get text before the cursor position from the full query.
 */
export function getTextBeforeCursor(query: string, position: EditorPosition): string {
  const lines = query.split("\n");
  return (
    lines
      .slice(0, position.lineNumber - 1)
      .join("\n") +
    "\n" +
    (lines[position.lineNumber - 1]?.substring(0, position.column) ?? "")
  );
}

/**
 * Strip CTE (WITH ... AS (...)) definitions from the text,
 * returning only the main query portion.
 */
function stripCTEPrefix(text: string): string {
  const withMatch = text.match(/^\s*with\b/i);
  if (!withMatch) return text;

  let pos = withMatch[0].length;

  while (pos < text.length) {
    while (pos < text.length && /\s/.test(text[pos])) pos++;

    const nameMatch = text.slice(pos).match(/^([a-zA-Z_]\w*)/);
    if (!nameMatch || nameMatch[1].toLowerCase() === "select") break;
    pos += nameMatch[1].length;

    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (text.slice(pos, pos + 2).toLowerCase() !== "as") break;
    pos += 2;
    while (pos < text.length && /\s/.test(text[pos])) pos++;

    if (text[pos] !== "(") break;
    pos++;
    let depth = 1;
    while (pos < text.length && depth > 0) {
      if (text[pos] === "(") depth++;
      else if (text[pos] === ")") depth--;
      pos++;
    }

    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (text[pos] === ",") {
      pos++;
      continue;
    }
    break;
  }

  return text.slice(pos);
}

/**
 * Get table references from FROM and JOIN clauses before the cursor.
 * Supports both explicit aliases (AS alias) and implicit aliases (FROM table alias).
 * Resolves CTE references to their underlying tables.
 */
export function getTablesInScope(
  query: string,
  position: EditorPosition
): TableInScope[] {
  const fullBeforeCursor = getTextBeforeCursor(query, position);
  const beforeCursor = stripCTEPrefix(fullBeforeCursor);
  const tokens = beforeCursor.split(/\s+/).filter((t) => t.length > 0);
  const result: TableInScope[] = [];
  let i = 0;

  const NON_ALIAS_KEYWORDS = new Set([
    "on", "where", "group", "order", "having", "limit", "union",
    "join", "inner", "left", "right", "full", "outer", "cross",
    "global", "any", "all", "anti", "semi", "array",
    "prewhere", "final", "sample", "settings", "format",
    "select", "from", "set", "into", "using",
    "as", "(", ")", ",",
  ]);

  function isImplicitAlias(token: string): boolean {
    return !NON_ALIAS_KEYWORDS.has(token.toLowerCase()) && /^[a-zA-Z_]\w*$/.test(token);
  }

  const cteDefinitions = parseCTEDefinitions(query);
  const cteMap = new Map(cteDefinitions.map((c) => [c.name.toLowerCase(), c]));

  function addRef(ref: TableInScope): void {
    if (!result.some((r) => r.database === ref.database && r.table === ref.table && r.alias === ref.alias)) {
      result.push(ref);
    }
  }

  function resolveRef(ref: TableInScope): void {
    const cte = cteMap.get(ref.table.toLowerCase());
    if (cte && !ref.database) {
      for (const cteTable of cte.tables) {
        const resolved: TableInScope = {
          database: cteTable.database,
          table: cteTable.table,
          alias: ref.alias ?? ref.table,
        };
        addRef(resolved);
      }
    } else {
      addRef(ref);
    }
  }

  while (i < tokens.length) {
    const lower = tokens[i].toLowerCase();

    if (lower === "from" || lower === "join") {
      i += 1;
      if (i >= tokens.length) break;
      const tableToken = tokens[i];
      if (tableToken === "(" || tableToken.toLowerCase() === "select") {
        i += 1;
        continue;
      }
      const ref = parseTableRef(tableToken);
      i += 1;

      if (i < tokens.length) {
        if (tokens[i].toLowerCase() === "as") {
          i += 1;
          if (i < tokens.length) {
            ref.alias = tokens[i];
            i += 1;
          }
        } else if (isImplicitAlias(tokens[i])) {
          ref.alias = tokens[i];
          i += 1;
        }
      }

      resolveRef(ref);
      continue;
    }

    if (lower === "left" || lower === "right" || lower === "inner" ||
        lower === "outer" || lower === "cross" || lower === "global" ||
        lower === "any" || lower === "all" || lower === "anti" || lower === "semi" ||
        lower === "full") {
      i += 1;
      if (i < tokens.length && tokens[i].toLowerCase() === "outer") {
        i += 1;
      }
      if (i < tokens.length && tokens[i].toLowerCase() === "join") {
        i += 1;
        if (i >= tokens.length) break;
        const tableToken = tokens[i];
        if (tableToken === "(" || tableToken.toLowerCase() === "select") {
          i += 1;
          continue;
        }
        const ref = parseTableRef(tableToken);
        i += 1;

        if (i < tokens.length) {
          if (tokens[i].toLowerCase() === "as") {
            i += 1;
            if (i < tokens.length) {
              ref.alias = tokens[i];
              i += 1;
            }
          } else if (isImplicitAlias(tokens[i])) {
            ref.alias = tokens[i];
            i += 1;
          }
        }

        resolveRef(ref);
      }
      continue;
    }
    i += 1;
  }

  return result;
}

function parseTableRef(token: string): TableInScope {
  if (token.includes(".")) {
    const parts = token.split(".");
    if (parts.length === 2) {
      return { database: parts[0], table: parts[1] };
    }
    if (parts.length >= 3) {
      return { database: parts[0], table: parts[1] };
    }
  }
  return { table: token };
}

/** A CTE (WITH ... AS) definition with the tables it references internally. */
export interface CTEDefinition {
  name: string;
  tables: TableInScope[];
}

/**
 * Parse CTE definitions from the query text.
 * Handles: WITH name AS ( body ), name2 AS ( body2 ), ... SELECT ...
 */
export function parseCTEDefinitions(query: string): CTEDefinition[] {
  const result: CTEDefinition[] = [];
  const text = query.replace(/\r\n/g, "\n");

  const withMatch = text.match(/^\s*with\b/i);
  if (!withMatch) return result;

  let pos = withMatch[0].length;

  while (pos < text.length) {
    while (pos < text.length && /\s/.test(text[pos])) pos++;

    const nameMatch = text.slice(pos).match(/^([a-zA-Z_]\w*)/);
    if (!nameMatch) break;
    const cteName = nameMatch[1];
    if (cteName.toLowerCase() === "select") break;
    pos += cteName.length;

    while (pos < text.length && /\s/.test(text[pos])) pos++;

    if (text.slice(pos, pos + 2).toLowerCase() !== "as") break;
    pos += 2;

    while (pos < text.length && /\s/.test(text[pos])) pos++;

    if (text[pos] !== "(") break;
    pos++;

    let depth = 1;
    const bodyStart = pos;
    while (pos < text.length && depth > 0) {
      if (text[pos] === "(") depth++;
      else if (text[pos] === ")") depth--;
      if (depth > 0) pos++;
    }
    const body = text.slice(bodyStart, pos);
    pos++; // skip closing )

    const tables = extractTablesFromCTEBody(body);
    result.push({ name: cteName, tables });

    while (pos < text.length && /\s/.test(text[pos])) pos++;

    if (text[pos] === ",") {
      pos++;
      continue;
    }
    break;
  }

  return result;
}

function extractTablesFromCTEBody(body: string): TableInScope[] {
  const tokens = body.split(/\s+/).filter((t) => t.length > 0);
  const tables: TableInScope[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i].toLowerCase();
    if (lower === "from" || lower === "join") {
      if (i + 1 < tokens.length) {
        const raw = tokens[i + 1].replace(/[(),]/g, "");
        if (raw && raw.toLowerCase() !== "select" && raw !== "(") {
          const ref = parseTableRef(raw);
          if (!tables.some((r) => r.database === ref.database && r.table === ref.table)) {
            tables.push(ref);
          }
        }
      }
    }
  }

  return tables;
}

/** Contexts where column suggestions from scope tables are relevant */
const COLUMN_SCOPE_CONTEXTS = new Set<QueryContextKind>([
  "afterSelect", "afterWhere", "afterOn", "afterGroupBy",
  "afterOrderBy", "afterHaving", "afterPrewhere", "afterUsing",
]);

/**
 * Parse the SQL query to determine the context at the given position.
 * Uses multi-line backward scanning for robust context detection.
 */
export function parseQueryContext(
  query: string,
  position: EditorPosition
): ParseQueryContextResult {
  const beforeCursor = getTextBeforeCursor(query, position);
  const tokens = beforeCursor.split(/\s+/).filter((t) => t.length > 0);

  let database: string | undefined;
  let table: string | undefined;
  let isTypingDatabase = false;
  let kind: QueryContextKind = "generic";

  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    const lower = token.toLowerCase();

    if (token.includes(".")) {
      const parts = token.split(".");
      if (parts.length === 2 && parts[1] === "") {
        database = parts[0];
        isTypingDatabase = true;
        kind = "dbDot";
        break;
      }
      if (parts.length === 3 && parts[2] === "") {
        database = parts[0];
        table = parts[1];
        kind = "dbTableDot";
        break;
      }
      if (parts.length === 2) {
        [database, table] = parts;
      } else if (parts.length >= 3) {
        [database, table] = parts.slice(0, 2);
      }
      kind = "generic";
      break;
    }

    if (lower === "from") {
      if (i + 1 < tokens.length) {
        table = tokens[i + 1];
      }
      kind = "afterFrom";
      break;
    }
    if (lower === "into") {
      if (i > 0 && tokens[i - 1].toLowerCase() === "insert") {
        kind = "afterInsertInto";
        break;
      }
    }
    if (lower === "join") {
      kind = "afterJoin";
      break;
    }
    if (lower === "inner" || lower === "left" || lower === "right" ||
        lower === "full" || lower === "cross" || lower === "anti" || lower === "semi") {
      if (i + 1 < tokens.length && tokens[i + 1].toLowerCase() === "join") {
        kind = "afterJoin";
        break;
      }
    }
    if (lower === "on") {
      kind = "afterOn";
      break;
    }
    if (lower === "using") {
      kind = "afterUsing";
      break;
    }
    if (lower === "where") {
      kind = "afterWhere";
      break;
    }
    if (lower === "prewhere") {
      kind = "afterPrewhere";
      break;
    }
    if (lower === "having") {
      kind = "afterHaving";
      break;
    }
    if (lower === "by") {
      if (i > 0) {
        const prev = tokens[i - 1].toLowerCase();
        if (prev === "group") {
          kind = "afterGroupBy";
          break;
        }
        if (prev === "order") {
          kind = "afterOrderBy";
          break;
        }
      }
    }
    if (lower === "settings") {
      kind = "afterSettings";
      break;
    }
    if (lower === "engine" || lower === "=") {
      if (i > 0 && tokens[i - 1].toLowerCase() === "engine") {
        kind = "afterEngine";
        break;
      }
      if (lower === "engine") {
        kind = "afterEngine";
        break;
      }
    }
    if (lower === "values") {
      kind = "afterValues";
      break;
    }
    if (lower === "select" || token === ",") {
      kind = "afterSelect";
      break;
    }
  }

  // Detect data type context: after column name in CREATE/ALTER or after type keywords like Nullable(
  if (kind === "generic") {
    const lastFew = tokens.slice(-3).map((t) => t.toLowerCase());
    if (lastFew.includes("column") || lastFew.includes("add") || lastFew.includes("modify")) {
      kind = "afterDataType";
    }
  }

  const tablesInScope = COLUMN_SCOPE_CONTEXTS.has(kind)
    ? getTablesInScope(query, position)
    : [];

  return { database, table, isTypingDatabase, kind, tablesInScope };
}

/**
 * Build Database[] from intellisense columns (pure, testable).
 */
export function buildDatabaseStructureFromColumns(
  columns: IntellisenseData["columns"]
): Database[] {
  const databaseMap: Record<string, Database> = {};

  for (const item of columns) {
    const { database, table, column_name, column_type } = item;

    if (!databaseMap[database]) {
      databaseMap[database] = {
        name: database,
        type: "database",
        children: [],
      };
    }

    let tableObj = databaseMap[database].children.find((t) => t.name === table);
    if (!tableObj) {
      tableObj = {
        name: table,
        type: "table",
        children: [],
      };
      databaseMap[database].children.push(tableObj);
    }

    tableObj.children.push({
      name: column_name,
      type: column_type,
    });
  }

  return Object.values(databaseMap);
}

/**
 * Resolve an alias or table name to the actual table reference in scope.
 * Useful for alias.column completion.
 */
export function resolveTableAlias(
  aliasOrTable: string,
  tablesInScope: TableInScope[]
): TableInScope | undefined {
  return tablesInScope.find(
    (t) =>
      t.alias === aliasOrTable ||
      t.table === aliasOrTable ||
      (t.database && `${t.database}.${t.table}` === aliasOrTable)
  );
}
