/**
 * RBAC User Management Routes
 * 
 * Handles CRUD operations for users.
 */

import { suspendBindingsOf } from '../services/clickhouseBindings';
import { defaultRoleIsMapped, holdsMappedRole, mappedRoleIds } from '../services/connectionIdentity';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Context } from 'hono';
import {
  createUser,
  getRoleById,
  getUserById,
  updateUser,
  deleteUser,
  listUsers,
  updateUserPassword,
  createAuditLogWithContext,
} from '../services/rbac';
import { validatePasswordStrength, generateSecurePassword } from '../services/password';
import { listUserIdentities, deleteUserIdentity } from '../sso/identity';
import { getSsoConfig } from '../sso/config';
import { AUDIT_ACTIONS, PERMISSIONS } from '../schema/base';
import {
  rbacAuthMiddleware,
  requirePermission,
  requireAnyPermission,
  getClientIp,
  getRbacUser,
  isSuperAdmin,
} from '../middleware/rbacAuth';
import { AppError, requireParam } from '../../types';
import { requestLogger } from '../../utils/logger';

const userRoutes = new Hono();

// ============================================
// Schemas
// ============================================

/**
 * A user may only hand out roles whose permissions they already hold.
 * `roles:assign` / `users:create` alone would otherwise let an admin give
 * themselves (or a new account) `super_admin`, or any role above their own.
 */
async function assertCanGrantRoles(c: Context, roleIds: string[] | undefined, forNewAccount = false): Promise<void> {
  if (isSuperAdmin(c)) return;
  // An account created with no role gets the default role; that is an assignment too.
  if (!roleIds?.length) {
    if (forNewAccount && (await defaultRoleIsMapped())) {
      throw AppError.forbidden('Only a super admin can create this account: the default role is mapped to a ClickHouse role on a connection.');
    }
    return;
  }
  // A role mapped to a ClickHouse role decides what ClickHouse lets its holder
  // do on a connection, so only a super admin hands it out (ADR 0033 §6).
  if ((await mappedRoleIds(roleIds)).length > 0) {
    throw AppError.forbidden('Only a super admin can assign this role: it is mapped to a ClickHouse role on a connection.');
  }
  const held = new Set<string>((c.get('rbacPermissions') as string[] | undefined) ?? []);
  for (const roleId of roleIds) {
    const role = await getRoleById(roleId);
    if (!role) throw AppError.badRequest('Role not found');
    if (role.name === 'super_admin' || role.permissions.some((permission) => !held.has(permission))) {
      throw AppError.forbidden(`Cannot assign role '${role.name}': it grants permissions you do not have`);
    }
  }
}

/**
 * An account whose role is mapped to a ClickHouse role (ADR 0033 §6) reaches
 * what that role is granted. Changing it, resetting its password, removing a
 * sign-in identity from it or deleting it is a super admin's to do: anyone
 * else who could reset its password could sign in as it.
 */
async function assertMayActOnMappedHolder(c: Context, userId: string): Promise<void> {
  if (isSuperAdmin(c)) return;
  if (await holdsMappedRole(userId)) {
    throw AppError.forbidden('Only a super admin can change this account: its role is mapped to a ClickHouse role on a connection.');
  }
}

const CreateUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  username: z.string().min(3, 'Username must be at least 3 characters').max(50),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  displayName: z.string().max(100).optional(),
  roleIds: z.array(z.string()).max(1, 'Only one role can be assigned to a user').optional(),
  generatePassword: z.boolean().optional(),
});

const UpdateUserSchema = z.object({
  email: z.string().email('Invalid email address').optional(),
  username: z.string().min(3).max(50).optional(),
  displayName: z.string().max(100).optional(),
  avatarUrl: z.string().url().optional().nullable(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.string()).max(1, 'Only one role can be assigned to a user').optional(),
});

const ResetPasswordSchema = z.object({
  newPassword: z.string().min(8).optional(),
  generatePassword: z.boolean().optional(),
});

const ListUsersSchema = z.object({
  page: z.string().transform(Number).optional(),
  limit: z.string().transform(Number).optional(),
  search: z.string().optional(),
  roleId: z.string().optional(),
  isActive: z.string().transform(v => v === 'true').optional(),
});

// ============================================
// Routes
// ============================================

/**
 * GET /rbac/users
 * List users with pagination and filters
 */
userRoutes.get('/', requirePermission(PERMISSIONS.USERS_VIEW), zValidator('query', ListUsersSchema), async (c) => {
  const query = c.req.valid('query');

  const result = await listUsers({
    page: query.page || 1,
    limit: query.limit || 20,
    search: query.search,
    roleId: query.roleId,
    isActive: query.isActive,
  });

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * GET /rbac/users/:id
 * Get user by ID
 * 
 * Permission rules:
 * - Users with USERS_VIEW permission can view any user
 * - Users without USERS_VIEW permission can only view their own profile
 */
userRoutes.get('/:id', rbacAuthMiddleware, async (c) => {
  const id = requireParam(c, 'id');

  // Validate user ID format (basic UUID validation)
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw AppError.badRequest('Invalid user ID format');
  }

  const currentUser = getRbacUser(c);
  const permissions = c.get('rbacPermissions');
  const hasUsersView = permissions.includes(PERMISSIONS.USERS_VIEW);

  // If user doesn't have USERS_VIEW permission, they can only view their own profile
  if (!hasUsersView && id !== currentUser.sub) {
    throw AppError.forbidden(`Permission '${PERMISSIONS.USERS_VIEW}' required to view other users' profiles`);
  }

  let user;
  try {
    user = await getUserById(id);
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'Users', err: error instanceof Error ? error.message : String(error) }, 'Failed to fetch user');
    throw AppError.internal('Failed to fetch user');
  }

  if (!user) {
    throw AppError.notFound('User not found');
  }

  return c.json({
    success: true,
    data: { user },
  });
});

/**
 * POST /rbac/users
 * Create a new user
 */
userRoutes.post('/', requirePermission(PERMISSIONS.USERS_CREATE), zValidator('json', CreateUserSchema), async (c) => {
  const input = c.req.valid('json');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);

  // Handle password
  let password = input.password;
  let generatedPassword: string | undefined;

  if (input.generatePassword || !password) {
    generatedPassword = generateSecurePassword(16);
    password = generatedPassword;
  } else {
    // Validate password strength
    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      throw AppError.badRequest('Password does not meet requirements', {
        errors: strength.errors,
      });
    }
  }

  await assertCanGrantRoles(c, input.roleIds, true);

  try {
    const user = await createUser({
      email: input.email,
      username: input.username,
      password,
      displayName: input.displayName,
      roleIds: input.roleIds,
    }, currentUser.sub);

    // Log user creation
    await createAuditLogWithContext(c, AUDIT_ACTIONS.USER_CREATE, currentUser.sub, {
      resourceType: 'user',
      resourceId: user.id,
      details: {
        email: user.email,
        username: user.username,
        roles: user.roles,
      },
      ipAddress,
    });

    return c.json({
      success: true,
      data: {
        user,
        generatedPassword, // Only included if password was generated
      },
    }, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      throw AppError.badRequest('Email or username already exists');
    }
    throw error;
  }
});

/**
 * PATCH /rbac/users/:id
 * Update user
 */
userRoutes.patch('/:id', requirePermission(PERMISSIONS.USERS_UPDATE), zValidator('json', UpdateUserSchema), async (c) => {
  const id = requireParam(c, 'id');
  const input = c.req.valid('json');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);

  // Check if user exists
  const existingUser = await getUserById(id);
  if (!existingUser) {
    throw AppError.notFound('User not found');
  }

  // Prevent modifying super admin unless you're also super admin
  if (existingUser.roles.includes('super_admin') && !isSuperAdmin(c)) {
    throw AppError.forbidden('Cannot modify super administrator');
  }
  await assertMayActOnMappedHolder(c, id);

  // Prevent deactivating yourself
  if (input.isActive === false && id === currentUser.sub) {
    throw AppError.badRequest('Cannot deactivate your own account');
  }

  await assertCanGrantRoles(c, input.roleIds);

  try {
    // Someone else changes how this account signs in, or switches it back on: its links to ClickHouse users wait
    // for a super admin (ADR 0033 §7.4). Before the change, so it is never stored while a link stays in use.
    if (id !== currentUser.sub) {
      if (input.email !== undefined && input.email.toLowerCase() !== (existingUser.email ?? '').toLowerCase()) {
        await suspendBindingsOf(id, 'An administrator changed the account\'s email.', currentUser.sub);
      } else if (input.isActive === true && existingUser.isActive === false) {
        await suspendBindingsOf(id, 'The account was reactivated.', currentUser.sub);
      }
    }
    const user = await updateUser(id, input);

    // Log user update
    await createAuditLogWithContext(c, AUDIT_ACTIONS.USER_UPDATE, currentUser.sub, {
      resourceType: 'user',
      resourceId: id,
      details: { changes: input },
      ipAddress,
    });

    return c.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      throw AppError.badRequest('Email or username already exists');
    }
    throw error;
  }
});

/**
 * DELETE /rbac/users/:id
 * Delete user
 */
userRoutes.delete('/:id', requirePermission(PERMISSIONS.USERS_DELETE), async (c) => {
  const id = requireParam(c, 'id');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);

  // Check if user exists
  const existingUser = await getUserById(id);
  if (!existingUser) {
    throw AppError.notFound('User not found');
  }

  // Prevent deleting yourself
  if (id === currentUser.sub) {
    throw AppError.badRequest('Cannot delete your own account');
  }

  // Prevent deleting super admin unless you're also super admin
  if (existingUser.roles.includes('super_admin') && !isSuperAdmin(c)) {
    throw AppError.forbidden('Cannot delete super administrator');
  }
  await assertMayActOnMappedHolder(c, id);

  try {
    await deleteUser(id);

    // Log user deletion
    await createAuditLogWithContext(c, AUDIT_ACTIONS.USER_DELETE, currentUser.sub, {
      resourceType: 'user',
      resourceId: id,
      details: { email: existingUser.email, username: existingUser.username },
      ipAddress,
    });

    return c.json({
      success: true,
      data: { message: 'User deleted successfully' },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot delete system user')) {
      throw AppError.badRequest(error.message);
    }
    throw error;
  }
});

/**
 * POST /rbac/users/:id/reset-password
 * Reset user password (admin action)
 */
userRoutes.post('/:id/reset-password', requirePermission(PERMISSIONS.USERS_UPDATE), zValidator('json', ResetPasswordSchema), async (c) => {
  const id = requireParam(c, 'id');
  const input = c.req.valid('json');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);

  // Check if user exists
  const existingUser = await getUserById(id);
  if (!existingUser) {
    throw AppError.notFound('User not found');
  }

  // Prevent resetting super admin password unless you're also super admin
  if (existingUser.roles.includes('super_admin') && !isSuperAdmin(c)) {
    throw AppError.forbidden('Cannot reset super administrator password');
  }
  await assertMayActOnMappedHolder(c, id);

  // Handle password
  let newPassword = input.newPassword;
  let generatedPassword: string | undefined;

  if (input.generatePassword || !newPassword) {
    generatedPassword = generateSecurePassword(16);
    newPassword = generatedPassword;
  } else {
    // Validate password strength
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      throw AppError.badRequest('Password does not meet requirements', {
        errors: strength.errors,
      });
    }
  }

  // First, so a password is never changed while a link stays in use.
  if (id !== currentUser.sub) await suspendBindingsOf(id, 'An administrator reset the account\'s password.', currentUser.sub);
  await updateUserPassword(id, newPassword);

  // Log password reset
  await createAuditLogWithContext(c, AUDIT_ACTIONS.PASSWORD_CHANGE, currentUser.sub, {
    resourceType: 'user',
    resourceId: id,
    details: { adminReset: true },
    ipAddress,
  });

  return c.json({
    success: true,
    data: {
      message: 'Password reset successfully',
      generatedPassword, // Only included if password was generated
    },
  });
});

/**
 * POST /rbac/users/:id/assign-roles
 * Assign roles to user
 */
userRoutes.post('/:id/assign-roles', requirePermission(PERMISSIONS.ROLES_ASSIGN), zValidator('json', z.object({
  roleIds: z.array(z.string()).length(1, 'Exactly one role must be assigned'),
})), async (c) => {
  const id = requireParam(c, 'id');
  const { roleIds } = c.req.valid('json');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);

  // Check if user exists
  const existingUser = await getUserById(id);
  if (!existingUser) {
    throw AppError.notFound('User not found');
  }

  // Prevent modifying super admin roles unless you're also super admin
  if (existingUser.roles.includes('super_admin') && !isSuperAdmin(c)) {
    throw AppError.forbidden('Cannot modify super administrator roles');
  }
  await assertMayActOnMappedHolder(c, id);

  await assertCanGrantRoles(c, roleIds);

  const user = await updateUser(id, { roleIds });

  // Log role assignment
  await createAuditLogWithContext(c, AUDIT_ACTIONS.USER_ROLE_ASSIGN, currentUser.sub, {
    resourceType: 'user',
    resourceId: id,
    details: { roleIds },
    ipAddress,
  });

  return c.json({
    success: true,
    data: { user },
  });
});

/**
 * GET /rbac/users/:id/identities
 * List a user's linked SSO identities (provider, link/last-login metadata).
 * Secrets are never returned. displayName is resolved from the live SSO
 * config and falls back to the raw provider id if that provider was removed.
 */
userRoutes.get('/:id/identities', requirePermission(PERMISSIONS.USERS_VIEW), async (c) => {
  const id = requireParam(c, 'id');

  const existingUser = await getUserById(id);
  if (!existingUser) {
    throw AppError.notFound('User not found');
  }

  const config = getSsoConfig();
  const identities = await listUserIdentities(id);

  return c.json({
    success: true,
    data: {
      identities: identities.map((identity) => ({
        id: identity.id,
        provider: identity.provider,
        displayName: config.providers.get(identity.provider)?.displayName ?? identity.provider,
        email: identity.email,
        createdAt: identity.createdAt,
        lastLoginAt: identity.lastLoginAt,
      })),
    },
  });
});

/**
 * DELETE /rbac/users/:id/identities/:identityId
 * Unlink an SSO identity from a user. After unlinking, an SSO-only user has
 * no usable password and must have their password reset to sign in again.
 */
userRoutes.delete('/:id/identities/:identityId', requirePermission(PERMISSIONS.USERS_UPDATE), async (c) => {
  const id = requireParam(c, 'id');
  const identityId = requireParam(c, 'identityId');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);

  const existingUser = await getUserById(id);
  if (!existingUser) {
    throw AppError.notFound('User not found');
  }

  // Prevent modifying super admin unless you're also super admin.
  if (existingUser.roles.includes('super_admin') && !isSuperAdmin(c)) {
    throw AppError.forbidden('Cannot modify super administrator');
  }
  await assertMayActOnMappedHolder(c, id);

  // Ensure the identity belongs to this user before deleting it.
  const identities = await listUserIdentities(id);
  const target = identities.find((identity) => identity.id === identityId);
  if (!target) {
    throw AppError.notFound('SSO identity not found for this user');
  }

  await deleteUserIdentity(identityId);
  await suspendBindingsOf(id, 'A sign-in identity was removed from the account.', currentUser.sub);

  await createAuditLogWithContext(c, AUDIT_ACTIONS.SSO_IDENTITY_UNLINK, currentUser.sub, {
    resourceType: 'user',
    resourceId: id,
    details: { provider: target.provider, identityId },
    ipAddress,
  });

  return c.json({
    success: true,
    data: { message: 'SSO identity unlinked successfully' },
  });
});

export default userRoutes;
