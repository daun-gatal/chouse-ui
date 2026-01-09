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
  createAuditLog,
} from '../services/rbac';
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
    await createAuditLog(AUDIT_ACTIONS.LOGIN_FAILED, undefined, {
      details: { identifier },
      ipAddress,
      userAgent,
      status: 'failure',
      errorMessage: 'Invalid credentials',
    });

    throw AppError.unauthorized('Invalid email/username or password');
  }

  // Log successful login
  await createAuditLog(AUDIT_ACTIONS.LOGIN, result.user.id, {
    ipAddress,
    userAgent,
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
  const userAgent = c.req.header('User-Agent');

  await logoutUser(user.sessionId);

  // Log logout
  await createAuditLog(AUDIT_ACTIONS.LOGOUT, user.sub, {
    ipAddress,
    userAgent,
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
  const userAgent = c.req.header('User-Agent');

  await logoutAllSessions(user.sub);

  // Log logout all
  await createAuditLog(AUDIT_ACTIONS.LOGOUT, user.sub, {
    details: { allSessions: true },
    ipAddress,
    userAgent,
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
 * POST /rbac/auth/change-password
 * Change current user's password
 */
authRoutes.post('/change-password', rbacAuthMiddleware, zValidator('json', ChangePasswordSchema), async (c) => {
  const user = getRbacUser(c);
  const { currentPassword, newPassword } = c.req.valid('json');
  const ipAddress = getClientIp(c);
  const userAgent = c.req.header('User-Agent');

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
    await createAuditLog(AUDIT_ACTIONS.PASSWORD_CHANGE, user.sub, {
      ipAddress,
      userAgent,
      status: 'failure',
      errorMessage: 'Invalid current password',
    });

    throw AppError.unauthorized('Current password is incorrect');
  }

  // Update password
  await updateUserPassword(user.sub, newPassword);

  // Log password change
  await createAuditLog(AUDIT_ACTIONS.PASSWORD_CHANGE, user.sub, {
    ipAddress,
    userAgent,
    status: 'success',
  });

  // Logout all other sessions for security
  await logoutAllSessions(user.sub);

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
