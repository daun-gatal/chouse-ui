import { Hono } from "hono";
import { Context, Next } from "hono";
import query from "./query";
import explorer from "./explorer";
import metrics from "./metrics";
import savedQueries from "./saved-queries";
import config from "./config";
import liveQueries from "./live-queries";
import { rbacRoutes } from "../rbac";
import upload from "./upload";
import aiChat from "./ai-chat";

const api = new Hono();

/**
 * API Request Protection Middleware
 * 
 * Ensures API calls come from JavaScript (XHR/fetch), not direct browser navigation.
 * Direct URL access in browser will be blocked.
 * 
 * How it works:
 * - Browser navigation: No X-Requested-With header → Blocked
 * - JavaScript fetch: Has X-Requested-With header → Allowed
 */
const apiProtectionMiddleware = async (c: Context, next: Next) => {
  const path = c.req.path;

  // Skip protection for:
  // - Health checks (needed for load balancers)
  // - Config endpoint (needed before app loads)
  // - RBAC auth endpoints (for RBAC login)
  const publicPaths = [
    "/api/health",
    "/api/config",
    "/api/rbac/auth/login",
    "/api/rbac/auth/refresh",
    "/api/rbac/health",
  ];
  if (publicPaths.some(p => path === p || path.startsWith(p + "/"))) {
    await next();
    return;
  }

  // Check for X-Requested-With header (set by frontend JavaScript)
  const requestedWith = c.req.header("X-Requested-With");

  if (requestedWith !== "XMLHttpRequest") {
    return c.json({
      success: false,
      error: "Direct API access is not allowed. Please use the application UI.",
      code: "DIRECT_ACCESS_DENIED",
    }, 403);
  }

  await next();
};

// Apply API protection to all routes
api.use("*", apiProtectionMiddleware);

// Public routes (no auth required)
api.route("/config", config);

// Mount route modules
api.route("/query", query);
api.route("/explorer", explorer);
api.route("/metrics", metrics);
api.route("/saved-queries", savedQueries);
api.route("/live-queries", liveQueries);
api.route("/upload", upload);
api.route("/ai-chat", aiChat);

// RBAC routes (Role-Based Access Control)
api.route("/rbac", rbacRoutes);

// Health check endpoint
api.get("/health", (c) => {
  return c.json({
    success: true,
    data: {
      status: "healthy",
      timestamp: new Date().toISOString(),
    },
  });
});

export default api;

