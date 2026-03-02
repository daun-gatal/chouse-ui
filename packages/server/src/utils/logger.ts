/**
 * JSON logger for server observability.
 * Uses Pino: single line per log, levels, child loggers for requestId.
 * In development: pino-pretty for human-readable, colorized output. In production: single-line JSON.
 * pino-pretty is loaded only in development so production/Docker builds need not install it.
 * LOG_LEVEL env: debug | info | warn | error (default: info in production, debug in development).
 * Never log passwords, tokens, or PII.
 */

import pino from "pino";

const NODE_ENV = process.env.NODE_ENV || "development";
const isDev = NODE_ENV === "development";
const LOG_LEVEL = (process.env.LOG_LEVEL || (NODE_ENV === "production" ? "info" : "debug")) as
  | "debug"
  | "info"
  | "warn"
  | "error";

let dest: pino.DestinationStream | undefined;
if (isDev) {
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    dest = require("pino-pretty")({ colorize: true });
  } catch {
    // pino-pretty not installed — fall back to JSON output
  }
}

const baseLogger = pino(
  {
    level: LOG_LEVEL,
    base: { service: "chouse-ui-server" },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  dest
);

export type Logger = pino.Logger;

export const logger: Logger = baseLogger;

/**
 * Create a request-scoped child logger with requestId for correlation.
 * Use in middleware or route handlers when Context is available.
 */
export function requestLogger(requestId: string): Logger {
  return baseLogger.child({ requestId });
}
