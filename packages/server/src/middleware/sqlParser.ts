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

export interface ParsedStatement {
  statement: string;
  type: 'select' | 'insert' | 'update' | 'delete' | 'create' | 'drop' | 'alter' | 'truncate' | 'show' | 'describe' | 'use' | 'set' | 'explain' | 'exists' | 'check' | 'kill' | 'unknown';
  tables: Array<{ database?: string; table: string }>;
  ast?: AST | AST[];
}

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
      // Multiple statements in one (shouldn't happen after splitting, but handle it)
      const firstStmt = ast[0];
      result.type = getStatementTypeFromAST(firstStmt);
      result.tables = extractTablesFromAST(firstStmt);
    } else {
      result.type = getStatementTypeFromAST(ast);
      result.tables = extractTablesFromAST(ast);
    }
  } catch (error) {
    // If parsing fails, fall back to simple pattern matching
    // This handles edge cases like system queries, ClickHouse-specific syntax, etc.
    console.warn('[SQL Parser] Failed to parse statement, using fallback:', error instanceof Error ? error.message : String(error));
    result.type = getStatementTypeFallback(statement);
    result.tables = extractTablesFallback(statement);
  }

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
 * Extract tables from AST
 */
function extractTablesFromAST(ast: AST): Array<{ database?: string; table: string }> {
  const tables: Array<{ database?: string; table: string }> = [];

  if (!ast || typeof ast !== 'object') {
    return tables;
  }

  const astAny = ast as any;

  // Handle different statement types
  // SELECT: from, join
  if (astAny.from) {
    extractTablesFromFromClause(astAny.from, tables);
  }

  // INSERT: into
  if (astAny.table) {
    extractTableFromTableClause(astAny.table, tables);
  }

  // UPDATE: table
  if (astAny.table && astAny.type?.toLowerCase().includes('update')) {
    extractTableFromTableClause(astAny.table, tables);
  }

  // DELETE: from
  if (astAny.from && astAny.type?.toLowerCase().includes('delete')) {
    extractTablesFromFromClause(astAny.from, tables);
  }

  // DDL: table name in various places
  if (astAny.table && (astAny.type?.toLowerCase().includes('create') ||
    astAny.type?.toLowerCase().includes('drop') ||
    astAny.type?.toLowerCase().includes('alter') ||
    astAny.type?.toLowerCase().includes('truncate'))) {
    extractTableFromTableClause(astAny.table, tables);
  }

  return tables;
}

/**
 * Extract tables from FROM clause (handles joins, subqueries, etc.)
 */
function extractTablesFromFromClause(from: any, tables: Array<{ database?: string; table: string }>): void {
  if (!from) return;

  // Handle array of tables (JOINs)
  if (Array.isArray(from)) {
    from.forEach(item => extractTablesFromFromClause(item, tables));
    return;
  }

  // Handle subquery first (before table extraction to avoid duplicates)
  if (from.ast) {
    const subqueryTables = extractTablesFromAST(from.ast);
    tables.push(...subqueryTables);
  }

  // Handle table reference - prefer direct db.table extraction over recursive call to avoid duplicates
  if (from.db || from.table) {
    const db = from.db ? String(from.db).replace(/[`"]/g, '') : undefined;
    const table = from.table ? String(from.table).replace(/[`"]/g, '') : undefined;
    if (table) {
      tables.push({ database: db, table });
    }
  } else if (from.table) {
    // Fallback: if db is not directly available, use recursive extraction
    extractTableFromTableClause(from.table, tables);
  }
}

/**
 * Extract table from table clause
 */
function extractTableFromTableClause(table: any, tables: Array<{ database?: string; table: string }>): void {
  if (!table) return;

  if (Array.isArray(table)) {
    table.forEach(t => extractTableFromTableClause(t, tables));
    return;
  }

  if (typeof table === 'string') {
    tables.push({ table: table.replace(/[`"]/g, '') });
    return;
  }

  if (typeof table === 'object') {
    const db = table.db ? String(table.db).replace(/[`"]/g, '') : undefined;
    const tableName = table.table ? String(table.table).replace(/[`"]/g, '') :
      table.name ? String(table.name).replace(/[`"]/g, '') : undefined;

    if (tableName) {
      tables.push({ database: db, table: tableName });
    }
  }
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
function extractTablesFallback(statement: string): Array<{ database?: string; table: string }> {
  const tables: Array<{ database?: string; table: string }> = [];
  const normalizedSql = statement.replace(/\s+/g, ' ').trim();

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
    let match;
    while ((match = pattern.exec(normalizedSql)) !== null) {
      const clean = (s: string) => s.replace(/[`"]/g, '');
      if (match[2]) {
        tables.push({ database: clean(match[1]), table: clean(match[2]) });
      } else {
        tables.push({ table: clean(match[1]) });
      }
    }
  }

  return tables;
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
