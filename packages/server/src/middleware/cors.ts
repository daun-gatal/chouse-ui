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
  /**
   * Paths any website may call without credentials: `Access-Control-Allow-Origin: *`
   * and never `Allow-Credentials`. For endpoints that take no cookies, such as
   * the MCP OAuth metadata, registration, token and revocation (ADR 0028).
   */
  publicPaths?: string[];
}

/** The MCP OAuth endpoints agents call from the browser (ADR 0028 §6). */
export const OAUTH_PUBLIC_PATHS = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
  "/oauth/register",
  "/oauth/token",
  "/oauth/revoke",
];

const defaultOptions: CorsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Session-ID", "X-Connection-Id", "MCP-Protocol-Version"],
  exposedHeaders: ["X-Session-ID", "WWW-Authenticate"],
  credentials: true,
  maxAge: 86400,
  strictMode: process.env.NODE_ENV === "production",
  // The SAML ACS receives a cross-site browser POST from the IdP (HTTP-POST
  // binding), which carries `Origin: null` — CORS is the wrong control here and
  // would block the assertion. Its real protections are XML-DSig verification +
  // the browser-bound RelayState cookie + replay/audience checks, not origin.
  // The MCP endpoint applies its own Origin allowlist (AI Governance › MCP), which
  // must be the only one: CORS_ORIGIN lists the UI, not agent hosts.
  bypassPaths: ["/api/health", "/api/rbac/health", "/api/rbac/status", "/auth/sso/saml/acs", "/mcp"],
  publicPaths: OAUTH_PUBLIC_PATHS,
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

      // Support wildcard subdomains (e.g., *.example.com). Compare hostnames:
      // a plain suffix check would also accept https://evilexample.com.
      if (allowed.startsWith("*.")) {
        const domain = allowed.slice(2).toLowerCase();
        let hostname: string;
        try {
          hostname = new URL(origin).hostname.toLowerCase();
        } catch {
          return false;
        }
        return hostname === domain || hostname.endsWith("." + domain);
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
  }

  // A wildcard config answers any site, so it must never also allow
  // credentials: echoing an arbitrary Origin with Allow-Credentials lets every
  // website make cookie-bearing requests and read the responses.
  const isWildcard = opts.origin === "*";

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
    if (opts.publicPaths?.some((p) => path === p || path.startsWith(`${p}/`))) {
      c.header("Access-Control-Allow-Origin", "*");
      if (c.req.method === "OPTIONS") {
        c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version");
        c.header("Access-Control-Max-Age", "86400");
        return c.body(null, 204);
      }
      await next();
      return;
    }

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
    if (isWildcard) {
      c.header("Access-Control-Allow-Origin", "*");
    } else if (hasOrigin && isAllowed) {
      // Credentialed responses must echo the specific origin, not *
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }

    if (opts.credentials && isAllowed && !isWildcard) {
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
