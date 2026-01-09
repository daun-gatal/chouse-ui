/**
 * RBAC Authentication Middleware
 * 
 * Middleware for JWT authentication and permission checking.
 */

import { Context, Next } from 'hono';
import { 
  verifyAccessToken, 
  extractTokenFromHeader,
  type TokenPayload 
} from '../services/jwt';
import { 
  userHasPermission, 
  userHasAnyPermission, 
  userHasAllPermissions,
  createAuditLog 
} from '../services/rbac';
import { AUDIT_ACTIONS, type Permission } from '../schema/base';
import { AppError } from '../../types';

// ============================================
// Context Types
// ============================================

export interface RbacContext {
  rbacUser: TokenPayload;
  rbacUserId: string;
  rbacRoles: string[];
  rbacPermissions: string[];
}

// Extend Hono context with RBAC data
declare module 'hono' {
  interface ContextVariableMap extends RbacContext {}
}

// ============================================
// Authentication Middleware
// ============================================

/**
 * RBAC Authentication middleware
 * Validates JWT and attaches user info to context
 */
export async function rbacAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const token = extractTokenFromHeader(authHeader);

  if (!token) {
    throw AppError.unauthorized('No authentication token provided');
  }

  try {
    const payload = await verifyAccessToken(token);

    // Attach user info to context
    c.set('rbacUser', payload);
    c.set('rbacUserId', payload.sub);
    c.set('rbacRoles', payload.roles);
    c.set('rbacPermissions', payload.permissions);

    await next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    
    // Log failed auth attempt
    await createAuditLog(AUDIT_ACTIONS.LOGIN_FAILED, undefined, {
      ipAddress: getClientIp(c),
      userAgent: c.req.header('User-Agent'),
      status: 'failure',
      errorMessage: message,
    });

    if (message.includes('expired')) {
      throw AppError.unauthorized('Token expired. Please refresh your token.');
    }
    throw AppError.unauthorized(message);
  }
}

/**
 * Optional RBAC auth middleware
 * Doesn't fail if no token, just sets null
 */
export async function optionalRbacAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const token = extractTokenFromHeader(authHeader);

  if (token) {
    try {
      const payload = await verifyAccessToken(token);
      c.set('rbacUser', payload);
      c.set('rbacUserId', payload.sub);
      c.set('rbacRoles', payload.roles);
      c.set('rbacPermissions', payload.permissions);
    } catch {
      // Token invalid/expired, but we don't fail - just continue without auth
    }
  }

  await next();
}

// ============================================
// Permission Middleware Factories
// ============================================

/**
 * Require a specific permission
 */
export function requirePermission(permission: Permission) {
  return async (c: Context, next: Next) => {
    // First ensure user is authenticated
    await rbacAuthMiddleware(c, async () => {});

    const userId = c.get('rbacUserId');
    const permissions = c.get('rbacPermissions');

    // Quick check from token first
    if (permissions.includes(permission)) {
      await next();
      return;
    }

    // Double-check against database (in case permissions changed)
    const hasPermission = await userHasPermission(userId, permission);
    
    if (!hasPermission) {
      throw AppError.forbidden(`Permission '${permission}' required for this action`);
    }

    await next();
  };
}

/**
 * Require any of the specified permissions
 */
export function requireAnyPermission(permissions: Permission[]) {
  return async (c: Context, next: Next) => {
    await rbacAuthMiddleware(c, async () => {});

    const userId = c.get('rbacUserId');
    const userPerms = c.get('rbacPermissions');

    // Quick check from token first
    if (permissions.some(p => userPerms.includes(p))) {
      await next();
      return;
    }

    // Double-check against database
    const hasAny = await userHasAnyPermission(userId, permissions);
    
    if (!hasAny) {
      throw AppError.forbidden(`One of these permissions required: ${permissions.join(', ')}`);
    }

    await next();
  };
}

/**
 * Require all of the specified permissions
 */
export function requireAllPermissions(permissions: Permission[]) {
  return async (c: Context, next: Next) => {
    await rbacAuthMiddleware(c, async () => {});

    const userId = c.get('rbacUserId');
    const userPerms = c.get('rbacPermissions');

    // Quick check from token first
    if (permissions.every(p => userPerms.includes(p))) {
      await next();
      return;
    }

    // Double-check against database
    const hasAll = await userHasAllPermissions(userId, permissions);
    
    if (!hasAll) {
      throw AppError.forbidden(`All of these permissions required: ${permissions.join(', ')}`);
    }

    await next();
  };
}

/**
 * Require a specific role
 */
export function requireRole(role: string) {
  return async (c: Context, next: Next) => {
    await rbacAuthMiddleware(c, async () => {});

    const roles = c.get('rbacRoles');
    
    if (!roles.includes(role)) {
      throw AppError.forbidden(`Role '${role}' required for this action`);
    }

    await next();
  };
}

/**
 * Require any of the specified roles
 */
export function requireAnyRole(roles: string[]) {
  return async (c: Context, next: Next) => {
    await rbacAuthMiddleware(c, async () => {});

    const userRoles = c.get('rbacRoles');
    
    if (!roles.some(r => userRoles.includes(r))) {
      throw AppError.forbidden(`One of these roles required: ${roles.join(', ')}`);
    }

    await next();
  };
}

/**
 * Super admin only middleware
 */
export async function superAdminOnly(c: Context, next: Next) {
  await rbacAuthMiddleware(c, async () => {});

  const roles = c.get('rbacRoles');
  
  if (!roles.includes('super_admin')) {
    throw AppError.forbidden('Super administrator access required');
  }

  await next();
}

/**
 * Admin or super admin middleware
 */
export async function adminOnly(c: Context, next: Next) {
  await rbacAuthMiddleware(c, async () => {});

  const roles = c.get('rbacRoles');
  
  if (!roles.includes('super_admin') && !roles.includes('admin')) {
    throw AppError.forbidden('Administrator access required');
  }

  await next();
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get client IP from request
 */
export function getClientIp(c: Context): string | undefined {
  return (
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    c.req.header('CF-Connecting-IP') || // Cloudflare
    undefined
  );
}

/**
 * Get RBAC user from context (throws if not authenticated)
 */
export function getRbacUser(c: Context): TokenPayload {
  const user = c.get('rbacUser');
  if (!user) {
    throw AppError.unauthorized('Not authenticated');
  }
  return user;
}

/**
 * Get RBAC user from context (returns null if not authenticated)
 */
export function getRbacUserOptional(c: Context): TokenPayload | null {
  return c.get('rbacUser') || null;
}

/**
 * Check if current user has permission (use in route handlers)
 */
export function hasPermission(c: Context, permission: Permission): boolean {
  const permissions = c.get('rbacPermissions') || [];
  return permissions.includes(permission);
}

/**
 * Check if current user has role (use in route handlers)
 */
export function hasRole(c: Context, role: string): boolean {
  const roles = c.get('rbacRoles') || [];
  return roles.includes(role);
}

/**
 * Check if current user is super admin
 */
export function isSuperAdmin(c: Context): boolean {
  return hasRole(c, 'super_admin');
}

/**
 * Check if current user is admin (including super admin)
 */
export function isAdmin(c: Context): boolean {
  return hasRole(c, 'super_admin') || hasRole(c, 'admin');
}
