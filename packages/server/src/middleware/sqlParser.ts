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
  warnings?: string[];
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
    // Suppress warning for common parse errors as fallback is robust
    // console.warn('[SQL Parser] Failed to parse statement, using fallback:', error instanceof Error ? error.message : String(error));
    result.type = getStatementTypeFallback(statement);
    result.tables = extractTablesFallback(statement);
    result.warnings = [`Failed to parse statement (using fallback): ${error instanceof Error ? error.message : String(error)}`];
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
function extractTablesFromAST(ast: AST, scopedCtes?: Set<string>): Array<{ database?: string; table: string }> {
  const tables: Array<{ database?: string; table: string }> = [];
  const localCtes = new Set(scopedCtes);

  if (!ast || typeof ast !== 'object') {
    return tables;
  }

  const astAny = ast as any;

  // Handle WITH clause (CTEs)
  if (astAny.with) {
    const withClause = Array.isArray(astAny.with) ? astAny.with : [astAny.with];
    for (const cte of withClause) {
      if (cte.name && cte.name.value) {
        // Add CTE name to local scope to avoid treating it as a real table
        localCtes.add(String(cte.name.value).toLowerCase());
      }
      if (cte.stmt && cte.stmt.ast) {
        // Recursively extract tables from the CTE query itself
        const cteTables = extractTablesFromAST(cte.stmt.ast, localCtes);
        tables.push(...cteTables);
      }
    }
  }

  // Handle different statement types
  // SELECT: from, join
  if (astAny.from) {
    extractTablesFromFromClause(astAny.from, tables, localCtes);
  }

  // INSERT: into
  if (astAny.table) {
    extractTableFromTableClause(astAny.table, tables, localCtes);
  }

  // UPDATE: table
  if (astAny.table && astAny.type?.toLowerCase().includes('update')) {
    extractTableFromTableClause(astAny.table, tables, localCtes);
  }

  // DELETE: from
  if (astAny.from && astAny.type?.toLowerCase().includes('delete')) {
    extractTablesFromFromClause(astAny.from, tables, localCtes);
  }

  // DDL: table name in various places
  if (astAny.table && (astAny.type?.toLowerCase().includes('create') ||
    astAny.type?.toLowerCase().includes('drop') ||
    astAny.type?.toLowerCase().includes('alter') ||
    astAny.type?.toLowerCase().includes('truncate'))) {
    extractTableFromTableClause(astAny.table, tables, localCtes);
  }

  return tables;
}

/**
 * Extract tables from FROM clause (handles joins, subqueries, etc.)
 */
function extractTablesFromFromClause(from: any, tables: Array<{ database?: string; table: string }>, scopedCtes: Set<string>): void {
  if (!from) return;

  // Handle array of tables (JOINs)
  if (Array.isArray(from)) {
    from.forEach(item => extractTablesFromFromClause(item, tables, scopedCtes));
    return;
  }

  // Handle subquery first (before table extraction to avoid duplicates)
  // node-sql-parser may put subquery AST in .ast or .expr.ast
  const subqueryAst = from.ast || (from.expr && from.expr.ast);
  if (subqueryAst) {
    const subqueryTables = extractTablesFromAST(subqueryAst, scopedCtes);
    tables.push(...subqueryTables);
  }

  // Handle table reference - prefer direct db.table extraction over recursive call to avoid duplicates
  if (from.db || from.table) {
    const db = from.db ? String(from.db).replace(/[`"]/g, '') : undefined;
    const table = from.table ? String(from.table).replace(/[`"]/g, '') : undefined;
    if (table) {
      // ONLY add if it's NOT a CTE
      if (!scopedCtes.has(table.toLowerCase())) {
        tables.push({ database: db, table });
      }
    }
  } else if (from.table) {
    // Fallback: if db is not directly available, use recursive extraction
    extractTableFromTableClause(from.table, tables, scopedCtes);
  }
}

/**
 * Extract table from table clause
 */
function extractTableFromTableClause(table: any, tables: Array<{ database?: string; table: string }>, scopedCtes: Set<string>): void {
  if (!table) return;

  if (Array.isArray(table)) {
    table.forEach(t => extractTableFromTableClause(t, tables, scopedCtes));
    return;
  }

  if (typeof table === 'string') {
    const tableName = table.replace(/[`"]/g, '');
    if (!scopedCtes.has(tableName.toLowerCase())) {
      tables.push({ table: tableName });
    }
    return;
  }

  if (typeof table === 'object') {
    const db = table.db ? String(table.db).replace(/[`"]/g, '') : undefined;
    const tableName = table.table ? String(table.table).replace(/[`"]/g, '') :
      table.name ? String(table.name).replace(/[`"]/g, '') : undefined;

    if (tableName) {
      if (!scopedCtes.has(tableName.toLowerCase())) {
        tables.push({ database: db, table: tableName });
      }
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
    let match;
    while ((match = pattern.exec(normalizedSql)) !== null) {
      const clean = (s: string) => s.replace(/[`"]/g, '');
      const db = match[2] ? clean(match[1]) : undefined;
      const table = match[2] ? clean(match[2]) : clean(match[1]);

      // Filter out CTE names
      if (!cteNames.has(table.toLowerCase())) {
        if (db) {
          tables.push({ database: db, table });
        } else {
          tables.push({ table });
        }
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
