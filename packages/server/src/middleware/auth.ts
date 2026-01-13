import { Context, Next } from "hono";
import { getSession } from "../services/clickhouse";
import { AppError } from "../types";

const SESSION_COOKIE_NAME = "ch_session";

export interface AuthContext {
  sessionId: string;
  service: import("../services/clickhouse").ClickHouseService;
  session: import("../types").Session;
}

/**
 * Authentication middleware that validates session from cookie
 * Also validates session ownership if RBAC user is present
 */
export async function authMiddleware(c: Context, next: Next) {
  const sessionId = c.req.header("X-Session-ID") || getCookie(c, SESSION_COOKIE_NAME);

  if (!sessionId) {
    throw AppError.unauthorized("No session provided. Please login first.");
  }

  const sessionData = getSession(sessionId);

  if (!sessionData) {
    throw AppError.unauthorized("Invalid or expired session. Please login again.");
  }

  // Validate session ownership if RBAC user is present
  // This prevents users from accessing sessions created by other users
  const rbacUserId = c.get("rbacUserId");
  if (rbacUserId && sessionData.session.rbacUserId) {
    if (sessionData.session.rbacUserId !== rbacUserId) {
      // Session belongs to a different user - destroy it and reject
      const { destroySession } = await import("../services/clickhouse");
      await destroySession(sessionId).catch((err) => {
        console.error("[Auth] Failed to destroy invalid session:", err);
      });
      throw AppError.forbidden("Session does not belong to current user. Please reconnect.");
    }
  }

  // Attach session data to context
  c.set("sessionId", sessionId);
  c.set("service", sessionData.service);
  c.set("session", sessionData.session);

  await next();
}

/**
 * Optional auth middleware - doesn't fail if no session, just sets null
 * Also validates session ownership if RBAC user is present
 */
export async function optionalAuthMiddleware(c: Context, next: Next) {
  const sessionId = c.req.header("X-Session-ID") || getCookie(c, SESSION_COOKIE_NAME);

  if (sessionId) {
    const sessionData = getSession(sessionId);
    if (sessionData) {
      // Validate session ownership if RBAC user is present
      const rbacUserId = c.get("rbacUserId");
      if (rbacUserId && sessionData.session.rbacUserId) {
        if (sessionData.session.rbacUserId !== rbacUserId) {
          // Session belongs to a different user - destroy it silently
          const { destroySession } = await import("../services/clickhouse");
          await destroySession(sessionId).catch((err) => {
            console.error("[Auth] Failed to destroy invalid session:", err);
          });
          // Don't set session - continue without it
        } else {
          // Session is valid - attach to context
          c.set("sessionId", sessionId);
          c.set("service", sessionData.service);
          c.set("session", sessionData.session);
        }
      } else {
        // No RBAC user or session has no userId - allow legacy behavior
        c.set("sessionId", sessionId);
        c.set("service", sessionData.service);
        c.set("session", sessionData.session);
      }
    }
  }

  await next();
}

/**
 * Admin-only middleware - requires authentication and admin privileges
 */
export async function adminMiddleware(c: Context, next: Next) {
  await authMiddleware(c, next);

  const session = c.get("session") as import("../types").Session | undefined;

  if (!session?.isAdmin) {
    throw AppError.forbidden("Admin privileges required for this action.");
  }
}

/**
 * Permission check middleware factory
 */
export function requirePermission(permission: string) {
  return async (c: Context, next: Next) => {
    await authMiddleware(c, async () => {});

    const session = c.get("session") as import("../types").Session;

    if (session.isAdmin) {
      await next();
      return;
    }

    const hasPermission = session.permissions.some((p) => {
      if (p === "ALL" || p === "ALL DATABASES" || p === "ALL TABLES") return true;
      if (p === permission) return true;
      if (permission.startsWith(p)) return true;
      return false;
    });

    if (!hasPermission) {
      throw AppError.forbidden(`Permission '${permission}' required for this action.`);
    }

    await next();
  };
}

// Helper to get cookie value
function getCookie(c: Context, name: string): string | undefined {
  const cookies = c.req.header("Cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

// Helper to set cookie
export function setSessionCookie(c: Context, sessionId: string, maxAge: number = 86400): void {
  const isSecure = c.req.url.startsWith("https");
  const cookie = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Strict`,
    `Max-Age=${maxAge}`,
    isSecure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

  c.header("Set-Cookie", cookie);
}

// Helper to clear session cookie
export function clearSessionCookie(c: Context): void {
  c.header("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

