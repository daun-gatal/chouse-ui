/**
 * Client-side log helper for structured, rules-compliant logging.
 * - debug/info: only when import.meta.env.DEV (development).
 * - error/warn: always (or in dev only if you prefer minimal production logging).
 * Do not log sensitive data (passwords, tokens, PII).
 */

const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV === true;

function toContextRecord(context: Record<string, unknown> | Error | unknown): Record<string, unknown> | undefined {
  if (context == null) return undefined;
  if (context instanceof Error) return { err: context.message };
  if (typeof context === "object" && !Array.isArray(context) && context !== null) {
    return context as Record<string, unknown>;
  }
  return { value: String(context) };
}

function serializeContext(context: Record<string, unknown> | undefined, pretty: boolean): string {
  if (context == null || Object.keys(context).length === 0) return "";
  try {
    return " " + (pretty ? JSON.stringify(context, null, 2) : JSON.stringify(context));
  } catch {
    return "";
  }
}

export const log = {
  error(message: string, context?: Record<string, unknown> | Error | unknown): void {
    const ctx = toContextRecord(context);
    if (isDev && ctx) {
      console.error("[error]", message, ctx);
    } else {
      console.error("[error]", message, serializeContext(ctx, false));
    }
  },

  warn(message: string, context?: Record<string, unknown> | Error | unknown): void {
    const ctx = toContextRecord(context);
    if (isDev && ctx) {
      console.warn("[warn]", message, ctx);
    } else {
      console.warn("[warn]", message, serializeContext(ctx, false));
    }
  },

  info(message: string, context?: Record<string, unknown>): void {
    if (!isDev) return;
    if (context && Object.keys(context).length > 0) {
      console.info("[info]", message, context);
    } else {
      console.info("[info]", message, serializeContext(context, true));
    }
  },

  debug(message: string, context?: Record<string, unknown>): void {
    if (!isDev) return;
    if (context && Object.keys(context).length > 0) {
      console.debug("[debug]", message, context);
    } else {
      console.debug("[debug]", message, serializeContext(context, true));
    }
  },
};
