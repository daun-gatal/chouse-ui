// ============================================
// SQL Identifier Validation and Escaping
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
  return ALLOWED_COLUMN_TYPES.has(baseType);
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

// ============================================
// Query Type Detection
// ============================================

export const isCreateOrInsert = (query: string) => {
  // Remove lines that start with '--'
  const cleanedQuery = query
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  const lowerQuery = cleanedQuery.toLowerCase();
  const createTableRegex = /\bcreate\s+table\b/;
  const insertRegex = /\binsert\b/;
  const alterRegex = /\balter\b/;
  const dropTableRegex = /\bdrop\s+table\b/;
  const dropColumnRegex = /\bdrop\s+column\b/;
  const dropIndexRegex = /\bdrop\s+index\b/;
  const createDatabase = /\bcreate\s+database\b/;
  const dropDatabase = /\bdrop\s+database\b/;
  const createTableAs = /\bcreate\s+table\s+as\b/;
  const createTableEngine = /\bcreate\s+table\s+engine\b/;
  const createTableIfNotExists = /\bcreate\s+table\s+if\s+not\s+exists\b/;
  const createTableLike = /\bcreate\s+table\s+like\b/;
  const createTableMaterialized = /\bcreate\s+table\s+materialized\b/;
  const createTableTemporary = /\bcreate\s+table\s+temporary\b/;
  const createTableTemporaryEngine = /\bcreate\s+table\s+temporary\s+engine\b/;
  const createTableTemporaryIfNotExists = /\bcreate\s+table\s+temporary\s+if\s+not\s+exists\b/;
  const createTableTemporaryLike = /\bcreate\s+table\s+temporary\s+like\b/;
  const createTableTemporaryMaterialized = /\bcreate\s+table\s+temporary\s+materialized\b/;
  const createTableTemporaryAs = /\bcreate\s+table\s+temporary\s+as\b/;
  const createTemporaryTable = /\bcreate\s+temporary\s+table\b/;
  // ClickHouse-specific patterns
  const createTableOnCluster = /\bcreate\s+table\s+on\s+cluster\b/;
  const createTableDistributed = /\bcreate\s+table\s+.*\bengine\s*=\s*Distributed\b/i;
  const createMaterializedView = /\bcreate\s+materialized\s+view\b/;
  const createView = /\bcreate\s+view\b/;
  const createDictionary = /\bcreate\s+dictionary\b/;
  const attachTable = /\battach\s+table\b/;
  const optimizeTable = /\boptimize\s+table\b/;
  const truncateTable = /\btruncate\s+table\b/;
  const renameTable = /\brename\s+table\b/;
  const createUser = /\bcreate\s+user\b/;
  const createRole = /\bcreate\s+role\b/;
  const dropRole = /\bdrop\s+role\b/;
  const grantRole = /\bgrant\s+role\b/;
  const revokeRole = /\brevoke\s+role\b/;
  const dropUser = /\bdrop\s+user\b/;
  const createQuota = /\bcreate\s+quota\b/;
  const dropQuota = /\bdrop\s+quota\b/;
  const alterQuota = /\balter\s+quota\b/;
  const createSetting = /\bcreate\s+setting\b/;
  const dropSetting = /\bdrop\s+setting\b/;
  const alterSetting = /\balter\s+setting\b/;
  const createFunction = /\bcreate\s+function\b/;
  const dropFunction = /\bdrop\s+function\b/;
  const alterFunction = /\balter\s+function\b/;
  const createAggregateFunction = /\bcreate\s+aggregate\s+function\b/;
  const dropAggregateFunction = /\bdrop\s+aggregate\s+function\b/;
  const alterAggregateFunction = /\balter\s+aggregate\s+function\b/;
  const grant = /\bgrant\b/;
  const revoke = /\brevoke\b/;
  const setAllowPattern = /\bset\s+allow_.*$/i;

  return (
    createTableRegex.test(lowerQuery) ||
    insertRegex.test(lowerQuery) ||
    alterRegex.test(lowerQuery) ||
    dropTableRegex.test(lowerQuery) ||
    dropColumnRegex.test(lowerQuery) ||
    dropIndexRegex.test(lowerQuery) ||
    createDatabase.test(lowerQuery) ||
    dropDatabase.test(lowerQuery) ||
    createTableAs.test(lowerQuery) ||
    createTableEngine.test(lowerQuery) ||
    createTableIfNotExists.test(lowerQuery) ||
    createTableLike.test(lowerQuery) ||
    createTableMaterialized.test(lowerQuery) ||
    createTableTemporary.test(lowerQuery) ||
    createTemporaryTable.test(lowerQuery) ||
    createTableTemporaryEngine.test(lowerQuery) ||
    createTableTemporaryIfNotExists.test(lowerQuery) ||
    createTableTemporaryLike.test(lowerQuery) ||
    createTableTemporaryMaterialized.test(lowerQuery) ||
    createTableTemporaryAs.test(lowerQuery) ||
    createTableOnCluster.test(lowerQuery) ||
    createTableDistributed.test(lowerQuery) ||
    createMaterializedView.test(lowerQuery) ||
    createView.test(lowerQuery) ||
    createDictionary.test(lowerQuery) ||
    attachTable.test(lowerQuery) ||
    optimizeTable.test(lowerQuery) ||
    truncateTable.test(lowerQuery) ||
    renameTable.test(lowerQuery) ||
    createUser.test(lowerQuery) ||
    createRole.test(lowerQuery) ||
    dropRole.test(lowerQuery) ||
    grantRole.test(lowerQuery) ||
    revokeRole.test(lowerQuery) ||
    dropUser.test(lowerQuery) ||
    createQuota.test(lowerQuery) ||
    dropQuota.test(lowerQuery) ||
    alterQuota.test(lowerQuery) ||
    createSetting.test(lowerQuery) ||
    dropSetting.test(lowerQuery) ||
    alterSetting.test(lowerQuery) ||
    createFunction.test(lowerQuery) ||
    dropFunction.test(lowerQuery) ||
    alterFunction.test(lowerQuery) ||
    createAggregateFunction.test(lowerQuery) ||
    dropAggregateFunction.test(lowerQuery) ||
    alterAggregateFunction.test(lowerQuery) ||
    grant.test(lowerQuery) ||
    revoke.test(lowerQuery) ||
    setAllowPattern.test(lowerQuery)
  );
};
