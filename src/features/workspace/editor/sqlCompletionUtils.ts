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
  /** Tables from FROM/JOIN clauses before cursor; used to suggest columns in SELECT/WHERE/ON */
  tablesInScope: TableInScope[];
}

/**
 * Get table references from FROM and JOIN clauses before the cursor.
 * Used to suggest columns in SELECT/WHERE/ON (column-level completion).
 */
export function getTablesInScope(
  query: string,
  position: EditorPosition
): TableInScope[] {
  const lines = query.split("\n");
  const beforeCursor =
    lines
      .slice(0, position.lineNumber - 1)
      .join("\n") +
    "\n" +
    (lines[position.lineNumber - 1]?.substring(0, position.column) ?? "");
  const tokens = beforeCursor.split(/\s+/).filter((t) => t.length > 0);
  const result: TableInScope[] = [];
  let i = 0;

  while (i < tokens.length) {
    const lower = tokens[i].toLowerCase();
    if (lower === "from" || lower === "join") {
      i += 1;
      if (i >= tokens.length) break;
      const tableToken = tokens[i];
      if (tableToken.toLowerCase() === "(") {
        i += 1;
        continue;
      }
      const ref = parseTableRef(tableToken);
      i += 1;
      if (i < tokens.length && tokens[i].toLowerCase() === "as") {
        i += 1;
        if (i < tokens.length) {
          ref.alias = tokens[i];
          i += 1;
        }
      }
      if (!result.some((r) => r.database === ref.database && r.table === ref.table && r.alias === ref.alias)) {
        result.push(ref);
      }
      continue;
    }
    if (lower === "left" || lower === "right" || lower === "inner" || lower === "outer" || lower === "cross") {
      i += 1;
      if (i < tokens.length && tokens[i].toLowerCase() === "join") {
        i += 1;
        if (i >= tokens.length) break;
        const tableToken = tokens[i];
        if (tableToken.toLowerCase() === "(") {
          i += 1;
          continue;
        }
        const ref = parseTableRef(tableToken);
        i += 1;
        if (i < tokens.length && tokens[i].toLowerCase() === "as") {
          i += 1;
          if (i < tokens.length) {
            ref.alias = tokens[i];
            i += 1;
          }
        }
        if (!result.some((r) => r.database === ref.database && r.table === ref.table && r.alias === ref.alias)) {
          result.push(ref);
        }
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

/**
 * Parse the SQL query to determine the context at the given position.
 * Used to order/filter completion suggestions (e.g. tables after FROM, columns after SELECT).
 */
export function parseQueryContext(
  query: string,
  position: EditorPosition
): ParseQueryContextResult {
  const lines = query.split("\n");
  const currentLine = lines[position.lineNumber - 1]?.substring(0, position.column) ?? "";
  const tokens = currentLine.split(/\s+/).filter((t) => t.length > 0);

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
    if (lower === "join" || lower === "inner" || lower === "left" || lower === "right") {
      kind = "afterJoin";
      break;
    }
    if (lower === "on") {
      kind = "afterOn";
      break;
    }
    if (lower === "where") {
      kind = "afterWhere";
      break;
    }
    if (lower === "select" || token === ",") {
      kind = "afterSelect";
      break;
    }
  }

  const tablesInScope =
    kind === "afterSelect" || kind === "afterWhere" || kind === "afterOn"
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
