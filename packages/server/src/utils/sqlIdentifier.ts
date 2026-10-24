/**
 * SQL Identifier Validation and Escaping Utilities
 * 
 * Provides secure validation and escaping for SQL identifiers (database, table, column names)
 * to prevent SQL injection attacks in ClickHouse queries.
 */

// ============================================
// SQL Identifier Validation
// ============================================

/**
 * Validates a SQL identifier (database, table, column name)
 * ClickHouse identifiers must:
 * - Start with a letter or underscore
 * - Contain only letters, digits, and underscores
 * - Be between 1 and 64 characters (ClickHouse limit)
 * - Not be a reserved keyword (basic check)
 */
export function validateIdentifier(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  // Check length (ClickHouse identifier limit is 63 characters, but we allow up to 64 for safety)
  if (name.length < 1 || name.length > 64) {
    return false;
  }

  // Must start with letter or underscore
  if (!/^[a-zA-Z_]/.test(name)) {
    return false;
  }

  // Can only contain letters, digits, and underscores
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return false;
  }

  // Basic reserved keyword check (common ClickHouse keywords).
  // 'default' is excluded: it is the built-in default database name in ClickHouse.
  const reservedKeywords = new Set([
    'select', 'from', 'where', 'insert', 'update', 'delete', 'create', 'drop',
    'alter', 'table', 'database', 'index', 'view', 'as', 'on', 'join', 'inner',
    'left', 'right', 'full', 'outer', 'union', 'all', 'distinct', 'group', 'by',
    'order', 'having', 'limit', 'offset', 'case', 'when', 'then', 'else', 'end',
    'if', 'exists', 'in', 'not', 'and', 'or', 'like', 'between', 'is', 'null',
    'true', 'false', 'primary', 'key', 'foreign', 'references',
    'constraint', 'unique', 'check', 'engine', 'partition', 'cluster'
  ]);

  if (reservedKeywords.has(name.toLowerCase())) {
    return false;
  }

  return true;
}

/**
 * Escapes a SQL identifier for ClickHouse
 * ClickHouse uses backticks (`) for identifier quoting
 * Backticks within identifiers are escaped by doubling them (``)
 * 
 * @throws Error if identifier is invalid
 */
export function escapeIdentifier(name: string): string {
  if (!validateIdentifier(name)) {
    throw new Error(
      `Invalid SQL identifier: "${name}". ` +
      'Identifiers must start with a letter or underscore, contain only alphanumeric characters and underscores, ' +
      'be 1-64 characters long, and not be a reserved keyword.'
    );
  }

  // ClickHouse uses backticks for identifiers
  // Escape backticks by doubling them
  const escaped = name.replace(/`/g, '``');
  return `\`${escaped}\``;
}

/**
 * Validates and escapes multiple identifiers (e.g., database.table)
 * @param identifiers Array of identifier parts (e.g., ['database', 'table'])
 * @returns Escaped identifier string (e.g., `database`.`table`)
 */
export function escapeQualifiedIdentifier(identifiers: string[]): string {
  if (!Array.isArray(identifiers) || identifiers.length === 0) {
    throw new Error('At least one identifier is required');
  }

  return identifiers.map(escapeIdentifier).join('.');
}

/**
 * Validates a column type against a whitelist
 * Prevents injection through type specifications
 */
const ALLOWED_COLUMN_TYPES = new Set([
  // Numeric types
  'Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256',
  'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256',
  'Float32', 'Float64',
  'Decimal', 'Decimal32', 'Decimal64', 'Decimal128', 'Decimal256',
  // String types
  'String', 'FixedString',
  // Date/Time types
  'Date', 'Date32', 'DateTime', 'DateTime32', 'DateTime64',
  // Boolean
  'Bool',
  // UUID
  'UUID',
  // JSON
  'JSON', 'Object',
  // Array
  'Array',
  // Nullable
  'Nullable',
  // LowCardinality
  'LowCardinality',
  // Tuple
  'Tuple',
  // Map
  'Map',
  // Nested
  'Nested',
  // Enum
  'Enum8', 'Enum16',
  // IP
  'IPv4', 'IPv6',
  // AggregateFunction
  'AggregateFunction',
]);

/**
 * Validates a column type string
 * Checks if the type (or base type) is in the whitelist
 * Supports parameterized types like Array(String), Nullable(Int32), etc.
 */
export function validateColumnType(type: string): boolean {
  if (!type || typeof type !== 'string') {
    return false;
  }

  // Extract base type (handle parameterized types like Array(String), Nullable(Int32))
  const baseTypeMatch = type.match(/^(\w+)/);
  if (!baseTypeMatch) {
    return false;
  }

  const baseType = baseTypeMatch[1];
  // The whole string is interpolated into DDL, so it must be nothing more than
  // the type: a bare name or a name with one balanced argument list.
  return ALLOWED_COLUMN_TYPES.has(baseType) && isNameWithOptionalArgs(type.trim());
}

const QUERY_KEYWORDS = new Set(['SELECT', 'FROM', 'WITH', 'JOIN', 'UNION', 'SETTINGS', 'FORMAT', 'INTO']);

/**
 * True when `text` is `Name` or `Name(args)` with nothing after it, where the
 * arguments are only identifiers, numbers, plain string literals (no quotes or
 * backslashes inside), commas, `=`, `-`, `.` and nested balanced parentheses.
 * That covers type and engine signatures such as `Map(String, Array(UInt64))`,
 * `Enum8('a' = 1)` or `ReplicatedMergeTree('/ch/{shard}/t', '{replica}')`, and
 * leaves no way to close the clause and append more SQL.
 */
export function isNameWithOptionalArgs(text: string): boolean {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(\(.*\))?$/s.exec(text);
  if (!match) return false;
  const args = match[2];
  if (!args) return true;

  const tokens = /\s+|[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?|'[^'\\]*'|[(),=.-]/y;
  let depth = 0;
  let index = 0;
  while (index < args.length) {
    tokens.lastIndex = index;
    const token = tokens.exec(args);
    if (!token) return false;
    // Arguments are literals and names, never a query.
    if (QUERY_KEYWORDS.has(token[0].toUpperCase())) return false;
    if (token[0] === '(') depth++;
    if (token[0] === ')') {
      depth--;
      // Closing the outer list before the end would let text follow it.
      if (depth < 0 || (depth === 0 && tokens.lastIndex !== args.length)) return false;
    }
    index = tokens.lastIndex;
  }
  return depth === 0;
}

const KEY_CLAUSE_KEYWORDS = new Set(['AS', 'ORDER', 'PARTITION', 'PRIMARY', 'SAMPLE', 'TTL', 'ENGINE', 'COMMENT']);

/**
 * True when `text` is a plain key expression for ORDER BY / PARTITION BY /
 * PRIMARY KEY: column names, function calls, numbers, arithmetic and commas,
 * with balanced parentheses. No literals, keywords or clauses can follow.
 */
export function isSafeKeyExpression(text: string): boolean {
  if (!text || typeof text !== 'string' || !text.trim()) return false;
  const tokens = /\s+|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[(),+\-*\/%.]/y;
  let depth = 0;
  let index = 0;
  while (index < text.length) {
    tokens.lastIndex = index;
    const token = tokens.exec(text);
    if (!token) return false;
    const upper = token[0].toUpperCase();
    if (QUERY_KEYWORDS.has(upper) || KEY_CLAUSE_KEYWORDS.has(upper)) return false;
    if (token[0] === '(') depth++;
    if (token[0] === ')' && --depth < 0) return false;
    index = tokens.lastIndex;
  }
  return depth === 0;
}

/**
 * Table engines that only store data locally. Engines that read from other
 * tables, servers, files or URLs (Merge, Distributed, URL, File, S3, MySQL, …)
 * would expose data outside the creator's data access rules, so non-admins are
 * limited to these.
 */
const LOCAL_TABLE_ENGINES = new Set([
  'MergeTree', 'ReplacingMergeTree', 'SummingMergeTree', 'AggregatingMergeTree',
  'CollapsingMergeTree', 'VersionedCollapsingMergeTree',
  'ReplicatedMergeTree', 'ReplicatedReplacingMergeTree', 'ReplicatedSummingMergeTree',
  'ReplicatedAggregatingMergeTree', 'ReplicatedCollapsingMergeTree',
  'ReplicatedVersionedCollapsingMergeTree',
  'Memory', 'Log', 'TinyLog', 'StripeLog', 'Null', 'Set',
]);

/** Database engines that keep tables locally (no MySQL/PostgreSQL/SQLite/… proxies). */
const LOCAL_DATABASE_ENGINES = new Set(['Atomic', 'Ordinary', 'Lazy', 'Replicated', 'Memory']);

function validateEngine(engine: string, allowed: ReadonlySet<string>, allowAnyEngine: boolean): boolean {
  if (!engine || typeof engine !== 'string') return false;
  const trimmed = engine.trim();
  if (!isNameWithOptionalArgs(trimmed)) return false;
  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed)?.[0] ?? '';
  return allowAnyEngine || allowed.has(name);
}

/** Validate a CREATE TABLE engine clause. Admins may use any engine name. */
export function validateTableEngine(engine: string, allowAnyEngine: boolean): boolean {
  return validateEngine(engine, LOCAL_TABLE_ENGINES, allowAnyEngine);
}

/** Validate a CREATE DATABASE engine clause. Admins may use any engine name. */
export function validateDatabaseEngine(engine: string, allowAnyEngine: boolean): boolean {
  return validateEngine(engine, LOCAL_DATABASE_ENGINES, allowAnyEngine);
}

/**
 * Quote a value as a ClickHouse string literal. ClickHouse treats `\` as an
 * escape character, so it must be escaped along with the quote — escaping the
 * quote alone lets a trailing backslash swallow the closing quote.
 */
export function quoteStringLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Validates a format string (for INSERT ... FORMAT)
 */
const ALLOWED_FORMATS = new Set([
  'CSV', 'TSV', 'JSON', 'JSONEachRow', 'JSONCompact', 'JSONCompactEachRow',
  'JSONEachRowWithNames', 'JSONEachRowWithNamesAndTypes', 'JSONStrings',
  'JSONCompactStrings', 'JSONObjectEachRow', 'Values', 'Vertical', 'XML',
  'Parquet', 'Arrow', 'ArrowStream', 'Native', 'RowBinary', 'RowBinaryWithNames',
  'RowBinaryWithNamesAndTypes', 'CapnProto', 'LineAsString', 'RawBLOB', 'MsgPack'
]);

export function validateFormat(format: string): boolean {
  if (!format || typeof format !== 'string') {
    return false;
  }
  return ALLOWED_FORMATS.has(format.toUpperCase());
}
