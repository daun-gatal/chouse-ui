import { Hono } from "hono";
import { serve } from "bun";
import { serveStatic } from "hono/bun";
import api from "./routes";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { cleanupExpiredSessions, getSessionCount } from "./services/clickhouse";
import { initializeRbac, shutdownRbac } from "./rbac";

// Configuration
const PORT = parseInt(process.env.PORT || "5521", 10);
const STATIC_PATH = process.env.STATIC_PATH || "./dist";
const NODE_ENV = process.env.NODE_ENV || "development";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const SESSION_CLEANUP_INTERVAL = 60000; // 1 minute
const SESSION_MAX_AGE = 3600000; // 1 hour

// Create Hono app
const app = new Hono();

// ============================================
// Global Middleware
// ============================================

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
    c.header("Content-Security-Policy", [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Required for React/Vite
      "style-src 'self' 'unsafe-inline'", // Required for styled components
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'", // Only allow API calls to same origin
      "frame-ancestors 'self'",
    ].join("; "));
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

// Request logging in development
if (NODE_ENV === "development") {
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(`${c.req.method} ${c.req.path} - ${c.res.status} ${ms}ms`);
  });
}

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

console.log(`
╔══════════════════════════════════════════════════╗
║           CHouse UI Server               ║
╠══════════════════════════════════════════════════╣
║  Environment: ${NODE_ENV.padEnd(33)}║
║  Port: ${PORT.toString().padEnd(40)}║
║  Static Path: ${STATIC_PATH.padEnd(33)}║
║  CORS Origin: ${CORS_ORIGIN.substring(0, 33).padEnd(33)}║
╚══════════════════════════════════════════════════╝
`);

// Initialize RBAC system
initializeRbac().then(() => {
  console.log('RBAC system ready');
}).catch((error) => {
  console.error('Failed to initialize RBAC:', error);
  // Continue without RBAC - it's optional for backward compatibility
});

// Start session cleanup interval
const cleanupInterval = setInterval(async () => {
  const cleaned = await cleanupExpiredSessions(SESSION_MAX_AGE);
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} expired sessions. Active sessions: ${getSessionCount()}`);
  }
}, SESSION_CLEANUP_INTERVAL);

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  clearInterval(cleanupInterval);
  await shutdownRbac();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down...");
  clearInterval(cleanupInterval);
  await shutdownRbac();
  process.exit(0);
});

// Start server - bind app.fetch to preserve context
const server = serve({
  port: PORT,
  fetch: app.fetch.bind(app),
});

console.log(`Server running at http://localhost:${PORT}`);

// Export for testing
export { app, server };

