/**
 * RBAC Authentication Middleware
 * 
 * Middleware for JWT authentication and permission checking.
 */

import { Context, Next } from 'hono';
import {
  extractTokenFromHeader,
  type TokenPayload,
} from '../services/jwt';
import {
  verifyBearer,
  toTokenPayload,
  type BearerIdentity,
  type AuthMethod,
} from '../services/patAuth';
import { 
  userHasPermission, 
  userHasAnyPermission, 
  userHasAllPermissions,
  createAuditLog 
} from '../services/rbac';
import { AUDIT_ACTIONS, type Permission } from '../schema/base';
import { AppError } from '../../types';
import { isMcpSubrequestFor } from '../../mcp/inProcess';
import { runWithTokenScope, setTokenScope, type TokenScope } from '../services/tokenScope';

// ============================================
// Context Types
// ============================================

export interface RbacContext {
  rbacUser: TokenPayload;
  rbacUserId: string;
  rbacRoles: string[];
  rbacPermissions: string[];
  /** How the request authenticated. Absent only when no auth ran yet. */
  authMethod?: AuthMethod;
  /** PAT row id for PAT-authenticated requests (prefix only, never the secret). */
  patId?: string;
  /** True when the request's token names a scope, so it carries less than its owner holds. */
  tokenScoped?: boolean;
  /** True when the request's token belongs to an administrator (a scoped token does not carry that role). */
  tokenAdminOwner?: boolean;
}

/** What the request's credential says about the caller, as the context holds it. */
function attach(c: Context, identity: BearerIdentity): void {
  c.set('rbacUser', toTokenPayload(identity));
  c.set('rbacUserId', identity.userId);
  c.set('rbacRoles', identity.roles);
  c.set('rbacPermissions', identity.permissions);
  c.set('authMethod', identity.authMethod);
  c.set('tokenScoped', identity.scoped === true);
  c.set('tokenAdminOwner', identity.adminOwner === true);
  if (identity.patId) {
    c.set('patId', identity.patId);
  }
  rememberCredential(c);
}

/** The scope of the token in the context, or null for a browser session. */
function scopeOf(c: Context): TokenScope | null {
  if (c.get('authMethod') !== 'pat') return null;
  return {
    userId: c.get('rbacUserId'),
    permissions: c.get('rbacPermissions') ?? [],
    narrowed: c.get('tokenScoped') === true,
    adminOwner: c.get('tokenAdminOwner') === true,
  };
}

/**
 * Put the verified credential's scope into the request's holder, so every
 * permission question for the rest of the request is answered from it. Call
 * it wherever a bearer token is verified and written to the context.
 */
export function rememberCredential(c: Context): void {
  setTokenScope(scopeOf(c));
}

/**
 * Run the rest of a request made with a token so that every permission
 * question about its owner is answered from the token's own list (ADR 0011):
 * a check that asks the database by account id would otherwise answer with
 * everything the owner holds, whatever the token's scope. A browser session
 * runs as it is.
 */
export function inTokenScope<T>(c: Context, fn: () => Promise<T>): Promise<T> {
  const scope = scopeOf(c);
  if (!scope) return fn();
  // The request's holder already carries it when one is open (the server's outermost middleware opens one).
  // This covers code that runs the middleware without it.
  return runWithTokenScope(scope.userId, scope.permissions, fn, { narrowed: scope.narrowed, adminOwner: scope.adminOwner });
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
    const identity = await verifyBearer(token, { allowOAuth: isMcpSubrequestFor(token) });
    attach(c, identity);
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
  // Outside the try: a handler's own error is not an authentication failure.
  await inTokenScope(c, () => next());
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
      const identity = await verifyBearer(token, { allowOAuth: isMcpSubrequestFor(token) });
      attach(c, identity);
    } catch {
      // Token invalid/expired, but we don't fail - just continue without auth
    }
  }

  await inTokenScope(c, () => next());
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

    await inTokenScope(c, async () => {
      // Quick check from the credential first
      if (permissions.includes(permission)) {
        await next();
        return;
      }

      // A browser session's list is a snapshot from sign-in: ask the database, in case a permission was granted
      // since. For a token this answers from the token's own list, so its scope holds.
      const hasPermission = await userHasPermission(userId, permission);

      if (!hasPermission) {
        throw AppError.forbidden(`Permission '${permission}' required for this action`);
      }

      await next();
    });
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

    await inTokenScope(c, async () => {
      if (permissions.some(p => userPerms.includes(p))) {
        await next();
        return;
      }

      // As in requirePermission: the database for a session, the token's own list for a token.
      const hasAny = await userHasAnyPermission(userId, permissions);

      if (!hasAny) {
        throw AppError.forbidden(`One of these permissions required: ${permissions.join(', ')}`);
      }

      await next();
    });
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

    await inTokenScope(c, async () => {
      if (permissions.every(p => userPerms.includes(p))) {
        await next();
        return;
      }

      // As in requirePermission: the database for a session, the token's own list for a token.
      const hasAll = await userHasAllPermissions(userId, permissions);

      if (!hasAll) {
        throw AppError.forbidden(`All of these permissions required: ${permissions.join(', ')}`);
      }

      await next();
    });
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
 * Reject PAT-authenticated requests (ADR 0011 privilege fence).
 *
 * Token lifecycle and account-takeover operations (PAT CRUD, password change,
 * session logout) require an interactive browser JWT session. Call after
 * `rbacAuthMiddleware` in route handlers. Requests that never set an auth
 * method predate PATs and are always JWT sessions, so they pass.
 */
/**
 * Reject a token that names a scope on a route gated by a role alone, and
 * say why. Such a token does not carry its owner's administrator roles, so
 * the role check would refuse it anyway; this names the reason. The route is
 * for a browser session or a token that inherits everything its owner may do.
 */
export function refuseScopedToken(c: Context): void {
  if (c.get('tokenScoped') === true) {
    throw AppError.forbidden('This action is not within this token\'s scope. Use a browser session, or a token without a scope.');
  }
}

export function requireJwtSession(c: Context): void {
  if (c.get('authMethod') === 'pat') {
    throw AppError.forbidden(
      'This action requires a browser session and cannot be performed with a personal access token'
    );
  }
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
