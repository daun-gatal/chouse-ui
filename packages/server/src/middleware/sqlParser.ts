/**
 * SQL Parser Utility
 * 
 * Uses node-sql-parser for robust, AST-based SQL parsing.
 * This replaces hardcoded regex patterns with a proper SQL parser that:
 * - Handles all SQL edge cases correctly
 * - Supports multiple SQL dialects
 * - Generates Abstract Syntax Tree (AST) for accurate analysis
 * - Extracts tables, columns, and statement types reliably
 */

import { Parser, AST } from 'node-sql-parser';

// Initialize parser with MySQL dialect (ClickHouse SQL is similar)
const parser = new Parser();

export interface TableRef {
  database?: string;
  table: string;
  /**
   * Read from by the statement rather than written to (a subquery, UNION arm,
   * INSERT … SELECT source, dictionary lookup). Checked for read access only.
   */
  source?: boolean;
}

export interface ParsedStatement {
  statement: string;
  type: 'select' | 'insert' | 'update' | 'delete' | 'create' | 'drop' | 'alter' | 'truncate' | 'show' | 'describe' | 'use' | 'set' | 'explain' | 'exists' | 'check' | 'kill' | 'unknown';
  tables: TableRef[];
  /** Lower-cased names of table functions used as a FROM/JOIN source, e.g. `remote`. */
  tableFunctions?: string[];
  ast?: AST | AST[];
  warnings?: string[];
}

/**
 * Table functions that only generate or parse inline data and can't reach a
 * table, file, URL or other server. Any other table function (remote, cluster,
 * merge, url, file, s3, mysql, …) can read data outside the user's data access
 * rules, so it is denied to non-admins.
 */
export const SAFE_TABLE_FUNCTIONS: ReadonlySet<string> = new Set([
  'numbers',
  'numbers_mt',
  'zeros',
  'zeros_mt',
  'generaterandom',
  'generate_series',
  'generateseries',
  'values',
  'null',
  'input',
  'format',
]);

export type AccessType = 'read' | 'write' | 'admin' | 'misc';

/**
 * Split SQL query into individual statements
 * Uses proper SQL parsing to handle all edge cases
 */
export function splitSqlStatements(sql: string): string[] {
  // First, use a simple splitter for semicolons, but we'll validate with parser
  const statements: string[] = [];
  let currentStatement = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const nextChar = i + 1 < sql.length ? sql[i + 1] : '';
    const prevChar = i > 0 ? sql[i - 1] : '';

    // Handle block comments
    if (!inSingleQuote && !inDoubleQuote && !inBacktick && !inLineComment) {
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        currentStatement += char;
        i++;
        continue;
      }
      if (inBlockComment && char === '*' && nextChar === '/') {
        inBlockComment = false;
        currentStatement += char + nextChar;
        i += 2;
        continue;
      }
      if (inBlockComment) {
        currentStatement += char;
        i++;
        continue;
      }
    }

    // Handle line comments
    if (!inSingleQuote && !inDoubleQuote && !inBacktick && !inBlockComment) {
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
        currentStatement += char;
        i++;
        continue;
      }
      if (inLineComment && char === '\n') {
        inLineComment = false;
        currentStatement += char;
        i++;
        continue;
      }
      if (inLineComment) {
        currentStatement += char;
        i++;
        continue;
      }
    }

    // Handle quotes
    if (!inBlockComment && !inLineComment) {
      if (char === "'" && !inDoubleQuote && !inBacktick && prevChar !== '\\') {
        inSingleQuote = !inSingleQuote;
        currentStatement += char;
        i++;
        continue;
      }
      if (char === '"' && !inSingleQuote && !inBacktick && prevChar !== '\\') {
        inDoubleQuote = !inDoubleQuote;
        currentStatement += char;
        i++;
        continue;
      }
      if (char === '`' && !inSingleQuote && !inDoubleQuote && prevChar !== '\\') {
        inBacktick = !inBacktick;
        currentStatement += char;
        i++;
        continue;
      }
    }

    // Handle semicolons (statement separators)
    if (!inSingleQuote && !inDoubleQuote && !inBacktick && !inBlockComment && !inLineComment) {
      if (char === ';') {
        const trimmed = currentStatement.trim();
        if (trimmed) {
          statements.push(trimmed);
        }
        currentStatement = '';
        i++;
        continue;
      }
    }

    currentStatement += char;
    i++;
  }

  // Add the last statement if it doesn't end with semicolon
  const trimmed = currentStatement.trim();
  if (trimmed) {
    statements.push(trimmed);
  }

  return statements.filter(s => s.length > 0);
}

/**
 * Parse a single SQL statement using AST
 * Returns parsed information including statement type and tables
 */
export function parseStatement(statement: string): ParsedStatement {
  const result: ParsedStatement = {
    statement,
    type: 'unknown',
    tables: [],
  };

  try {
    // Try to parse the statement
    const ast = parser.astify(statement);
    result.ast = ast;

    // Determine statement type from AST
    if (Array.isArray(ast)) {
      // The splitter and the parser disagree on where statements end (e.g. an
      // escaped quote). Only the first would be checked, so fail closed: an
      // unknown type is always denied.
      const firstStmt = ast[0];
      result.type = ast.length === 1 ? getStatementTypeFromAST(firstStmt) : 'unknown';
      result.tables = extractTablesFromAST(firstStmt);
      result.tableFunctions = extractTableFunctionsFromAST(firstStmt);
    } else {
      result.type = getStatementTypeFromAST(ast);
      result.tables = extractTablesFromAST(ast);
      result.tableFunctions = extractTableFunctionsFromAST(ast);
    }
  } catch (error) {
    // If parsing fails, fall back to simple pattern matching
    // This handles edge cases like system queries, ClickHouse-specific syntax, etc.
    result.type = getStatementTypeFallback(statement);
    result.tables = extractTablesFallback(statement, result.type);
    result.tableFunctions = extractTableFunctionsFallback(statement);
    result.warnings = [`Failed to parse statement (using fallback): ${error instanceof Error ? error.message : String(error)}`];
  }

  // Dictionary / Join-engine lookups read table data from inside an expression,
  // where neither the AST walk nor the FROM/JOIN patterns look.
  result.tables.push(...extractDictionaryReads(statement));

  return result;
}

/**
 * Get statement type from AST
 */
function getStatementTypeFromAST(ast: AST): ParsedStatement['type'] {
  if (!ast || typeof ast !== 'object') {
    return 'unknown';
  }

  const type = (ast as any).type?.toLowerCase() || '';

  if (type.includes('select')) return 'select';
  if (type.includes('insert')) return 'insert';
  if (type.includes('update')) return 'update';
  if (type.includes('delete')) return 'delete';
  if (type.includes('create')) return 'create';
  if (type.includes('drop')) return 'drop';
  if (type.includes('alter')) return 'alter';
  if (type.includes('truncate')) return 'truncate';
  if (type.includes('show')) return 'show';
  if (type.includes('describe') || type.includes('desc')) return 'describe';
  if (type.includes('use')) return 'use';
  if (type.includes('set')) return 'set';
  if (type.includes('explain')) return 'explain';
  if (type.includes('exists')) return 'exists';
  if (type.includes('check')) return 'check';
  if (type.includes('kill')) return 'kill';

  return 'unknown';
}

/**
 * Extract tables from AST.
 *
 * Tables are collected from the statement's own FROM/JOIN/target clauses and
 * from every statement nested anywhere inside it — scalar subqueries, IN /
 * EXISTS subqueries, UNION arms, INSERT … SELECT and CREATE … AS SELECT
 * sources. Missing one lets a query read a table its data access rules deny,
 * so nested tables are found by walking the whole tree, not a fixed set of keys.
 */
function extractTablesFromAST(ast: AST, scopedCtes?: Set<string>, nested = false): TableRef[] {
  const tables: TableRef[] = [];
  const localCtes = new Set(scopedCtes);

  if (!ast || typeof ast !== 'object') {
    return tables;
  }

  const astAny = ast as any;

  // Register CTE names first so references to them are not treated as tables.
  // Their bodies are reached by the nested-statement walk below.
  if (astAny.with) {
    const withClause = Array.isArray(astAny.with) ? astAny.with : [astAny.with];
    for (const cte of withClause) {
      if (cte.name && cte.name.value) {
        localCtes.add(String(cte.name.value).toLowerCase());
      }
    }
  }

  const type = typeof astAny.type === 'string' ? astAny.type.toLowerCase() : '';
  // A top-level SELECT reads its FROM tables; DELETE writes its FROM table.
  // Everything found inside a nested statement is only ever read.
  const fromIsSource = nested || !type.includes('delete');

  if (astAny.from) {
    extractTablesFromFromClause(astAny.from, tables, localCtes, fromIsSource);
  }

  // INSERT / UPDATE / DDL target
  if (astAny.table) {
    extractTableFromTableClause(astAny.table, tables, localCtes, nested);
  }

  collectNestedStatementTables(astAny, localCtes, tables, new Set([astAny]));

  return tables;
}

const STATEMENT_NODE_TYPES = new Set(['select', 'insert', 'replace', 'update', 'delete']);

function isStatementNode(node: unknown): boolean {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const type = (node as { type?: unknown }).type;
  return typeof type === 'string' && STATEMENT_NODE_TYPES.has(type.toLowerCase());
}

/** Walk every value under `node` and extract tables from each nested statement. */
function collectNestedStatementTables(node: unknown, scopedCtes: Set<string>, tables: TableRef[], seen: Set<unknown>): void {
  if (!node || typeof node !== 'object') return;
  const children = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
  for (const child of children) {
    if (!child || typeof child !== 'object' || seen.has(child)) continue;
    seen.add(child);
    if (isStatementNode(child)) {
      // The nested call walks its own subtree.
      tables.push(...extractTablesFromAST(child as AST, scopedCtes, true));
    } else {
      collectNestedStatementTables(child, scopedCtes, tables, seen);
    }
  }
}

/** A name only refers to a CTE when it is unqualified. `db.t` is always a table. */
function isCteReference(database: string | undefined, table: string, scopedCtes: Set<string>): boolean {
  return !database && scopedCtes.has(table.toLowerCase());
}

/**
 * Extract tables from FROM clause (handles joins and table references).
 * Subqueries in FROM are reached by the nested-statement walk.
 */
function extractTablesFromFromClause(from: any, tables: TableRef[], scopedCtes: Set<string>, source: boolean): void {
  if (!from) return;

  if (Array.isArray(from)) {
    from.forEach(item => extractTablesFromFromClause(item, tables, scopedCtes, source));
    return;
  }

  if (from.db || from.table) {
    const db = from.db ? String(from.db).replace(/[`"]/g, '') : undefined;
    const table = from.table ? String(from.table).replace(/[`"]/g, '') : undefined;
    if (table && !isCteReference(db, table, scopedCtes)) {
      tables.push({ database: db, table, ...(source ? { source: true } : {}) });
    }
  }
}

/**
 * Extract table from table clause
 */
function extractTableFromTableClause(table: any, tables: TableRef[], scopedCtes: Set<string>, source: boolean): void {
  if (!table) return;

  if (Array.isArray(table)) {
    table.forEach(t => extractTableFromTableClause(t, tables, scopedCtes, source));
    return;
  }

  const flag = source ? { source: true } : {};

  if (typeof table === 'string') {
    const tableName = table.replace(/[`"]/g, '');
    if (!isCteReference(undefined, tableName, scopedCtes)) {
      tables.push({ table: tableName, ...flag });
    }
    return;
  }

  if (typeof table === 'object') {
    const db = table.db ? String(table.db).replace(/[`"]/g, '') : undefined;
    const tableName = table.table ? String(table.table).replace(/[`"]/g, '') :
      table.name ? String(table.name).replace(/[`"]/g, '') : undefined;

    if (tableName && !isCteReference(db, tableName, scopedCtes)) {
      tables.push({ database: db, table: tableName, ...flag });
    }
  }
}

/** Name of a function node, whatever shape node-sql-parser gave it. */
function functionName(expr: any): string | undefined {
  const name = expr?.name;
  if (typeof name === 'string') return name;
  if (Array.isArray(name?.name)) {
    return name.name.map((part: any) => part?.value ?? '').filter(Boolean).join('.') || undefined;
  }
  return undefined;
}

/** Table functions used as a FROM/JOIN source anywhere in the statement. */
function extractTableFunctionsFromAST(ast: AST): string[] {
  const found = new Set<string>();
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const from = (node as { from?: unknown }).from;
    if (Array.isArray(from)) {
      for (const item of from) {
        const expr = (item as { expr?: { type?: string } } | null)?.expr;
        if (expr?.type === 'function') {
          const name = functionName(expr);
          if (name) found.add(name.toLowerCase());
        }
      }
    }
    Object.values(node as Record<string, unknown>).forEach(visit);
  };
  visit(ast);
  return [...found];
}

/** Strip comments and string/identifier literals so patterns only see SQL. */
function stripLiterals(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
}

/** Fallback: table functions in FROM/JOIN position, e.g. `FROM remote(...)`. */
function extractTableFunctionsFallback(statement: string): string[] {
  const found = new Set<string>();
  const pattern = /\b(?:FROM|JOIN)\s+([A-Za-z_][\w]*)\s*\(/gi;
  let match;
  while ((match = pattern.exec(stripLiterals(statement))) !== null) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}

/**
 * `dictGet('db.dict', …)`, `joinGet('db.table', …)` and friends read a
 * dictionary or Join-engine table named by a string argument. Report the named
 * object as a read so it is checked like any other table.
 */
function extractDictionaryReads(statement: string): TableRef[] {
  const tables: TableRef[] = [];
  const cleaned = statement.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const pattern = /\b(?:dictGet\w*|dictHas|dictIsIn|joinGet\w*)\s*\(\s*'([^']+)'/gi;
  let match;
  while ((match = pattern.exec(cleaned)) !== null) {
    const name = match[1].replace(/[`"]/g, '');
    const dot = name.indexOf('.');
    tables.push(dot > 0
      ? { database: name.slice(0, dot), table: name.slice(dot + 1), source: true }
      : { table: name, source: true });
  }
  return tables;
}

/**
 * Fallback: Get statement type using simple pattern matching
 * Used when AST parsing fails
 */
function getStatementTypeFallback(statement: string): ParsedStatement['type'] {
  const normalized = statement.trim().toUpperCase();

  if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) return 'select';
  if (normalized.startsWith('INSERT')) return 'insert';
  if (normalized.startsWith('UPDATE')) return 'update';
  if (normalized.startsWith('DELETE')) return 'delete';
  if (normalized.startsWith('CREATE')) return 'create';
  if (normalized.startsWith('DROP')) return 'drop';
  if (normalized.startsWith('ALTER')) return 'alter';
  if (normalized.startsWith('TRUNCATE')) return 'truncate';
  if (normalized.startsWith('SHOW')) return 'show';
  if (normalized.startsWith('DESCRIBE') || normalized.startsWith('DESC')) return 'describe';
  if (normalized.startsWith('USE')) return 'use';
  if (normalized.startsWith('SET')) return 'set';
  if (normalized.startsWith('EXPLAIN')) return 'explain';
  if (normalized.startsWith('EXISTS')) return 'exists';
  if (normalized.startsWith('CHECK')) return 'check';
  if (normalized.startsWith('KILL')) return 'kill';

  return 'unknown';
}

/**
 * Fallback: Extract tables using regex patterns
 * Used when AST parsing fails
 */
function extractTablesFallback(statement: string, type: ParsedStatement['type']): TableRef[] {
  const tables: TableRef[] = [];
  // DELETE FROM names its target; every other FROM/JOIN is a source read.
  const fromIsSource = type !== 'delete';
  const normalizedSql = statement.replace(/\s+/g, ' ').trim();

  // Extract CTE names to filter them out
  const cteNames = extractCTENamesFallback(statement);

  const patterns = [
    /FROM\s+([`"]?[\w]+[`"]?)\.([`"]?[\w]+[`"]?)/gi,
    /FROM\s+([`"]?[\w]+[`"]?)/gi,
    /INTO\s+([`"]?[\w]+[`"]?)\.([`"]?[\w]+[`"]?)/gi,
    /INTO\s+([`"]?[\w]+[`"]?)/gi,
    /UPDATE\s+([`"]?[\w]+[`"]?)\.([`"]?[\w]+[`"]?)/gi,
    /UPDATE\s+([`"]?[\w]+[`"]?)/gi,
    /(?:DROP|CREATE|ALTER|TRUNCATE)\s+TABLE\s+([`"]?[\w]+[`"]?)\.([`"]?[\w]+[`"]?)/gi,
    /(?:DROP|CREATE|ALTER|TRUNCATE)\s+TABLE\s+([`"]?[\w]+[`"]?)/gi,
    /TABLE\s+([`"]?[\w]+[`"]?)\.([`"]?[\w]+[`"]?)/gi,
    /TABLE\s+([`"]?[\w]+[`"]?)/gi,
    /JOIN\s+([`"]?[\w]+[`"]?)\.([`"]?[\w]+[`"]?)/gi,
    /JOIN\s+([`"]?[\w]+[`"]?)/gi,
  ];

  for (const pattern of patterns) {
    const isSourcePattern = fromIsSource && /^(?:FROM|JOIN)/.test(pattern.source);
    let match;
    while ((match = pattern.exec(normalizedSql)) !== null) {
      const clean = (s: string) => s.replace(/[`"]/g, '');
      const db = match[2] ? clean(match[1]) : undefined;
      const table = match[2] ? clean(match[2]) : clean(match[1]);

      if (!isCteReference(db, table, cteNames)) {
        tables.push({
          ...(db ? { database: db } : {}),
          table,
          ...(isSourcePattern ? { source: true } : {}),
        });
      }
    }
  }

  return tables;
}

/**
 * Fallback helper to extract CTE names when AST parsing fails
 */
function extractCTENamesFallback(sql: string): Set<string> {
  const cteNames = new Set<string>();

  // Remove comments and strings to avoid false matches
  const cleanSql = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""');

  // Find WITH clause
  const withMatch = cleanSql.match(/\bWITH\s+/i);
  if (!withMatch) return cteNames;

  const startIdx = withMatch.index! + withMatch[0].length;
  let i = startIdx;
  let depth = 0;
  let currentCteName = '';
  let lookingForName = true;
  let lookingForAs = false;

  while (i < cleanSql.length) {
    const char = cleanSql[i];

    if (char === '(') {
      depth++;
      if (lookingForAs && depth === 1) {
        if (currentCteName) {
          cteNames.add(currentCteName.toLowerCase());
        }
        lookingForName = false;
        lookingForAs = false;
      }
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        lookingForName = true;
        currentCteName = '';
      }
    } else if (depth === 0) {
      if (lookingForName && /[a-zA-Z_]/.test(char)) {
        let word = '';
        while (i < cleanSql.length && /[a-zA-Z0-9_]/.test(cleanSql[i])) {
          word += cleanSql[i];
          i++;
        }
        i--;

        const upperWord = word.toUpperCase();
        if (upperWord === 'SELECT') break;
        if (upperWord === 'AS') {
          lookingForAs = true;
          lookingForName = false;
        } else if (upperWord !== 'WITH' && upperWord !== 'RECURSIVE') {
          currentCteName = word;
          lookingForAs = false;
        }
      } else if (char === ',') {
        lookingForName = true;
        currentCteName = '';
      }
    }
    i++;
  }

  return cteNames;
}

/**
 * Convert parsed statement type to access type
 */
export function getAccessTypeFromStatementType(statementType: ParsedStatement['type']): AccessType {
  switch (statementType) {
    case 'select':
      return 'read';
    case 'show':
    case 'describe':
    case 'use':
    case 'set':
    case 'explain':
    case 'exists':
    case 'check':
    case 'kill':
      return 'misc';
    case 'insert':
    case 'update':
    case 'delete':
      return 'write';
    case 'create':
    case 'drop':
    case 'alter':
    case 'truncate':
      return 'admin';
    default:
      return 'misc'; // Default to misc instead of read for safety (unknown commands shouldn't query data)
  }
}
