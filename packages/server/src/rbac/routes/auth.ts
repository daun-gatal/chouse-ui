/**
 * RBAC Authentication Routes
 * 
 * Handles login, logout, token refresh, and password management.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  authenticateUser,
  refreshAccessToken,
  logoutUser,
  logoutAllSessions,
  updateUserPassword,
  getUserById,
  createAuditLogWithContext,
  listRoles,
} from '../services/rbac';
import { getUserConnections } from '../services/connections';
import { getRulesForUser } from '../services/dataAccess';
import { validatePasswordStrength } from '../services/password';
import { verifyRefreshToken } from '../services/jwt';
import { AUDIT_ACTIONS, PERMISSIONS } from '../schema/base';
import {
  rbacAuthMiddleware,
  getClientIp,
  getRbacUser,
  requirePermission
} from '../middleware/rbacAuth';
import { AppError } from '../../types';

const authRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const LoginSchema = z.object({
  identifier: z.string().min(1, 'Email or username is required'),
  password: z.string().min(1, 'Password is required'),
});

const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// ============================================
// Routes
// ============================================

/**
 * POST /rbac/auth/login
 * Authenticate user and return tokens
 */
authRoutes.post('/login', zValidator('json', LoginSchema), async (c) => {
  const { identifier, password } = c.req.valid('json');
  const ipAddress = getClientIp(c);
  const userAgent = c.req.header('User-Agent');

  const result = await authenticateUser(identifier, password, ipAddress, userAgent);

  if (!result) {
    // Log failed login
    await createAuditLogWithContext(c, AUDIT_ACTIONS.LOGIN_FAILED, undefined, {
      details: { identifier },
      ipAddress,
      status: 'failure',
      errorMessage: 'Invalid credentials',
    });

    throw AppError.unauthorized('Invalid email/username or password');
  }

  // Log successful login
  await createAuditLogWithContext(c, AUDIT_ACTIONS.LOGIN, result.user.id, {
    ipAddress,
    status: 'success',
  });

  return c.json({
    success: true,
    data: {
      user: result.user,
      tokens: result.tokens,
    },
  });
});

/**
 * POST /rbac/auth/refresh
 * Refresh access token using refresh token
 */
authRoutes.post('/refresh', zValidator('json', RefreshTokenSchema), async (c) => {
  const { refreshToken } = c.req.valid('json');

  try {
    const tokens = await refreshAccessToken(refreshToken);

    if (!tokens) {
      throw AppError.unauthorized('Invalid or expired refresh token');
    }

    return c.json({
      success: true,
      data: { tokens },
    });
  } catch (error) {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }
});

/**
 * POST /rbac/auth/logout
 * Logout current session
 */
authRoutes.post('/logout', rbacAuthMiddleware, async (c) => {
  const user = getRbacUser(c);
  const ipAddress = getClientIp(c);

  await logoutUser(user.sessionId);

  // Destroy all ClickHouse sessions owned by this user
  try {
    const { destroyUserSessions } = await import('../../services/clickhouse');
    const destroyed = await destroyUserSessions(user.sub);
    if (destroyed > 0) {
      console.log(`[Auth] Destroyed ${destroyed} ClickHouse session(s) for user ${user.sub}`);
    }
  } catch (error) {
    console.error('[Auth] Failed to destroy ClickHouse sessions on logout:', error);
    // Continue with logout even if session cleanup fails
  }

  // Log logout
  await createAuditLogWithContext(c, AUDIT_ACTIONS.LOGOUT, user.sub, {
    ipAddress,
    status: 'success',
  });

  return c.json({
    success: true,
    data: { message: 'Logged out successfully' },
  });
});

/**
 * POST /rbac/auth/logout-all
 * Logout from all sessions
 */
authRoutes.post('/logout-all', rbacAuthMiddleware, async (c) => {
  const user = getRbacUser(c);
  const ipAddress = getClientIp(c);

  await logoutAllSessions(user.sub);

  // Destroy all ClickHouse sessions owned by this user
  try {
    const { destroyUserSessions } = await import('../../services/clickhouse');
    const destroyed = await destroyUserSessions(user.sub);
    if (destroyed > 0) {
      console.log(`[Auth] Destroyed ${destroyed} ClickHouse session(s) for user ${user.sub} (logout-all)`);
    }
  } catch (error) {
    console.error('[Auth] Failed to destroy ClickHouse sessions on logout-all:', error);
    // Continue with logout even if session cleanup fails
  }

  // Log logout all
  await createAuditLogWithContext(c, AUDIT_ACTIONS.LOGOUT, user.sub, {
    details: { allSessions: true },
    ipAddress,
    status: 'success',
  });

  return c.json({
    success: true,
    data: { message: 'Logged out from all sessions' },
  });
});

/**
 * GET /rbac/auth/me
 * Get current user info
 */
authRoutes.get('/me', rbacAuthMiddleware, async (c) => {
  const user = getRbacUser(c);

  const fullUser = await getUserById(user.sub);

  if (!fullUser) {
    throw AppError.notFound('User not found');
  }

  return c.json({
    success: true,
    data: { user: fullUser },
  });
});

/**
 * GET /rbac/auth/profile
 * Get aggregated system profile for the current user (used by Preferences page)
 */
authRoutes.get('/profile', rbacAuthMiddleware, async (c) => {
  const user = getRbacUser(c);

  // 1. Fetch all data in parallel
  const [fullUser, connections, allRules, allRoles] = await Promise.all([
    getUserById(user.sub),
    getUserConnections(user.sub),
    getRulesForUser(user.sub),
    listRoles(),
  ]);

  if (!fullUser) {
    throw AppError.notFound('User not found');
  }

  // 2. Map role names to full role metadata for display
  const userRoles = fullUser.roles.map(roleName => {
    const roleMetadata = allRoles.find(r => r.name === roleName);
    return {
      name: roleName,
      displayName: roleMetadata?.displayName || roleName,
      description: roleMetadata?.description,
    };
  });

  return c.json({
    success: true,
    data: {
      user: {
        ...fullUser,
        rolesMetadata: userRoles,
      },
      connections,
      dataAccessRules: allRules,
    },
  });
});

/**
 * POST /rbac/auth/change-password
 * Change current user's password
 */
authRoutes.post('/change-password', rbacAuthMiddleware, zValidator('json', ChangePasswordSchema), async (c) => {
  const user = getRbacUser(c);
  const { currentPassword, newPassword } = c.req.valid('json');
  const ipAddress = getClientIp(c);

  // Validate new password strength
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    throw AppError.badRequest('Password does not meet requirements', {
      errors: strength.errors,
    });
  }

  // Verify current password by attempting login
  const verification = await authenticateUser(user.email, currentPassword);

  if (!verification) {
    await createAuditLogWithContext(c, AUDIT_ACTIONS.PASSWORD_CHANGE, user.sub, {
      ipAddress,
      status: 'failure',
      errorMessage: 'Invalid current password',
    });

    throw AppError.unauthorized('Current password is incorrect');
  }

  // Update password
  await updateUserPassword(user.sub, newPassword);

  // Log password change
  await createAuditLogWithContext(c, AUDIT_ACTIONS.PASSWORD_CHANGE, user.sub, {
    ipAddress,
    status: 'success',
  });

  // Logout all other sessions for security
  await logoutAllSessions(user.sub);

  // Destroy all ClickHouse sessions owned by this user
  try {
    const { destroyUserSessions } = await import('../../services/clickhouse');
    await destroyUserSessions(user.sub);
  } catch (error) {
    console.error('[Auth] Failed to destroy ClickHouse sessions on password change:', error);
    // Continue even if session cleanup fails
  }

  return c.json({
    success: true,
    data: { message: 'Password changed successfully. Please login again.' },
  });
});

/**
 * GET /rbac/auth/validate
 * Validate current token (useful for frontend to check auth status)
 */
authRoutes.get('/validate', rbacAuthMiddleware, async (c) => {
  const user = getRbacUser(c);

  return c.json({
    success: true,
    data: {
      valid: true,
      userId: user.sub,
      username: user.username,
      roles: user.roles,
      permissions: user.permissions,
    },
  });
});

export default authRoutes;
