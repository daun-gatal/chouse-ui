import "./utils/configLoader";
import { Hono, Context } from "hono";
import { serve } from "bun";
import { serveStatic } from "hono/bun";
import api from "./routes";
import { corsMiddleware } from "./middleware/cors";
import { rateLimiter } from "hono-rate-limiter";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { cleanupExpiredSessions, getSessionCount } from "./services/clickhouse";
import { initializeRbac, shutdownRbac } from "./rbac";
import { requestId } from "./middleware/requestId";
import { logger, requestLogger } from "./utils/logger";

// Configuration
const PORT = parseInt(process.env.PORT || "5521", 10);
const STATIC_PATH = process.env.STATIC_PATH || "./dist";
const NODE_ENV = process.env.NODE_ENV || "development";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const SESSION_CLEANUP_INTERVAL = 60000; // 1 minute
const SESSION_MAX_AGE = 3600000; // 1 hour

// ============================================
// Environment Variable Validation
// ============================================

/**
 * Validate required environment variables at startup
 * In production, ensures critical security settings are configured
 */
function validateEnvironmentVariables(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (NODE_ENV === "production") {
    // Required in production
    const required: Array<{ key: string; minLength?: number; exactLength?: number; description?: string }> = [
      {
        key: "JWT_SECRET",
        minLength: 32,
        description: "Cryptographically secure random string for JWT token signing (minimum 32 characters, recommended 64+)",
      },
      {
        key: "RBAC_ENCRYPTION_KEY",
        minLength: 32,
        description: "32-byte (64 hex characters) key for encrypting ClickHouse connection passwords",
      },
      {
        key: "RBAC_ENCRYPTION_SALT",
        exactLength: 64,
        description: "32-byte (64 hex characters) salt for key derivation - must be unique and random",
      },
    ];

    for (const config of required) {
      const value = process.env[config.key];
      if (!value) {
        errors.push(
          `${config.key} must be set in production. ${config.description || ""}`
        );
      } else if (config.minLength && value.length < config.minLength) {
        errors.push(
          `${config.key} must be at least ${config.minLength} characters long. ` +
          `Current length: ${value.length}. ${config.description || ""}`
        );
      } else if (config.exactLength && value.length !== config.exactLength) {
        errors.push(
          `${config.key} must be exactly ${config.exactLength} characters long. ` +
          `Current length: ${value.length}. ${config.description || ""}`
        );
      }
    }

    // Warn about CORS in production
    if (CORS_ORIGIN === "*") {
      warnings.push(
        "CORS_ORIGIN is set to '*' in production. This allows requests from any origin. " +
        "Consider restricting to specific domains for better security."
      );
    }
  } else {
    // Development warnings
    if (!process.env.JWT_SECRET) {
      warnings.push(
        "JWT_SECRET not set. Using development default. Set a secure value for production."
      );
    }
    if (!process.env.RBAC_ENCRYPTION_KEY) {
      warnings.push(
        "RBAC_ENCRYPTION_KEY not set. Using development default. Set a secure value for production."
      );
    }
    if (!process.env.RBAC_ENCRYPTION_SALT) {
      warnings.push(
        "RBAC_ENCRYPTION_SALT not set. Using derived salt in development. Set a secure value for production."
      );
    }
  }

  if (warnings.length > 0) {
    warnings.forEach((warning) => logger.warn({ phase: "env_validation", warning }, warning));
  }

  if (errors.length > 0) {
    errors.forEach((error) => logger.error({ phase: "env_validation", error }, error));
    logger.error({ phase: "env_validation" }, "Server startup aborted. Please fix the above errors.");
    process.exit(1);
  }
}

// Validate environment variables before starting server
validateEnvironmentVariables();

// Create Hono app
const app = new Hono();

// ============================================
// Global Middleware
// ============================================

app.use("*", requestId);

// Security headers (XSS protection, clickjacking prevention, etc.)
app.use("*", async (c, next) => {
  await next();

  // Only add security headers for HTML responses (not API)
  if (!c.req.path.startsWith("/api")) {
    // Prevent XSS attacks
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "SAMEORIGIN");
    c.header("X-XSS-Protection", "1; mode=block");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");

    // Content Security Policy - prevents inline script injection
    const cspDirectives = [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'", // Only allow API calls to same origin
      "frame-ancestors 'self'",
    ];

    // In production, remove unsafe-eval
    if (NODE_ENV === "production") {
      cspDirectives.push("script-src 'self' 'unsafe-inline'"); // TODO: Use nonces instead of unsafe-inline
    } else {
      cspDirectives.push("script-src 'self' 'unsafe-inline' 'unsafe-eval'"); // Required for React/Vite dev
    }

    cspDirectives.push("style-src 'self' 'unsafe-inline'"); // Required for styled components

    c.header("Content-Security-Policy", cspDirectives.join("; "));
  }
});

// CORS - In production, strict mode blocks requests from unauthorized origins
app.use("*", corsMiddleware({
  origin: CORS_ORIGIN === "*" ? "*" : CORS_ORIGIN.split(",").map(o => o.trim()),
  credentials: true,
  // Strict mode: reject requests from disallowed origins
  // In development with CORS_ORIGIN=*, allow all origins
  // In production, only allow specified origins
  strictMode: NODE_ENV === "production" && CORS_ORIGIN !== "*",
}));

// Request logging: one JSON line per request (method, path, status, durationMs, requestId)
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const reqLog = requestLogger(c.get("requestId"));
  reqLog.info(
    { method: c.req.method, path: c.req.path, status: c.res.status, durationMs: ms },
    "request"
  );
});

// ============================================
// Security Middleware (Rate Limiting & Size)
// ============================================

// 1. Request Size Limits (10MB)
app.use('*', async (c, next) => {
  const contentLength = c.req.header('Content-Length');
  const maxSize = 10 * 1024 * 1024; // 10MB for JSON

  if (contentLength && parseInt(contentLength) > maxSize) {
    return c.json({ error: 'Payload too large' }, 413);
  }

  await next();
});

// 2. Rate Limiting Configuration

// Login endpoints: 5 attempts per 15 minutes per IP
app.use('/api/rbac/auth/login', rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // 10 attempts per 15 minutes
  standardHeaders: true,
  keyGenerator: (c: Context) => c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP') || 'unknown',
}));

// Query execution: 300 queries per minute per user
// Applies to all query operations (select, insert, etc.)
app.use('/api/query/*', rateLimiter({
  windowMs: 60 * 1000,
  limit: 300, // 300 queries per minute
  keyGenerator: (c: Context) => c.get('rbacUserId') || 'unknown',
}));

// General API endpoints: 1000 requests per minute per user/IP
app.use('/api/*', rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 1000, // 1000 requests per minute
  keyGenerator: (c: Context) => c.get('rbacUserId') || c.req.header('X-Forwarded-For') || 'unknown',
}));

// ============================================
// API Routes
// ============================================

app.route("/api", api);

// ============================================
// Static File Serving
// ============================================

// Serve static files from the dist directory
app.use("*", serveStatic({ root: STATIC_PATH }));

// ============================================
// Error Handling
// ============================================

app.onError(errorHandler);

// SPA fallback - serve index.html for all non-API, non-file routes
// This must come after serveStatic and handles client-side routing
app.notFound(async (c) => {
  // If it's an API route, return JSON 404
  if (c.req.path.startsWith("/api")) {
    return notFoundHandler(c);
  }

  // For all other routes, serve index.html for SPA routing
  try {
    const indexPath = `${STATIC_PATH}/index.html`;
    const file = Bun.file(indexPath);
    if (await file.exists()) {
      return c.html(await file.text());
    }
  } catch (e) {
    // Fall through to 404
  }

  return notFoundHandler(c);
});

// ============================================
// Server Startup
// ============================================

logger.info(
  { phase: "startup", env: NODE_ENV, port: PORT, staticPath: STATIC_PATH, corsOrigin: CORS_ORIGIN },
  "CHouse UI Server starting"
);

// Initialize RBAC system
initializeRbac().then(() => {
  logger.info({ phase: "startup" }, "RBAC system ready");
}).catch((error) => {
  logger.error({ phase: "startup", err: error instanceof Error ? error.message : String(error) }, "Failed to initialize RBAC");
  // Continue without RBAC - it's optional for backward compatibility
});

// Start session cleanup interval
const cleanupInterval = setInterval(async () => {
  const cleaned = await cleanupExpiredSessions(SESSION_MAX_AGE);
  if (cleaned > 0) {
    logger.info({ phase: "cleanup", cleaned, activeSessions: getSessionCount() }, "Cleaned up expired sessions");
  }
}, SESSION_CLEANUP_INTERVAL);

// Start server - bind app.fetch to preserve context
const server = serve({
  port: PORT,
  fetch: app.fetch.bind(app),
  idleTimeout: 120, // 120s — SSE streams for AI chat can be idle during long tool calls
});

// Graceful shutdown handler
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ phase: "shutdown", signal }, "Shutting down gracefully");

  try {
    server.stop();
    logger.info({ phase: "shutdown" }, "Server stopped accepting new connections");

    clearInterval(cleanupInterval);
    logger.info({ phase: "shutdown" }, "Cleanup interval cleared");

    const { getSessionCount, cleanupExpiredSessions } = await import('./services/clickhouse');
    const sessionCount = getSessionCount();
    if (sessionCount > 0) {
      await cleanupExpiredSessions(0);
      logger.info({ phase: "shutdown", sessionCount }, "Closed ClickHouse sessions");
    }

    await shutdownRbac();
    logger.info({ phase: "shutdown" }, "RBAC system shut down");

    logger.info({ phase: "shutdown" }, "Graceful shutdown complete");
  } catch (error) {
    logger.error({ phase: "shutdown", err: error instanceof Error ? error.message : String(error) }, "Error during graceful shutdown");
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => {
  gracefulShutdown('SIGINT').catch((error) => {
    logger.error({ phase: "shutdown", err: error instanceof Error ? error.message : String(error) }, "Failed to shutdown gracefully");
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  gracefulShutdown('SIGTERM').catch((error) => {
    logger.error({ phase: "shutdown", err: error instanceof Error ? error.message : String(error) }, "Failed to shutdown gracefully");
    process.exit(1);
  });
});

logger.info({ phase: "startup", port: PORT }, `Server running at http://localhost:${PORT}`);

// Export for testing
export { app, server };

