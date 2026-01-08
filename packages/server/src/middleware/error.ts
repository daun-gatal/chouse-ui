import { Context } from "hono";
import { AppError } from "../types";

/**
 * Global error handler middleware
 */
export function errorHandler(err: Error, c: Context) {
  console.error("Error:", err);

  if (err instanceof AppError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          category: err.category,
          details: err.details,
        },
      },
      err.statusCode as 400 | 401 | 403 | 404 | 500
    );
  }

  // Handle Zod validation errors
  if (err.name === "ZodError") {
    const zodError = err as { errors?: { path: string[]; message: string }[] };
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          category: "validation",
          details: zodError.errors,
        },
      },
      400
    );
  }

  // Generic error
  return c.json(
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: process.env.NODE_ENV === "production" 
          ? "An unexpected error occurred" 
          : err.message,
        category: "unknown",
      },
    },
    500
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

