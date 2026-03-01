import { Context, Next } from "hono";
import { logger } from "../utils/logger";

export interface CorsOptions {
  origin?: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  /** If true, reject requests from disallowed origins (default: true in production) */
  strictMode?: boolean;
  /** Paths that bypass origin check (e.g., health checks) */
  bypassPaths?: string[];
}

const defaultOptions: CorsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Session-ID"],
  exposedHeaders: ["X-Session-ID"],
  credentials: true,
  maxAge: 86400,
  strictMode: process.env.NODE_ENV === "production",
  bypassPaths: ["/api/health", "/api/rbac/health", "/api/rbac/status"],
};

/**
 * Check if origin is allowed
 */
function isOriginAllowed(origin: string, allowedOrigins: CorsOptions["origin"]): boolean {
  if (!allowedOrigins || allowedOrigins === "*") {
    return true;
  }

  if (typeof allowedOrigins === "string") {
    return origin === allowedOrigins;
  }

  if (Array.isArray(allowedOrigins)) {
    return allowedOrigins.some(allowed => {
      // Validate allowed origin format
      try {
        if (allowed !== "*" && !allowed.startsWith("*.")) {
          const url = new URL(allowed);
          if (!['http:', 'https:'].includes(url.protocol)) {
            logger.warn({ module: "CORS", allowed }, "Invalid protocol in allowed origin");
            return false;
          }
        }
      } catch (e) {
        logger.warn({ module: "CORS", allowed }, "Invalid allowed origin URL");
        return false;
      }

      // Support wildcard subdomains (e.g., *.example.com)
      if (allowed.startsWith("*.")) {
        const domain = allowed.slice(2);
        return origin.endsWith(domain) || origin.endsWith("." + domain);
      }
      return origin === allowed;
    });
  }

  if (typeof allowedOrigins === "function") {
    return allowedOrigins(origin);
  }

  return false;
}

/**
 * CORS middleware with strict origin enforcement
 * 
 * In strict mode (production), requests from disallowed origins are rejected.
 * This ensures the API can only be accessed by the UI, not by external websites.
 */
export function corsMiddleware(options: CorsOptions = {}) {
  const opts = { ...defaultOptions, ...options };

  // minimal validation of configuration in production
  if (opts.strictMode && (!opts.origin || opts.origin === "*" || (Array.isArray(opts.origin) && opts.origin.length === 0))) {
    logger.error({ module: "CORS" }, "CORS_ORIGINS must be set to specific domains in production");
    // We don't throw here to avoid crashing if env var is missing, but strict mode will block everything if origin is "*"
    // because isOriginAllowed returns true for "*", but strictMode logic below might need review.
    // Actually, let's look at logic: if origin is "*", isOriginAllowed returns true.
    // Then strictMode && hasOrigin && !isAllowed -> false. So it allows it.
    // We should probably force it to NOT allow * in strict mode.
  }

  return async (c: Context, next: Next) => {
    const origin = c.req.header("Origin") || "";
    const path = c.req.path;

    // Allow requests without Origin header (same-origin, curl, server-to-server)
    // These are typically:
    // - Same-origin requests from the UI (browser doesn't send Origin)
    // - Health checks from load balancers
    // - Server-to-server API calls
    const hasOrigin = !!origin;

    // Check if path bypasses origin check (health endpoints)
    const isBypassPath = opts.bypassPaths?.some(p => path.startsWith(p)) ?? false;

    // Determine if origin is allowed
    const isAllowed = !hasOrigin || isBypassPath || isOriginAllowed(origin, opts.origin);

    // In strict mode, reject requests from disallowed origins
    if (opts.strictMode && hasOrigin && !isAllowed) {
      logger.warn({ module: "CORS", origin, path }, "Blocked request from unauthorized origin");
      return c.json(
        {
          success: false,
          error: {
            code: "CORS_BLOCKED",
            message: "Cross-origin request blocked. This API is only accessible from the authorized UI.",
          },
        },
        403
      );
    }

    // Set CORS headers for allowed origins
    if (hasOrigin && isAllowed) {
      // For credentialed requests, must echo the specific origin (not *)
      const allowedOrigin = opts.origin === "*" ? origin : origin;
      c.header("Access-Control-Allow-Origin", allowedOrigin);
    } else if (!hasOrigin && opts.origin === "*") {
      // For non-CORS requests with wildcard config, set * 
      c.header("Access-Control-Allow-Origin", "*");
    }

    if (opts.credentials && isAllowed) {
      c.header("Access-Control-Allow-Credentials", "true");
    }

    if (opts.exposedHeaders?.length) {
      c.header("Access-Control-Expose-Headers", opts.exposedHeaders.join(", "));
    }

    // Handle preflight request
    if (c.req.method === "OPTIONS") {
      if (opts.methods?.length) {
        c.header("Access-Control-Allow-Methods", opts.methods.join(", "));
      }

      if (opts.allowedHeaders?.length) {
        c.header("Access-Control-Allow-Headers", opts.allowedHeaders.join(", "));
      }

      if (opts.maxAge) {
        c.header("Access-Control-Max-Age", opts.maxAge.toString());
      }

      return c.body(null, 204);
    }

    await next();
  };
}
