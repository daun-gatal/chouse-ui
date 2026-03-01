/**
 * ClickHouse-specific language data for Monaco editor.
 * Centralizes keywords, data types, settings, snippets, and Monarch tokenizer rules.
 */

import type * as monacoTypes from "monaco-editor";

// ============================================
// ClickHouse Keywords (comprehensive list)
// ============================================

export const CLICKHOUSE_KEYWORDS: readonly string[] = [
  "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
  "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "ALTER", "DROP",
  "TABLE", "DATABASE", "VIEW", "MATERIALIZED", "INDEX", "COLUMN", "PARTITION",
  "AS", "ON", "USING", "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "ILIKE",
  "IS", "NULL", "TRUE", "FALSE", "CASE", "WHEN", "THEN", "ELSE", "END",
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "GLOBAL", "ANY", "ALL", "ANTI", "SEMI",
  "UNION", "ALL", "EXCEPT", "INTERSECT",
  "DISTINCT", "TOP", "WITH", "TOTALS", "ROLLUP", "CUBE",
  "ASC", "DESC", "NULLS", "FIRST", "LAST",
  "FORMAT", "SETTINGS", "PREWHERE", "FINAL", "SAMPLE",
  "ARRAY", "TUPLE", "MAP",
  "ENGINE", "IF", "TEMPORARY", "REPLACE",
  "ATTACH", "DETACH", "RENAME", "TRUNCATE", "OPTIMIZE",
  "SHOW", "DESCRIBE", "DESC", "EXPLAIN",
  "USE", "SYSTEM", "GRANT", "REVOKE", "KILL",
  "TTL", "CODEC", "COMMENT",
  "PRIMARY", "KEY", "POPULATE",
  "TO", "CLUSTER", "MOVE", "FREEZE", "UNFREEZE",
  "FETCH", "CHECK", "WATCH", "LIVE",
  "EXCHANGE", "TABLES",
  "INTERVAL", "YEAR", "MONTH", "WEEK", "DAY", "HOUR", "MINUTE", "SECOND",
  "APPLY", "MODIFY", "ADD", "CLEAR",
  "AFTER", "DEDUPLICATE",
  "MUTATION", "MUTATIONS",
  "LIGHTWEIGHT", "PROJECTION",
  "GLOBAL IN", "NOT IN", "GLOBAL NOT IN",
  "ARRAY JOIN", "LEFT ARRAY JOIN",
  "WINDOW", "OVER", "ROWS", "RANGE", "GROUPS",
  "UNBOUNDED", "PRECEDING", "FOLLOWING", "CURRENT ROW",
  "WITH FILL", "STEP", "STALENESS", "INTERPOLATE",
  "INTO OUTFILE", "COMPRESSION",
  "RELOAD", "FLUSH", "LOGS",
  "DICTIONARY", "DICTIONARIES",
  "QUOTA", "ROW POLICY", "ACCESS",
  "USER", "ROLE", "PROFILE",
  "IDENTIFIED", "BY", "HOST",
  "EXCEPT", "COLUMNS",
] as const;

// ============================================
// ClickHouse Data Types
// ============================================

export interface DataTypeInfo {
  name: string;
  description: string;
  parametric: boolean;
}

export const CLICKHOUSE_DATA_TYPES: readonly DataTypeInfo[] = [
  { name: "UInt8", description: "Unsigned 8-bit integer (0 to 255)", parametric: false },
  { name: "UInt16", description: "Unsigned 16-bit integer (0 to 65535)", parametric: false },
  { name: "UInt32", description: "Unsigned 32-bit integer", parametric: false },
  { name: "UInt64", description: "Unsigned 64-bit integer", parametric: false },
  { name: "UInt128", description: "Unsigned 128-bit integer", parametric: false },
  { name: "UInt256", description: "Unsigned 256-bit integer", parametric: false },
  { name: "Int8", description: "Signed 8-bit integer (-128 to 127)", parametric: false },
  { name: "Int16", description: "Signed 16-bit integer", parametric: false },
  { name: "Int32", description: "Signed 32-bit integer", parametric: false },
  { name: "Int64", description: "Signed 64-bit integer", parametric: false },
  { name: "Int128", description: "Signed 128-bit integer", parametric: false },
  { name: "Int256", description: "Signed 256-bit integer", parametric: false },
  { name: "Float32", description: "32-bit IEEE 754 floating point", parametric: false },
  { name: "Float64", description: "64-bit IEEE 754 floating point", parametric: false },
  { name: "Decimal", description: "Fixed-point number: Decimal(P, S)", parametric: true },
  { name: "Decimal32", description: "Decimal with P up to 9 digits", parametric: true },
  { name: "Decimal64", description: "Decimal with P up to 18 digits", parametric: true },
  { name: "Decimal128", description: "Decimal with P up to 38 digits", parametric: true },
  { name: "Decimal256", description: "Decimal with P up to 76 digits", parametric: true },
  { name: "String", description: "Variable-length byte string", parametric: false },
  { name: "FixedString", description: "Fixed-length byte string: FixedString(N)", parametric: true },
  { name: "UUID", description: "Universally unique identifier", parametric: false },
  { name: "Date", description: "Date stored as days since 1970-01-01", parametric: false },
  { name: "Date32", description: "Date with extended range", parametric: false },
  { name: "DateTime", description: "Date and time with second precision", parametric: true },
  { name: "DateTime64", description: "Date and time with sub-second precision", parametric: true },
  { name: "Enum8", description: "Enumeration with Int8 storage", parametric: true },
  { name: "Enum16", description: "Enumeration with Int16 storage", parametric: true },
  { name: "Bool", description: "Boolean (UInt8 alias)", parametric: false },
  { name: "Array", description: "Array of elements: Array(T)", parametric: true },
  { name: "Tuple", description: "Tuple of elements: Tuple(T1, T2, ...)", parametric: true },
  { name: "Map", description: "Key-value pairs: Map(K, V)", parametric: true },
  { name: "Nullable", description: "Wrapper allowing NULL: Nullable(T)", parametric: true },
  { name: "LowCardinality", description: "Dictionary-encoded type: LowCardinality(T)", parametric: true },
  { name: "IPv4", description: "IPv4 address", parametric: false },
  { name: "IPv6", description: "IPv6 address", parametric: false },
  { name: "Point", description: "2D point (x, y)", parametric: false },
  { name: "Ring", description: "Polygon ring", parametric: false },
  { name: "Polygon", description: "Polygon geometry", parametric: false },
  { name: "MultiPolygon", description: "Multi-polygon geometry", parametric: false },
  { name: "JSON", description: "Semi-structured JSON data", parametric: false },
  { name: "Object", description: "Object type for JSON (deprecated, use JSON)", parametric: true },
  { name: "Nested", description: "Nested data structure", parametric: true },
  { name: "Nothing", description: "Empty type (no values)", parametric: false },
  { name: "SimpleAggregateFunction", description: "Stores simple aggregate state", parametric: true },
  { name: "AggregateFunction", description: "Stores aggregate function state", parametric: true },
  { name: "Dynamic", description: "Dynamic type (stores any type)", parametric: false },
  { name: "Variant", description: "Union of types: Variant(T1, T2, ...)", parametric: true },
] as const;

// ============================================
// ClickHouse Table Engines
// ============================================

export const CLICKHOUSE_ENGINES: readonly string[] = [
  "MergeTree", "ReplacingMergeTree", "SummingMergeTree", "AggregatingMergeTree",
  "CollapsingMergeTree", "VersionedCollapsingMergeTree", "GraphiteMergeTree",
  "ReplicatedMergeTree", "ReplicatedReplacingMergeTree", "ReplicatedSummingMergeTree",
  "ReplicatedAggregatingMergeTree", "ReplicatedCollapsingMergeTree",
  "ReplicatedVersionedCollapsingMergeTree", "ReplicatedGraphiteMergeTree",
  "SharedMergeTree", "SharedReplacingMergeTree", "SharedSummingMergeTree",
  "SharedAggregatingMergeTree", "SharedCollapsingMergeTree",
  "Log", "TinyLog", "StripeLog",
  "Memory", "Buffer", "Set", "Join",
  "File", "URL", "HDFS", "S3", "Kafka", "RabbitMQ", "NATS",
  "EmbeddedRocksDB", "MaterializedView", "Distributed",
  "Dictionary", "Merge", "Null",
  "PostgreSQL", "MySQL", "SQLite", "ODBC", "JDBC",
  "MaterializedPostgreSQL",
] as const;

// ============================================
// Common ClickHouse Settings
// ============================================

export interface SettingInfo {
  name: string;
  description: string;
  type: string;
}

export const CLICKHOUSE_SETTINGS: readonly SettingInfo[] = [
  { name: "max_threads", description: "Maximum number of query processing threads", type: "UInt64" },
  { name: "max_memory_usage", description: "Maximum RAM for running a query on a single server", type: "UInt64" },
  { name: "max_execution_time", description: "Maximum query execution time in seconds", type: "Seconds" },
  { name: "max_rows_to_read", description: "Maximum number of rows to read from a table", type: "UInt64" },
  { name: "max_bytes_to_read", description: "Maximum bytes of uncompressed data to read", type: "UInt64" },
  { name: "max_result_rows", description: "Maximum rows in the result", type: "UInt64" },
  { name: "max_result_bytes", description: "Maximum result size in bytes", type: "UInt64" },
  { name: "max_rows_to_group_by", description: "Maximum unique keys from aggregation", type: "UInt64" },
  { name: "max_bytes_before_external_group_by", description: "Memory threshold before external GROUP BY", type: "UInt64" },
  { name: "max_bytes_before_external_sort", description: "Memory threshold before external ORDER BY", type: "UInt64" },
  { name: "max_rows_to_sort", description: "Maximum rows before sorting", type: "UInt64" },
  { name: "readonly", description: "Read-only mode (0=off, 1=on, 2=on+SET allowed)", type: "UInt64" },
  { name: "allow_ddl", description: "Allow DDL queries (CREATE, DROP, ALTER, RENAME, ATTACH, DETACH)", type: "Bool" },
  { name: "optimize_read_in_order", description: "Optimize reading in ORDER BY key order", type: "Bool" },
  { name: "optimize_aggregation_in_order", description: "Optimize aggregation in GROUP BY key order", type: "Bool" },
  { name: "use_uncompressed_cache", description: "Use cache for uncompressed blocks", type: "Bool" },
  { name: "enable_http_compression", description: "Enable HTTP response compression", type: "Bool" },
  { name: "log_queries", description: "Log queries to system.query_log", type: "Bool" },
  { name: "insert_quorum", description: "Number of replicas for quorum INSERT", type: "UInt64" },
  { name: "select_sequential_consistency", description: "Sequential consistency for SELECT queries", type: "Bool" },
  { name: "join_algorithm", description: "JOIN algorithm (auto, hash, partial_merge, ...)", type: "String" },
  { name: "join_use_nulls", description: "Use NULLs instead of defaults for JOIN mismatches", type: "Bool" },
  { name: "distributed_product_mode", description: "Mode for distributed subqueries (deny, local, global, allow)", type: "String" },
  { name: "max_distributed_connections", description: "Maximum connections to remote servers", type: "UInt64" },
  { name: "async_insert", description: "Enable asynchronous inserts", type: "Bool" },
  { name: "wait_for_async_insert", description: "Wait for async insert to complete", type: "Bool" },
  { name: "output_format_json_quote_64bit_integers", description: "Quote 64-bit integers in JSON output", type: "Bool" },
  { name: "input_format_allow_errors_num", description: "Maximum allowed parsing errors", type: "UInt64" },
  { name: "date_time_output_format", description: "DateTime output format (simple, iso, unix_timestamp)", type: "String" },
  { name: "max_insert_block_size", description: "Maximum block size for INSERT", type: "UInt64" },
  { name: "max_block_size", description: "Maximum block size for reading", type: "UInt64" },
  { name: "enable_optimize_predicate_expression", description: "Push predicates into subqueries", type: "Bool" },
  { name: "any_join_distinct_right_table_keys", description: "Enable old ANY JOIN behavior", type: "Bool" },
  { name: "max_partitions_per_insert_block", description: "Maximum partitions per INSERT block", type: "UInt64" },
  { name: "mutations_sync", description: "Wait for mutations (0=async, 1=current replica, 2=all)", type: "UInt64" },
  { name: "allow_experimental_lightweight_delete", description: "Enable lightweight DELETE", type: "Bool" },
  { name: "final", description: "Implicitly apply FINAL to all table reads", type: "Bool" },
  { name: "deduplicate_blocks_in_dependent_materialized_views", description: "Dedup in materialized views", type: "Bool" },
  { name: "force_index_by_date", description: "Reject queries without date index filter", type: "Bool" },
  { name: "force_primary_key", description: "Reject queries without primary key filter", type: "Bool" },
] as const;

// ============================================
// SQL Snippets
// ============================================

export interface SqlSnippet {
  label: string;
  detail: string;
  insertText: string;
  documentation?: string;
}

export const SQL_SNIPPETS: readonly SqlSnippet[] = [
  {
    label: "SELECT ... FROM",
    detail: "Basic SELECT query",
    insertText: "SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ${3:1 = 1}\nLIMIT ${4:100}",
    documentation: "Basic SELECT query with WHERE and LIMIT",
  },
  {
    label: "SELECT ... GROUP BY",
    detail: "Aggregation query",
    insertText: "SELECT ${1:column}, ${2:count}(*)\nFROM ${3:table_name}\nGROUP BY ${4:column}\nORDER BY ${5:2} DESC\nLIMIT ${6:100}",
    documentation: "SELECT with GROUP BY aggregation",
  },
  {
    label: "SELECT ... JOIN",
    detail: "JOIN query",
    insertText: "SELECT ${1:a.*}, ${2:b.*}\nFROM ${3:table1} AS a\n${4:INNER} JOIN ${5:table2} AS b ON a.${6:id} = b.${7:id}",
    documentation: "SELECT with JOIN clause",
  },
  {
    label: "INSERT INTO ... VALUES",
    detail: "Insert values",
    insertText: "INSERT INTO ${1:table_name} (${2:columns})\nVALUES (${3:values})",
    documentation: "Insert rows with explicit values",
  },
  {
    label: "INSERT INTO ... SELECT",
    detail: "Insert from SELECT",
    insertText: "INSERT INTO ${1:target_table} (${2:columns})\nSELECT ${3:columns}\nFROM ${4:source_table}",
    documentation: "Insert data from a SELECT query",
  },
  {
    label: "CREATE TABLE",
    detail: "Create a new table",
    insertText: "CREATE TABLE ${1:database}.${2:table_name}\n(\n    ${3:id} UInt64,\n    ${4:name} String,\n    ${5:created_at} DateTime DEFAULT now()\n)\nENGINE = ${6:MergeTree}\nORDER BY ${7:id}",
    documentation: "Create a new ClickHouse table with MergeTree engine",
  },
  {
    label: "CREATE TABLE ... AS SELECT",
    detail: "Create table from query",
    insertText: "CREATE TABLE ${1:database}.${2:table_name}\nENGINE = ${3:MergeTree}\nORDER BY ${4:tuple()}\nAS SELECT ${5:*}\nFROM ${6:source_table}",
    documentation: "Create a table and populate it from a SELECT query",
  },
  {
    label: "CREATE MATERIALIZED VIEW",
    detail: "Materialized view",
    insertText: "CREATE MATERIALIZED VIEW ${1:database}.${2:mv_name}\nENGINE = ${3:AggregatingMergeTree}\nORDER BY ${4:key}\nAS SELECT ${5:columns}\nFROM ${6:source_table}\nGROUP BY ${7:key}",
    documentation: "Create a materialized view with its own storage",
  },
  {
    label: "ALTER TABLE ADD COLUMN",
    detail: "Add column",
    insertText: "ALTER TABLE ${1:database}.${2:table_name}\n    ADD COLUMN ${3:column_name} ${4:String} ${5:AFTER ${6:existing_column}}",
    documentation: "Add a new column to an existing table",
  },
  {
    label: "ALTER TABLE DROP COLUMN",
    detail: "Drop column",
    insertText: "ALTER TABLE ${1:database}.${2:table_name}\n    DROP COLUMN ${3:column_name}",
    documentation: "Remove a column from a table",
  },
  {
    label: "WITH ... AS (CTE)",
    detail: "Common Table Expression",
    insertText: "WITH ${1:cte_name} AS (\n    SELECT ${2:*}\n    FROM ${3:table_name}\n    WHERE ${4:1 = 1}\n)\nSELECT ${5:*}\nFROM ${6:cte_name}",
    documentation: "Common Table Expression (CTE) using WITH clause",
  },
  {
    label: "OPTIMIZE TABLE",
    detail: "Optimize table",
    insertText: "OPTIMIZE TABLE ${1:database}.${2:table_name} ${3:FINAL}",
    documentation: "Trigger merge of table parts",
  },
  {
    label: "SHOW CREATE TABLE",
    detail: "Show table DDL",
    insertText: "SHOW CREATE TABLE ${1:database}.${2:table_name}",
    documentation: "Show the CREATE TABLE statement for a table",
  },
  {
    label: "DESCRIBE TABLE",
    detail: "Describe table schema",
    insertText: "DESCRIBE TABLE ${1:database}.${2:table_name}",
    documentation: "Show column names and types for a table",
  },
  {
    label: "SELECT ... WINDOW",
    detail: "Window function query",
    insertText: "SELECT\n    ${1:column},\n    ${2:row_number}() OVER (${3:PARTITION BY ${4:key} ORDER BY ${5:column}}) AS ${6:rn}\nFROM ${7:table_name}",
    documentation: "SELECT with window functions",
  },
  {
    label: "SYSTEM FLUSH LOGS",
    detail: "Flush system logs",
    insertText: "SYSTEM FLUSH LOGS",
    documentation: "Force ClickHouse to flush buffered log data to system tables",
  },
  {
    label: "SELECT FROM system.query_log",
    detail: "Query log analysis",
    insertText: "SELECT\n    query_id,\n    type,\n    query_duration_ms,\n    formatReadableSize(memory_usage) AS memory,\n    formatReadableQuantity(read_rows) AS rows_read,\n    query\nFROM system.query_log\nWHERE type = 'QueryFinish'\n    AND event_date = today()\nORDER BY query_start_time DESC\nLIMIT ${1:20}",
    documentation: "Analyze recent query performance from system.query_log",
  },
  {
    label: "SELECT FROM system.parts",
    detail: "Table parts analysis",
    insertText: "SELECT\n    database,\n    table,\n    partition_id,\n    name,\n    rows,\n    formatReadableSize(bytes_on_disk) AS size\nFROM system.parts\nWHERE database = '${1:default}'\n    AND table = '${2:table_name}'\n    AND active\nORDER BY modification_time DESC",
    documentation: "Inspect table parts and their sizes",
  },
] as const;

// ============================================
// Monarch Tokenizer for ClickHouse SQL
// ============================================

const CLICKHOUSE_TYPE_NAMES = CLICKHOUSE_DATA_TYPES.map((t) => t.name);

export function createClickHouseMonarchTokenizer(): monacoTypes.languages.IMonarchLanguage {
  return {
    defaultToken: "",
    ignoreCase: true,
    tokenPostfix: ".sql",

    keywords: [
      "SELECT", "FROM", "WHERE", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET",
      "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
      "CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME", "EXCHANGE",
      "TABLE", "DATABASE", "VIEW", "MATERIALIZED", "INDEX", "COLUMN",
      "PARTITION", "PROJECTION", "DICTIONARY",
      "AS", "ON", "USING", "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN",
      "LIKE", "ILIKE", "IS", "NULL", "TRUE", "FALSE",
      "CASE", "WHEN", "THEN", "ELSE", "END",
      "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS",
      "GLOBAL", "ANY", "ALL", "ANTI", "SEMI",
      "UNION", "EXCEPT", "INTERSECT",
      "DISTINCT", "TOP", "WITH", "TOTALS", "ROLLUP", "CUBE",
      "ASC", "DESC", "NULLS", "FIRST", "LAST",
      "FORMAT", "SETTINGS", "PREWHERE", "FINAL", "SAMPLE",
      "ARRAY", "TUPLE", "MAP",
      "ENGINE", "IF", "TEMPORARY", "REPLACE",
      "ATTACH", "DETACH", "OPTIMIZE",
      "SHOW", "DESCRIBE", "DESC", "EXPLAIN",
      "USE", "SYSTEM", "GRANT", "REVOKE", "KILL",
      "TTL", "CODEC", "COMMENT", "AFTER",
      "PRIMARY", "KEY", "POPULATE", "TO",
      "CLUSTER", "MOVE", "FREEZE", "FETCH", "CHECK",
      "INTERVAL", "YEAR", "MONTH", "WEEK", "DAY", "HOUR", "MINUTE", "SECOND",
      "ADD", "MODIFY", "CLEAR", "DEDUPLICATE",
      "LIGHTWEIGHT", "MUTATION", "MUTATIONS",
      "WINDOW", "OVER", "ROWS", "RANGE", "GROUPS",
      "UNBOUNDED", "PRECEDING", "FOLLOWING", "CURRENT",
      "FILL", "STEP", "INTERPOLATE", "STALENESS",
      "OUTFILE", "COMPRESSION",
      "RELOAD", "FLUSH", "LOGS",
      "QUOTA", "POLICY", "ACCESS",
      "USER", "ROLE", "PROFILE", "IDENTIFIED", "HOST",
      "LIVE", "WATCH",
      "COLUMNS",
    ],

    operators: [
      "=", ">", "<", ">=", "<=", "<>", "!=",
      "+", "-", "*", "/", "%",
      "||",
      "->",
    ],

    typeKeywords: CLICKHOUSE_TYPE_NAMES,

    builtinFunctions: [
      "count", "sum", "avg", "min", "max", "any", "anyLast",
      "argMin", "argMax", "uniq", "uniqExact", "uniqCombined", "uniqHLL12",
      "groupArray", "groupUniqArray", "groupArrayInsertAt",
      "quantile", "quantiles", "quantileExact", "quantileTDigest", "quantileTiming",
      "median", "medianExact",
      "sumIf", "countIf", "avgIf", "minIf", "maxIf", "anyIf",
      "topK", "topKWeighted",
      "simpleLinearRegression", "stochasticLinearRegression",
      "corr", "covarPop", "covarSamp", "varPop", "varSamp",
      "stddevPop", "stddevSamp", "skewPop", "skewSamp", "kurtPop", "kurtSamp",
      "entropy", "exponentialMovingAverage",
      "arrayJoin", "arrayMap", "arrayFilter", "arrayExists", "arrayAll",
      "arrayFirst", "arrayConcat", "arrayElement", "arrayResize",
      "arraySort", "arrayReverseSort", "arraySlice", "arrayUniq", "arrayDistinct",
      "arrayReduce", "arrayZip", "arrayEnumerate", "arrayEnumerateUniq",
      "length", "empty", "notEmpty", "has", "hasAll", "hasAny",
      "indexOf", "countEqual",
      "tuple", "tupleElement", "untuple",
      "map", "mapKeys", "mapValues", "mapContains",
      "toString", "toInt8", "toInt16", "toInt32", "toInt64",
      "toUInt8", "toUInt16", "toUInt32", "toUInt64",
      "toFloat32", "toFloat64", "toDecimal32", "toDecimal64", "toDecimal128",
      "toDate", "toDateTime", "toDateTime64", "toUnixTimestamp",
      "toYear", "toMonth", "toDayOfMonth", "toDayOfWeek", "toHour", "toMinute", "toSecond",
      "toStartOfDay", "toStartOfHour", "toStartOfMinute", "toStartOfMonth",
      "toStartOfQuarter", "toStartOfYear", "toStartOfWeek",
      "toStartOfInterval", "toMonday",
      "now", "today", "yesterday", "toYYYYMM", "toYYYYMMDD", "toYYYYMMDDhhmmss",
      "dateDiff", "dateAdd", "dateSub", "timeSlot", "formatDateTime", "parseDateTime",
      "addDays", "addHours", "addMinutes", "addMonths", "addQuarters",
      "addSeconds", "addWeeks", "addYears",
      "subtractDays", "subtractHours", "subtractMinutes", "subtractMonths",
      "subtractQuarters", "subtractSeconds", "subtractWeeks", "subtractYears",
      "if", "multiIf", "coalesce", "ifNull", "nullIf", "assumeNotNull", "toNullable",
      "isNull", "isNotNull",
      "concat", "substring", "substringUTF8", "lower", "upper", "lowerUTF8", "upperUTF8",
      "trim", "trimLeft", "trimRight", "ltrim", "rtrim",
      "reverse", "replaceOne", "replaceAll", "replaceRegexpOne", "replaceRegexpAll",
      "position", "positionUTF8", "match", "extract", "extractAll",
      "like", "notLike", "ilike", "notILike",
      "splitByChar", "splitByString", "splitByRegexp",
      "format", "leftPad", "rightPad", "repeat",
      "base64Encode", "base64Decode", "tryBase64Decode",
      "hex", "unhex", "bin", "unbin",
      "cityHash64", "sipHash64", "sipHash128", "MD5", "SHA1", "SHA256",
      "halfMD5", "murmurHash2_64", "murmurHash3_64", "xxHash32", "xxHash64",
      "generateUUIDv4", "toUUID",
      "IPv4NumToString", "IPv4StringToNum", "IPv6NumToString", "IPv6StringToNum",
      "abs", "ceil", "floor", "round", "roundDown", "roundToExp2",
      "exp", "log", "log2", "log10", "sqrt", "cbrt", "pow", "power",
      "intDiv", "intDivOrZero", "modulo", "moduloOrZero",
      "greatest", "least",
      "plus", "minus", "multiply", "divide",
      "bitAnd", "bitOr", "bitXor", "bitNot", "bitShiftLeft", "bitShiftRight",
      "JSONExtract", "JSONExtractString", "JSONExtractInt", "JSONExtractFloat",
      "JSONExtractBool", "JSONExtractRaw", "JSONExtractKeysAndValues",
      "JSONHas", "JSONLength", "JSONType", "JSONExtractArrayRaw",
      "visitParamHas", "visitParamExtractString", "visitParamExtractInt",
      "toTypeName", "toColumnTypeName", "materialize",
      "ignore", "sleep", "currentDatabase", "currentUser",
      "hostName", "version", "uptime", "blockSize", "blockNumber",
      "rowNumberInAllBlocks", "rowNumberInBlock",
      "neighbor", "runningAccumulate", "runningDifference", "runningDifferenceStartingWithFirstValue",
      "row_number", "rank", "dense_rank", "ntile", "percent_rank",
      "lag", "lead", "first_value", "last_value", "nth_value",
      "dictGet", "dictGetOrDefault", "dictGetOrNull",
      "dictHas", "dictGetHierarchy", "dictIsIn",
      "bar", "formatReadableSize", "formatReadableQuantity", "formatReadableTimeDelta",
      "transform", "arrayStringConcat",
      "in", "notIn", "globalIn", "globalNotIn",
      "getSetting",
    ],

    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

    tokenizer: {
      root: [
        // Block comments
        [/\/\*/, "comment", "@comment"],
        // Line comments (-- and //)
        [/--.*$/, "comment"],
        [/\/\/.*$/, "comment"],

        // Backtick-quoted identifiers
        [/`[^`]*`/, "identifier.quote"],

        // Strings
        [/'/, "string", "@string_single"],
        [/"/, "string", "@string_double"],

        // Numbers: hex, binary, decimal, float, scientific
        [/0[xX][0-9a-fA-F_]+/, "number.hex"],
        [/0[bB][01_]+/, "number.binary"],
        [/\d+[eE][+-]?\d+/, "number.float"],
        [/\d*\.\d+([eE][+-]?\d+)?/, "number.float"],
        [/\d+/, "number"],

        // Operators
        [/[<>!=]=?/, "operator"],
        [/[+\-*/%]/, "operator"],
        [/\|\|/, "operator"],
        [/->/, "operator"],

        // db.table / schema.table pattern — must come BEFORE the plain identifier rule
        // Colors the database/schema part and the table/object part with distinct tokens
        [/([a-zA-Z_]\w*)(\.)([a-zA-Z_]\w*)/, ["identifier.db", "delimiter", "identifier.table"]],

        // Identifiers and keywords
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@typeKeywords": "type",
              "@keywords": "keyword",
              "@builtinFunctions": "predefined",
              "@default": "identifier",
            },
          },
        ],

        // Brackets
        [/[{}()\[\]]/, "@brackets"],

        // Delimiters
        [/[;,.]/, "delimiter"],
      ],

      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],

      string_single: [
        [/[^'\\]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/'/, "string", "@pop"],
      ],

      string_double: [
        [/[^"\\]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/"/, "string", "@pop"],
      ],
    },
  };
}

// ============================================
// Language Configuration
// ============================================

export function createClickHouseLanguageConfig(): monacoTypes.languages.LanguageConfiguration {
  return {
    brackets: [
      ["(", ")"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: "`", close: "`" },
    ],
    surroundingPairs: [
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: "`", close: "`" },
    ],
    comments: {
      lineComment: "--",
      blockComment: ["/*", "*/"],
    },
    folding: {
      markers: {
        start: /^\s*\/\*\s*#region\b/,
        end: /^\s*\/\*\s*#endregion\b/,
      },
    },
  };
}
