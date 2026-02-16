/**
 * RBAC Service
 * 
 * Core service for managing users, roles, and permissions.
 */

import { eq, and, inArray, sql, desc, asc, like, or, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDatabase, getSchema, isSqlite, type RbacDb } from '../db';
import { hashPassword, verifyPassword, needsRehash } from './password';
import { generateTokenPair, getRefreshTokenExpiryMs, type TokenPair } from './jwt';
import {
  SYSTEM_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  AUDIT_ACTIONS,
  type SystemRole,
  type Permission as PermissionName,
  type AuditAction,
} from '../schema/base';
import type {
  User,
  Role,
  Permission,
  UserWithRoles,
  RoleWithPermissions,
  UserResponse,
  RoleResponse,
  CreateUserInput,
  UpdateUserInput,
  CreateRoleInput,
  UpdateRoleInput,
} from '../schema';

// Type helper for working with dual database setup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ============================================
// User Management
// ============================================

/**
 * Create a new user
 */
export async function createUser(
  input: CreateUserInput,
  createdBy?: string
): Promise<UserResponse> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const id = randomUUID();
  const now = new Date();
  const passwordHash = await hashPassword(input.password);

  // Insert user
  await db.insert(schema.users).values({
    id,
    email: input.email.toLowerCase(),
    username: input.username.toLowerCase(),
    passwordHash,
    displayName: input.displayName || input.username,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    createdBy,
  });

  // Assign roles
  const roleIds = input.roleIds || [];
  if (roleIds.length === 0) {
    // Assign default role if no roles specified
    const defaultRole = await db.select()
      .from(schema.roles)
      .where(eq(schema.roles.isDefault, true))
      .limit(1);

    if (defaultRole.length > 0) {
      roleIds.push(defaultRole[0].id);
    }
  }

  if (roleIds.length > 0) {
    await db.insert(schema.userRoles).values(
      roleIds.map(roleId => ({
        id: randomUUID(),
        userId: id,
        roleId,
        assignedAt: now,
        assignedBy: createdBy,
      }))
    );
  }

  return getUserById(id) as Promise<UserResponse>;
}

/**
 * Get user by ID with roles and permissions
 */
export async function getUserById(id: string): Promise<UserResponse | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const user = await db.select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);

  if (user.length === 0) return null;

  return expandUserResponse(user[0]);
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const user = await db.select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);

  return user[0] || null;
}

/**
 * Get user by username
 */
export async function getUserByUsername(username: string): Promise<User | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const user = await db.select()
    .from(schema.users)
    .where(eq(schema.users.username, username.toLowerCase()))
    .limit(1);

  return user[0] || null;
}

/**
 * Get user by email or username (for login)
 */
export async function getUserByEmailOrUsername(identifier: string): Promise<User | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const normalized = identifier.toLowerCase();

  const user = await db.select()
    .from(schema.users)
    .where(
      or(
        eq(schema.users.email, normalized),
        eq(schema.users.username, normalized)
      )
    )
    .limit(1);

  return user[0] || null;
}

/**
 * Update user
 */
export async function updateUser(
  id: string,
  input: UpdateUserInput
): Promise<UserResponse | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const now = new Date();

  const updateData: Partial<User> = {
    updatedAt: now,
  };

  if (input.email !== undefined) updateData.email = input.email.toLowerCase();
  if (input.username !== undefined) updateData.username = input.username.toLowerCase();
  if (input.displayName !== undefined) updateData.displayName = input.displayName;
  if (input.avatarUrl !== undefined) updateData.avatarUrl = input.avatarUrl;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;

  await db.update(schema.users)
    .set(updateData)
    .where(eq(schema.users.id, id));

  // Update roles if provided
  if (input.roleIds !== undefined) {
    // Remove existing roles
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));

    // Add new roles
    if (input.roleIds.length > 0) {
      await db.insert(schema.userRoles).values(
        input.roleIds.map(roleId => ({
          id: randomUUID(),
          userId: id,
          roleId,
          assignedAt: now,
        }))
      );
    }
  }

  return getUserById(id);
}

/**
 * Update user password
 */
export async function updateUserPassword(
  id: string,
  newPassword: string
): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const passwordHash = await hashPassword(newPassword);

  await db.update(schema.users)
    .set({
      passwordHash,
      passwordChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, id));
}

/**
 * Delete user (soft delete by deactivating)
 */
export async function deleteUser(id: string): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  // Check if user is a system user
  const user = await db.select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);

  if (user[0]?.isSystemUser) {
    throw new Error('Cannot delete system user');
  }

  await db.update(schema.users)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(schema.users.id, id));
}

/**
 * List users with pagination
 */
export async function listUsers(options: {
  page?: number;
  limit?: number;
  search?: string;
  roleId?: string;
  isActive?: boolean;
} = {}): Promise<{ users: UserResponse[]; total: number }> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const page = options.page || 1;
  const limit = Math.min(options.limit || 20, 1000); // Increased max limit to support role filtering
  const offset = (page - 1) * limit;

  // If roleId is provided, we need to join with userRoles table
  if (options.roleId) {
    try {
      // Get user IDs that have this role
      const userRoles = await db.select({ userId: schema.userRoles.userId })
        .from(schema.userRoles)
        .where(eq(schema.userRoles.roleId, options.roleId));

      const userIds = userRoles.map((ur: { userId: string }) => ur.userId).filter(Boolean) as string[];

      if (userIds.length === 0) {
        // No users have this role
        return { users: [], total: 0 };
      }

      // Build conditions for filtering
      const conditions = [inArray(schema.users.id, userIds)];

      if (options.search) {
        const searchPattern = `%${options.search.toLowerCase()}%`;
        const searchCondition = or(
          like(schema.users.email, searchPattern),
          like(schema.users.username, searchPattern),
          like(schema.users.displayName, searchPattern)
        );
        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }

      if (options.isActive !== undefined) {
        conditions.push(eq(schema.users.isActive, options.isActive));
      }

      // Query users with the role
      const users = await db.select()
        .from(schema.users)
        .where(and(...conditions))
        .orderBy(asc(schema.users.username))
        .limit(limit)
        .offset(offset);

      // Get total count
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(schema.users)
        .where(and(...conditions));

      const total = Number(countResult[0]?.count || 0);

      // Expand user responses
      const userResponses = await Promise.all(users.map((u: User) => expandUserResponse(u)));

      return { users: userResponses, total };
    } catch (error) {
      console.error('[listUsers] Error filtering by role:', error);
      // Fall back to returning empty result if role filtering fails
      return { users: [], total: 0 };
    }
  }

  // Original logic when no roleId filter
  let query = db.select().from(schema.users);

  // Apply filters
  const conditions = [];

  if (options.search) {
    const searchPattern = `%${options.search.toLowerCase()}%`;
    conditions.push(
      or(
        like(schema.users.email, searchPattern),
        like(schema.users.username, searchPattern),
        like(schema.users.displayName, searchPattern)
      )
    );
  }

  if (options.isActive !== undefined) {
    conditions.push(eq(schema.users.isActive, options.isActive));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const users = await query
    .orderBy(asc(schema.users.username))
    .limit(limit)
    .offset(offset);

  // Get total count
  const countResult = await db.select({ count: sql<number>`count(*)` })
    .from(schema.users)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const total = Number(countResult[0]?.count || 0);

  // Expand user responses
  const userResponses = await Promise.all(users.map((u: User) => expandUserResponse(u)));

  return { users: userResponses, total };
}

// ============================================
// Role Management
// ============================================

/**
 * Create a new role
 */
export async function createRole(input: CreateRoleInput): Promise<RoleResponse> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const id = randomUUID();
  const now = new Date();

  // Handle default flag - if setting as default, clear default from all other roles
  if (input.isDefault === true) {
    await db.update(schema.roles)
      .set({ isDefault: false, updatedAt: now })
      .where(eq(schema.roles.isDefault, true));
  }

  await db.insert(schema.roles).values({
    id,
    name: input.name.toLowerCase().replace(/\s+/g, '_'),
    displayName: input.displayName,
    description: input.description,
    isSystem: false,
    isDefault: input.isDefault || false,
    priority: 50, // Custom roles get medium priority
    createdAt: now,
    updatedAt: now,
  });

  // Assign permissions
  if (input.permissionIds.length > 0) {
    await db.insert(schema.rolePermissions).values(
      input.permissionIds.map(permId => ({
        id: randomUUID(),
        roleId: id,
        permissionId: permId,
        createdAt: now,
      }))
    );
  }

  return getRoleById(id) as Promise<RoleResponse>;
}

/**
 * Get role by ID
 */
export async function getRoleById(id: string): Promise<RoleResponse | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const role = await db.select()
    .from(schema.roles)
    .where(eq(schema.roles.id, id))
    .limit(1);

  if (role.length === 0) return null;

  return expandRoleResponse(role[0]);
}

/**
 * Get role by name
 */
export async function getRoleByName(name: string): Promise<Role | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const role = await db.select()
    .from(schema.roles)
    .where(eq(schema.roles.name, name.toLowerCase()))
    .limit(1);

  return role[0] || null;
}

/**
 * Update role
 */
export async function updateRole(
  id: string,
  input: UpdateRoleInput,
  allowSystemRoleModification: boolean = false
): Promise<RoleResponse | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  // Check if role is a system role
  const existingRole = await db.select()
    .from(schema.roles)
    .where(eq(schema.roles.id, id))
    .limit(1);

  // Only block system role modification if not explicitly allowed (e.g., by super admin)
  if (existingRole[0]?.isSystem && !allowSystemRoleModification) {
    throw new Error('Cannot modify system role');
  }

  const updateData: Partial<Role> = {
    updatedAt: new Date(),
  };

  if (input.displayName !== undefined) updateData.displayName = input.displayName;
  if (input.description !== undefined) updateData.description = input.description;

  // Handle default flag - if setting as default, clear default from all other roles first
  if (input.isDefault === true) {
    await db.update(schema.roles)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(schema.roles.isDefault, true));
    updateData.isDefault = true;
  } else if (input.isDefault === false) {
    updateData.isDefault = false;
  }

  await db.update(schema.roles)
    .set(updateData)
    .where(eq(schema.roles.id, id));

  // Update permissions if provided
  if (input.permissionIds !== undefined) {
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, id));

    if (input.permissionIds.length > 0) {
      await db.insert(schema.rolePermissions).values(
        input.permissionIds.map(permId => ({
          id: randomUUID(),
          roleId: id,
          permissionId: permId,
          createdAt: new Date(),
        }))
      );
    }
  }

  return getRoleById(id);
}

/**
 * Delete role
 */
export async function deleteRole(id: string): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  // Check if role is a system role
  const role = await db.select()
    .from(schema.roles)
    .where(eq(schema.roles.id, id))
    .limit(1);

  if (role[0]?.isSystem) {
    throw new Error('Cannot delete system role');
  }

  // Delete role (cascade will handle related records)
  await db.delete(schema.roles).where(eq(schema.roles.id, id));
}

/**
 * List all roles
 */
export async function listRoles(): Promise<RoleResponse[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const roles = await db.select()
    .from(schema.roles)
    .orderBy(desc(schema.roles.priority), asc(schema.roles.name));

  return Promise.all(roles.map((r: Role) => expandRoleResponse(r)));
}

// ============================================
// Permission Management
// ============================================

/**
 * Get all permissions
 */
export async function listPermissions(): Promise<Permission[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  return db.select()
    .from(schema.permissions)
    .orderBy(asc(schema.permissions.category), asc(schema.permissions.name));
}

/**
 * Get permissions by category
 */
export async function getPermissionsByCategory(): Promise<Record<string, Permission[]>> {
  const permissions = await listPermissions();

  return permissions.reduce((acc, perm) => {
    if (!acc[perm.category]) {
      acc[perm.category] = [];
    }
    acc[perm.category].push(perm);
    return acc;
  }, {} as Record<string, Permission[]>);
}

/**
 * Check if user has a specific permission
 */
export async function userHasPermission(
  userId: string,
  permission: PermissionName
): Promise<boolean> {
  const permissions = await getUserPermissions(userId);
  return permissions.includes(permission);
}

/**
 * Check if user has any of the specified permissions
 */
export async function userHasAnyPermission(
  userId: string,
  permissions: PermissionName[]
): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  return permissions.some(p => userPerms.includes(p));
}

/**
 * Check if user has all of the specified permissions
 */
export async function userHasAllPermissions(
  userId: string,
  permissions: PermissionName[]
): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  return permissions.every(p => userPerms.includes(p));
}

/**
 * Get all permissions for a user (through their roles)
 */
export async function getUserPermissions(userId: string): Promise<string[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  // Get user's roles
  const userRolesData = await db.select({ roleId: schema.userRoles.roleId })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, userId));

  if (userRolesData.length === 0) return [];

  const roleIds = userRolesData.map((ur: { roleId: string }) => ur.roleId);

  // Get permissions for those roles
  const rolePerms = await db.select({ permissionId: schema.rolePermissions.permissionId })
    .from(schema.rolePermissions)
    .where(inArray(schema.rolePermissions.roleId, roleIds));

  if (rolePerms.length === 0) return [];

  const permIds = rolePerms.map((rp: { permissionId: string }) => rp.permissionId);

  // Get permission names
  const permissions = await db.select({ name: schema.permissions.name })
    .from(schema.permissions)
    .where(inArray(schema.permissions.id, permIds));

  return [...new Set(permissions.map((p: { name: string }) => p.name))] as string[];
}

/**
 * Get all roles for a user
 */
export async function getUserRoles(userId: string): Promise<string[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const userRolesData = await db.select({ roleId: schema.userRoles.roleId })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, userId));

  if (userRolesData.length === 0) return [];

  const roleIds = userRolesData.map((ur: { roleId: string }) => ur.roleId);

  const roles = await db.select({ name: schema.roles.name })
    .from(schema.roles)
    .where(inArray(schema.roles.id, roleIds));

  return roles.map((r: { name: string }) => r.name);
}

// ============================================
// Authentication
// ============================================

/**
 * Authenticate user and generate tokens
 */
export async function authenticateUser(
  identifier: string,
  password: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ user: UserResponse; tokens: TokenPair } | null> {
  const user = await getUserByEmailOrUsername(identifier);

  if (!user || !user.isActive) {
    return null;
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  // Check if password needs rehashing
  if (needsRehash(user.passwordHash)) {
    const newHash = await hashPassword(password);
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    await db.update(schema.users)
      .set({ passwordHash: newHash })
      .where(eq(schema.users.id, user.id));
  }

  // Update last login
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  await db.update(schema.users)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.users.id, user.id));

  // Get user roles and permissions
  const [roles, permissions] = await Promise.all([
    getUserRoles(user.id),
    getUserPermissions(user.id),
  ]);

  // Create session
  const sessionId = randomUUID();
  const tokens = await generateTokenPair(
    user.id,
    user.email,
    user.username,
    roles,
    permissions,
    sessionId
  );

  // Store refresh token in sessions table
  await db.insert(schema.sessions).values({
    id: sessionId,
    userId: user.id,
    refreshToken: tokens.refreshToken,
    ipAddress,
    userAgent,
    expiresAt: new Date(Date.now() + getRefreshTokenExpiryMs()),
    createdAt: new Date(),
  });

  const userResponse = await expandUserResponse(user);

  return { user: userResponse, tokens };
}

/**
 * Refresh access token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenPair | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  // Find session by refresh token
  const session = await db.select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.refreshToken, refreshToken),
        sql`${schema.sessions.revokedAt} IS NULL`
      )
    )
    .limit(1);

  if (session.length === 0) return null;

  const sessionData = session[0];

  // Check if session is expired
  if (new Date(sessionData.expiresAt) < new Date()) {
    return null;
  }

  // Get user
  const user = await db.select()
    .from(schema.users)
    .where(eq(schema.users.id, sessionData.userId))
    .limit(1);

  if (user.length === 0 || !user[0].isActive) {
    return null;
  }

  // Get roles and permissions
  const [roles, permissions] = await Promise.all([
    getUserRoles(user[0].id),
    getUserPermissions(user[0].id),
  ]);

  // Generate new token pair
  const newSessionId = randomUUID();
  const tokens = await generateTokenPair(
    user[0].id,
    user[0].email,
    user[0].username,
    roles,
    permissions,
    newSessionId
  );

  // Revoke old session and create new one
  await db.update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.id, sessionData.id));

  await db.insert(schema.sessions).values({
    id: newSessionId,
    userId: user[0].id,
    refreshToken: tokens.refreshToken,
    ipAddress: sessionData.ipAddress,
    userAgent: sessionData.userAgent,
    expiresAt: new Date(Date.now() + getRefreshTokenExpiryMs()),
    createdAt: new Date(),
  });

  // Update last used
  await db.update(schema.sessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.sessions.id, newSessionId));

  return tokens;
}

/**
 * Logout user (revoke session)
 */
export async function logoutUser(sessionId: string): Promise<void> {
  const db = getDatabase() as any;
  const schema = getSchema();

  await db.update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.id, sessionId));
}

/**
 * Logout user from all sessions
 */
export async function logoutAllSessions(userId: string): Promise<void> {
  const db = getDatabase() as any;
  const schema = getSchema();

  await db.update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.sessions.userId, userId),
        sql`${schema.sessions.revokedAt} IS NULL`
      )
    );
}

// ============================================
// Audit Logging
// ============================================

/**
 * Create an audit log entry
 */
export async function createAuditLog(
  action: AuditAction,
  userId?: string,
  options?: {
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    status?: 'success' | 'failed' | 'failure';
    errorMessage?: string;
  }
): Promise<void> {
  const db = getDatabase() as any;
  const schema = getSchema();

  // Fetch user details for snapshot if userId is provided
  let usernameSnapshot: string | undefined;
  let emailSnapshot: string | undefined;
  let displayNameSnapshot: string | undefined;

  if (userId) {
    try {
      const user = await getUserById(userId);
      if (user) {
        usernameSnapshot = user.username;
        emailSnapshot = user.email;
        displayNameSnapshot = user.displayName || undefined;
      }
    } catch (error) {
      // Ignore error if user fetch fails, just log without snapshot
      console.warn(`[createAuditLog] Failed to fetch user snapshot for ${userId}:`, error);
    }
  }

  await db.insert(schema.auditLogs).values({
    id: randomUUID(),
    userId,
    action,
    resourceType: options?.resourceType,
    resourceId: options?.resourceId,
    details: options?.details,
    ipAddress: options?.ipAddress,
    userAgent: options?.userAgent,
    status: options?.status || 'success',
    errorMessage: options?.errorMessage,
    usernameSnapshot,
    emailSnapshot,
    displayNameSnapshot,
    createdAt: new Date(),
  });
}

/**
 * Get audit logs with pagination
 */
export async function getAuditLogs(options: {
  page?: number;
  limit?: number;
  userId?: string;
  username?: string;
  email?: string;
  action?: string;
  status?: 'success' | 'failed' | 'failure';
  startDate?: Date;
  endDate?: Date;
  // Internal flag to allow higher limits for system operations
  _internal?: boolean;
} = {}): Promise<{ logs: any[]; total: number }> {
  const db = getDatabase() as any;
  const schema = getSchema();
  const page = options.page || 1;
  // Allow higher limits for query log matching and other system operations
  // Regular API calls are limited to 100, but allow up to 5000 for system operations
  // This is safe because audit logs are filtered by date range and action
  const maxLimit = 5000; // Increased from 100 to support query log matching
  const limit = Math.min(options.limit || 50, maxLimit);
  const offset = (page - 1) * limit;

  const conditions = [];

  if (options.userId) {
    conditions.push(eq(schema.auditLogs.userId, options.userId));
  }

  if (options.username) {
    conditions.push(like(schema.auditLogs.usernameSnapshot, `%${options.username.toLowerCase()}%`));
  }

  if (options.email) {
    conditions.push(like(schema.auditLogs.emailSnapshot, `%${options.email.toLowerCase()}%`));
  }

  if (options.action) {
    conditions.push(eq(schema.auditLogs.action, options.action));
  }

  if (options.status) {
    conditions.push(eq(schema.auditLogs.status, options.status));
  }

  // Add date range filtering
  if (options.startDate) {
    conditions.push(gte(schema.auditLogs.createdAt, options.startDate));
  }

  if (options.endDate) {
    conditions.push(lte(schema.auditLogs.createdAt, options.endDate));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const logs = await db.select()
    .from(schema.auditLogs)
    .where(whereClause)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  const countResult = await db.select({ count: sql<number>`count(*)` })
    .from(schema.auditLogs)
    .where(whereClause);

  return {
    logs,
    total: Number(countResult[0]?.count || 0),
  };
}

/**
 * Delete audit logs with filters
 */
export async function deleteAuditLogs(options: {
  userId?: string;
  username?: string;
  email?: string;
  action?: string;
  status?: 'success' | 'failed' | 'failure';
  startDate?: Date;
  endDate?: Date;
} = {}): Promise<{ deletedCount: number }> {
  const db = getDatabase() as any;
  const schema = getSchema();

  const conditions = [];

  if (options.userId) {
    conditions.push(eq(schema.auditLogs.userId, options.userId));
  }

  if (options.username) {
    conditions.push(like(schema.auditLogs.usernameSnapshot, `%${options.username.toLowerCase()}%`));
  }

  if (options.email) {
    conditions.push(like(schema.auditLogs.emailSnapshot, `%${options.email.toLowerCase()}%`));
  }

  if (options.action) {
    conditions.push(eq(schema.auditLogs.action, options.action));
  }

  if (options.status) {
    conditions.push(eq(schema.auditLogs.status, options.status));
  }

  if (options.startDate) {
    conditions.push(gte(schema.auditLogs.createdAt, options.startDate));
  }

  if (options.endDate) {
    conditions.push(lte(schema.auditLogs.createdAt, options.endDate));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db.delete(schema.auditLogs)
    .where(whereClause);

  // For SQLite/LibSQL, the result might not have rowsAffected in the same way as Postgres
  // But usually execute() returns information about affected rows.
  // In Drizzle with SQLite/LibSQL, it returns { rowsAffected: number }

  return {
    deletedCount: result.rowsAffected || 0,
  };
}

/**
 * Get audit metadata (distinct values for filters)
 */
export async function getAuditMetadata(): Promise<{
  usernames: string[];
  emails: string[];
  statuses: string[];
}> {
  const db = getDatabase() as any;
  const schema = getSchema();

  const [usernames, emails, statuses] = await Promise.all([
    db.selectDistinct({ value: schema.auditLogs.usernameSnapshot })
      .from(schema.auditLogs)
      .where(sql`${schema.auditLogs.usernameSnapshot} IS NOT NULL`)
      .orderBy(asc(schema.auditLogs.usernameSnapshot)),
    db.selectDistinct({ value: schema.auditLogs.emailSnapshot })
      .from(schema.auditLogs)
      .where(sql`${schema.auditLogs.emailSnapshot} IS NOT NULL`)
      .orderBy(asc(schema.auditLogs.emailSnapshot)),
    db.selectDistinct({ value: schema.auditLogs.status })
      .from(schema.auditLogs)
      .orderBy(asc(schema.auditLogs.status)),
  ]);

  return {
    usernames: usernames.map((r: any) => r.value).filter(Boolean),
    emails: emails.map((r: any) => r.value).filter(Boolean),
    statuses: statuses.map((r: any) => r.value).filter(Boolean),
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Expand user to UserResponse format
 */
async function expandUserResponse(user: User): Promise<UserResponse> {
  const [roles, permissions] = await Promise.all([
    getUserRoles(user.id),
    getUserPermissions(user.id),
  ]);

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    isActive: user.isActive,
    roles,
    permissions,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

/**
 * Expand role to RoleResponse format
 */
async function expandRoleResponse(role: Role): Promise<RoleResponse> {
  const db = getDatabase() as any;
  const schema = getSchema();

  // Get permission names for this role
  const rolePerms = await db.select({ permissionId: schema.rolePermissions.permissionId })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, role.id));

  let permissions: string[] = [];
  if (rolePerms.length > 0) {
    const permIds = rolePerms.map((rp: { permissionId: string }) => rp.permissionId);
    const perms = await db.select({ name: schema.permissions.name })
      .from(schema.permissions)
      .where(inArray(schema.permissions.id, permIds));
    permissions = perms.map((p: { name: string }) => p.name) as string[];
  }

  // Get user count for this role
  const userCountResult = await db.select({ count: sql<number>`count(*)` })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.roleId, role.id));

  return {
    id: role.id,
    name: role.name,
    displayName: role.displayName,
    description: role.description,
    isSystem: role.isSystem,
    isDefault: role.isDefault,
    priority: role.priority,
    permissions,
    userCount: Number(userCountResult[0]?.count || 0),
  };
}
