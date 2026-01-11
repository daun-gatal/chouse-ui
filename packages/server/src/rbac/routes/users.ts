/**
 * RBAC User Management Routes
 * 
 * Handles CRUD operations for users.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createUser,
  getUserById,
  updateUser,
  deleteUser,
  listUsers,
  updateUserPassword,
  createAuditLog,
} from '../services/rbac';
import { validatePasswordStrength, generateSecurePassword } from '../services/password';
import { AUDIT_ACTIONS, PERMISSIONS } from '../schema/base';
import {
  rbacAuthMiddleware,
  requirePermission,
  requireAnyPermission,
  getClientIp,
  getRbacUser,
  isSuperAdmin,
} from '../middleware/rbacAuth';
import { AppError } from '../../types';

const userRoutes = new Hono();

// ============================================
// Schemas
// ============================================

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
  const id = c.req.param('id');
  
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
    console.error('[Users] Failed to fetch user:', error);
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
  const userAgent = c.req.header('User-Agent');

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

  try {
    const user = await createUser({
      email: input.email,
      username: input.username,
      password,
      displayName: input.displayName,
      roleIds: input.roleIds,
    }, currentUser.sub);

    // Log user creation
    await createAuditLog(AUDIT_ACTIONS.USER_CREATE, currentUser.sub, {
      resourceType: 'user',
      resourceId: user.id,
      details: { 
        email: user.email, 
        username: user.username,
        roles: user.roles,
      },
      ipAddress,
      userAgent,
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
  const id = c.req.param('id');
  const input = c.req.valid('json');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);
  const userAgent = c.req.header('User-Agent');

  // Check if user exists
  const existingUser = await getUserById(id);
  if (!existingUser) {
    throw AppError.notFound('User not found');
  }

  // Prevent modifying super admin unless you're also super admin
  if (existingUser.roles.includes('super_admin') && !isSuperAdmin(c)) {
    throw AppError.forbidden('Cannot modify super administrator');
  }

  // Prevent deactivating yourself
  if (input.isActive === false && id === currentUser.sub) {
    throw AppError.badRequest('Cannot deactivate your own account');
  }

  try {
    const user = await updateUser(id, input);

    // Log user update
    await createAuditLog(AUDIT_ACTIONS.USER_UPDATE, currentUser.sub, {
      resourceType: 'user',
      resourceId: id,
      details: { changes: input },
      ipAddress,
      userAgent,
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
 * Delete user (soft delete)
 */
userRoutes.delete('/:id', requirePermission(PERMISSIONS.USERS_DELETE), async (c) => {
  const id = c.req.param('id');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);
  const userAgent = c.req.header('User-Agent');

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

  try {
    await deleteUser(id);

    // Log user deletion
    await createAuditLog(AUDIT_ACTIONS.USER_DELETE, currentUser.sub, {
      resourceType: 'user',
      resourceId: id,
      details: { email: existingUser.email, username: existingUser.username },
      ipAddress,
      userAgent,
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
  const id = c.req.param('id');
  const input = c.req.valid('json');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);
  const userAgent = c.req.header('User-Agent');

  // Check if user exists
  const existingUser = await getUserById(id);
  if (!existingUser) {
    throw AppError.notFound('User not found');
  }

  // Prevent resetting super admin password unless you're also super admin
  if (existingUser.roles.includes('super_admin') && !isSuperAdmin(c)) {
    throw AppError.forbidden('Cannot reset super administrator password');
  }

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

  await updateUserPassword(id, newPassword);

  // Log password reset
  await createAuditLog(AUDIT_ACTIONS.PASSWORD_CHANGE, currentUser.sub, {
    resourceType: 'user',
    resourceId: id,
    details: { adminReset: true },
    ipAddress,
    userAgent,
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
  const id = c.req.param('id');
  const { roleIds } = c.req.valid('json');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);
  const userAgent = c.req.header('User-Agent');

  // Check if user exists
  const existingUser = await getUserById(id);
  if (!existingUser) {
    throw AppError.notFound('User not found');
  }

  // Prevent modifying super admin roles unless you're also super admin
  if (existingUser.roles.includes('super_admin') && !isSuperAdmin(c)) {
    throw AppError.forbidden('Cannot modify super administrator roles');
  }

  const user = await updateUser(id, { roleIds });

  // Log role assignment
  await createAuditLog(AUDIT_ACTIONS.USER_ROLE_ASSIGN, currentUser.sub, {
    resourceType: 'user',
    resourceId: id,
    details: { roleIds },
    ipAddress,
    userAgent,
  });

  return c.json({
    success: true,
    data: { user },
  });
});

export default userRoutes;
