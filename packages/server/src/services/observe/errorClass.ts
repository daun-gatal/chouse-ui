/**
 * Classify ClickHouse errors into the RCA layers of ADR 0016 §6. ClickHouse
 * exception texts end with the error name in parentheses, e.g.
 * "… (MEMORY_LIMIT_EXCEEDED) (version 25.3.1.1)"; the name decides the class.
 */

export type ErrorClass = "engine" | "external" | "config" | "data";

const ENGINE = new Set([
  "MEMORY_LIMIT_EXCEEDED",
  "CANNOT_ALLOCATE_MEMORY",
  "TOO_MANY_PARTS",
  "TOO_MANY_SIMULTANEOUS_QUERIES",
  "TIMEOUT_EXCEEDED",
  "NOT_ENOUGH_SPACE",
  "TABLE_IS_READ_ONLY",
  "ALL_REPLICAS_ARE_STALE",
  "KEEPER_EXCEPTION",
  "QUERY_WAS_CANCELLED",
  "ABORTED",
  "TOO_MANY_QUERIES",
  "CANNOT_SCHEDULE_TASK",
  "REPLICA_IS_NOT_IN_QUORUM",
  "UNFINISHED",
]);

const EXTERNAL_PREFIXES = [
  "S3_",
  "AZURE_",
  "HDFS_",
  "POSTGRESQL",
  "MYSQL",
  "MONGODB",
  "RDKAFKA",
  "KAFKA",
  "RABBITMQ",
  "CANNOT_CONNECT_RABBITMQ",
  "NATS",
  "CANNOT_CONNECT_NATS",
];

const EXTERNAL = new Set([
  "RECEIVED_ERROR_FROM_REMOTE_IO_SERVER",
  "NETWORK_ERROR",
  "SOCKET_TIMEOUT",
  "CANNOT_READ_FROM_SOCKET",
  "CANNOT_WRITE_TO_SOCKET",
  "POCO_EXCEPTION",
  "STD_EXCEPTION",
  "EXTERNAL_SERVER_IS_NOT_RESPONDING",
  "HTTP_CONNECTION_LIMIT_REACHED",
  "DNS_ERROR",
]);

const CONFIG = new Set([
  "UNKNOWN_TABLE",
  "UNKNOWN_DATABASE",
  "NO_SUCH_COLUMN_IN_TABLE",
  "UNKNOWN_IDENTIFIER",
  "ACCESS_DENIED",
  "BAD_ARGUMENTS",
  "UNKNOWN_SETTING",
  "AUTHENTICATION_FAILED",
  "REQUIRED_PASSWORD",
  "ILLEGAL_TYPE_OF_ARGUMENT",
  "SYNTAX_ERROR",
  "UNKNOWN_FUNCTION",
  "THERE_IS_NO_COLUMN",
  "BAD_GET",
  "INVALID_CONFIG_PARAMETER",
  "UNSUPPORTED_METHOD",
  "NOT_IMPLEMENTED",
]);

const DATA_PREFIXES = ["CANNOT_PARSE", "CANNOT_READ_ALL_DATA", "INCORRECT_DATA", "CANNOT_CONVERT", "TYPE_MISMATCH", "VALUE_IS_OUT_OF_RANGE", "CANNOT_INSERT_NULL", "INCORRECT_NUMBER_OF_COLUMNS", "TOO_LARGE_STRING_SIZE"];

/** Extract the trailing "(ERROR_NAME)" from a ClickHouse exception message. */
export function errorName(message: string | null | undefined): string | null {
  if (!message) return null;
  const matches = [...message.matchAll(/\(([A-Z][A-Z0-9_]{2,})\)/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const name = matches[i][1];
    if (name !== "version") return name;
  }
  return null;
}

export function classifyError(message: string | null | undefined): ErrorClass | null {
  if (!message) return null;
  const name = errorName(message);
  if (name) {
    if (ENGINE.has(name)) return "engine";
    if (CONFIG.has(name)) return "config";
    if (EXTERNAL.has(name) || EXTERNAL_PREFIXES.some((p) => name.startsWith(p))) return "external";
    if (DATA_PREFIXES.some((p) => name.startsWith(p))) return "data";
  }
  const text = message.toLowerCase();
  if (/memory limit|too many parts|no space left/.test(text)) return "engine";
  if (/connection refused|timed out|could not resolve|access denied by remote|403|404|503|broker|unreachable/.test(text)) return "external";
  if (/cannot parse|malformed|unexpected token/.test(text)) return "data";
  return "engine";
}
