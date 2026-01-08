import { Context, Next } from "hono";

export interface CorsOptions {
  origin?: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

const defaultOptions: CorsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Session-ID"],
  exposedHeaders: ["X-Session-ID"],
  credentials: true,
  maxAge: 86400,
};

/**
 * CORS middleware
 */
export function corsMiddleware(options: CorsOptions = {}) {
  const opts = { ...defaultOptions, ...options };

  return async (c: Context, next: Next) => {
    const origin = c.req.header("Origin") || "";

    // Determine allowed origin
    let allowedOrigin = "";
    if (typeof opts.origin === "string") {
      allowedOrigin = opts.origin === "*" ? origin || "*" : opts.origin;
    } else if (Array.isArray(opts.origin)) {
      allowedOrigin = opts.origin.includes(origin) ? origin : "";
    } else if (typeof opts.origin === "function") {
      allowedOrigin = opts.origin(origin) ? origin : "";
    }

    // Set CORS headers
    if (allowedOrigin) {
      c.header("Access-Control-Allow-Origin", allowedOrigin);
    }

    if (opts.credentials) {
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

