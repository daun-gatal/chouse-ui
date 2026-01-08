import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { randomUUID } from "crypto";
import { ConnectionConfigSchema, AppError } from "../types";
import { ClickHouseService, createSession, destroySession, getSession } from "../services/clickhouse";
import { setSessionCookie, clearSessionCookie, authMiddleware } from "../middleware/auth";

const auth = new Hono();

/**
 * POST /auth/login
 * Authenticate with ClickHouse and create a session
 */
auth.post("/login", zValidator("json", ConnectionConfigSchema), async (c) => {
  const config = c.req.valid("json");

  // Create a temporary service to test connection
  const testService = new ClickHouseService(config);

  try {
    // Test connection
    const isConnected = await testService.ping();
    if (!isConnected) {
      throw AppError.unauthorized("Failed to connect to ClickHouse server");
    }

    // Get version and admin status
    const [version, adminStatus] = await Promise.all([
      testService.getVersion(),
      testService.checkIsAdmin(),
    ]);

    // Close temporary service
    await testService.close();

    // Create session
    const sessionId = randomUUID();
    createSession(sessionId, config, {
      createdAt: new Date(),
      lastUsedAt: new Date(),
      isAdmin: adminStatus.isAdmin,
      permissions: adminStatus.permissions,
      version,
    });

    // Set session cookie
    setSessionCookie(c, sessionId);

    return c.json({
      success: true,
      data: {
        sessionId,
        username: config.username,
        isAdmin: adminStatus.isAdmin,
        version,
        permissions: adminStatus.permissions,
      },
    });
  } catch (error) {
    await testService.close();
    throw error;
  }
});

/**
 * POST /auth/logout
 * Destroy the current session
 */
auth.post("/logout", authMiddleware, async (c) => {
  const sessionId = c.get("sessionId") as string;

  await destroySession(sessionId);
  clearSessionCookie(c);

  return c.json({
    success: true,
    data: { message: "Logged out successfully" },
  });
});

/**
 * GET /auth/session
 * Get current session info
 */
auth.get("/session", authMiddleware, async (c) => {
  const session = c.get("session") as import("../types").Session;
  const service = c.get("service") as ClickHouseService;

  // Refresh admin status
  const adminStatus = await service.checkIsAdmin();

  return c.json({
    success: true,
    data: {
      sessionId: session.id,
      username: session.connectionConfig.username,
      isAdmin: adminStatus.isAdmin,
      permissions: adminStatus.permissions,
      version: session.version,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
    },
  });
});

/**
 * POST /auth/refresh
 * Refresh session and check connection health
 */
auth.post("/refresh", authMiddleware, async (c) => {
  const session = c.get("session") as import("../types").Session;
  const service = c.get("service") as ClickHouseService;

  try {
    // Test connection is still alive
    await service.ping();
    const adminStatus = await service.checkIsAdmin();

    // Update session data
    session.isAdmin = adminStatus.isAdmin;
    session.permissions = adminStatus.permissions;
    session.lastUsedAt = new Date();

    return c.json({
      success: true,
      data: {
        isConnected: true,
        isAdmin: adminStatus.isAdmin,
        permissions: adminStatus.permissions,
      },
    });
  } catch (error) {
    // Connection failed - destroy session
    await destroySession(session.id);
    clearSessionCookie(c);

    throw AppError.unauthorized("Session expired. Please login again.");
  }
});

export default auth;

