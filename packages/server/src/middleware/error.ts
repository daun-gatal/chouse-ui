import { Context } from "hono";
import { AppError } from "../types";
import { requestLogger } from "../utils/logger";

/**
 * Global error handler middleware
 */
export function errorHandler(err: Error, c: Context) {
  const requestId = c.get('requestId');
  const method = c.req.method;
  const path = c.req.path;
  const user = c.get('rbacUser');
  const reqLog = requestLogger(requestId);

  // Determine error details
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let category = 'unknown';
  let details: unknown = undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.code;
    message = err.message;
    category = err.category;
    details = err.details;
  } else if (err.name === 'ZodError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = 'Validation failed';
    category = 'validation';
    details = (err as { errors: unknown }).errors;
  } else {
    // For non-AppErrors (unexpected), use the actual message in dev
    if (process.env.NODE_ENV !== 'production') {
      message = err.message;
    }
  }

  // Structured log entry for observability (no sensitive data)
  const logFields = {
    statusCode,
    errorCode,
    method,
    path,
    userId: user?.sub,
    message: err.message,
    ...(statusCode >= 500 && err.stack ? { stack: err.stack } : {}),
  };

  if (statusCode >= 500) {
    reqLog.error(logFields, err.message);
  } else if (statusCode !== 404) {
    reqLog.warn(logFields, err.message);
  } else {
    reqLog.warn({ method, path, message }, `NOT_FOUND: ${message}`);
  }

  // Response Construction
  return c.json(
    {
      success: false,
      error: {
        id: requestId,
        code: errorCode,
        message,
        category,
        details,
        // Include stack trace only in development and for 500s
        stack: process.env.NODE_ENV !== 'production' && statusCode === 500 ? err.stack : undefined,
      },
    },
    statusCode as any
  );
}

/**
 * Not found handler
 */
export function notFoundHandler(c: Context) {
  return c.json(
    {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Route ${c.req.method} ${c.req.path} not found`,
        category: "unknown",
      },
    },
    404
  );
}

