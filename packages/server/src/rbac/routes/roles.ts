/**
 * RBAC Role Management Routes
 * 
 * Handles CRUD operations for roles and permissions.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createRole,
  getRoleById,
  updateRole,
  deleteRole,
  listRoles,
  listPermissions,
  getPermissionsByCategory,
  createAuditLog,
} from '../services/rbac';
import { AUDIT_ACTIONS, PERMISSIONS } from '../schema/base';
import {
  requirePermission,
  getClientIp,
  getRbacUser,
  isSuperAdmin,
} from '../middleware/rbacAuth';
import { AppError } from '../../types';

const roleRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const CreateRoleSchema = z.object({
  name: z.string()
    .min(2, 'Role name must be at least 2 characters')
    .max(50)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Role name must start with a letter and contain only letters, numbers, underscores, and hyphens'),
  displayName: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  permissionIds: z.array(z.string()).min(1, 'At least one permission is required'),
  isDefault: z.boolean().optional(),
});

const UpdateRoleSchema = z.object({
  displayName: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  permissionIds: z.array(z.string()).optional(),
  isDefault: z.boolean().optional(),
});

// ============================================
// Routes
// ============================================

/**
 * GET /rbac/roles
 * List all roles
 */
roleRoutes.get('/', requirePermission(PERMISSIONS.ROLES_VIEW), async (c) => {
  const roles = await listRoles();

  return c.json({
    success: true,
    data: { roles },
  });
});

/**
 * GET /rbac/roles/:id
 * Get role by ID
 */
roleRoutes.get('/:id', requirePermission(PERMISSIONS.ROLES_VIEW), async (c) => {
  const id = c.req.param('id');
  const role = await getRoleById(id);

  if (!role) {
    throw AppError.notFound('Role not found');
  }

  return c.json({
    success: true,
    data: { role },
  });
});

/**
 * POST /rbac/roles
 * Create a new role
 */
roleRoutes.post('/', requirePermission(PERMISSIONS.ROLES_CREATE), zValidator('json', CreateRoleSchema), async (c) => {
  const input = c.req.valid('json');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);
  const userAgent = c.req.header('User-Agent');

  try {
    const role = await createRole(input);

    // Log role creation
    await createAuditLog(AUDIT_ACTIONS.ROLE_CREATE, currentUser.sub, {
      resourceType: 'role',
      resourceId: role.id,
      details: { 
        name: role.name,
        displayName: role.displayName,
        permissions: role.permissions,
      },
      ipAddress,
      userAgent,
    });

    return c.json({
      success: true,
      data: { role },
    }, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      throw AppError.badRequest('Role name already exists');
    }
    throw error;
  }
});

/**
 * PATCH /rbac/roles/:id
 * Update role
 */
roleRoutes.patch('/:id', requirePermission(PERMISSIONS.ROLES_UPDATE), zValidator('json', UpdateRoleSchema), async (c) => {
  const id = c.req.param('id');
  const input = c.req.valid('json');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);
  const userAgent = c.req.header('User-Agent');

  // Check if role exists
  const existingRole = await getRoleById(id);
  if (!existingRole) {
    throw AppError.notFound('Role not found');
  }

  // Only super admin can modify system roles
  if (existingRole.isSystem && !isSuperAdmin(c)) {
    throw AppError.forbidden('Cannot modify system role');
  }

  try {
    // Allow system role modification if user is super admin
    const role = await updateRole(id, input, isSuperAdmin(c));

    // Log role update
    await createAuditLog(AUDIT_ACTIONS.ROLE_UPDATE, currentUser.sub, {
      resourceType: 'role',
      resourceId: id,
      details: { changes: input },
      ipAddress,
      userAgent,
    });

    return c.json({
      success: true,
      data: { role },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot modify system role')) {
      throw AppError.badRequest(error.message);
    }
    throw error;
  }
});

/**
 * DELETE /rbac/roles/:id
 * Delete role
 */
roleRoutes.delete('/:id', requirePermission(PERMISSIONS.ROLES_DELETE), async (c) => {
  const id = c.req.param('id');
  const currentUser = getRbacUser(c);
  const ipAddress = getClientIp(c);
  const userAgent = c.req.header('User-Agent');

  // Check if role exists
  const existingRole = await getRoleById(id);
  if (!existingRole) {
    throw AppError.notFound('Role not found');
  }

  // Cannot delete system roles
  if (existingRole.isSystem) {
    throw AppError.forbidden('Cannot delete system role');
  }

  // Check if role has assigned users
  if (existingRole.userCount && existingRole.userCount > 0) {
    throw AppError.badRequest(`Cannot delete role with ${existingRole.userCount} assigned user(s). Reassign users first.`);
  }

  try {
    await deleteRole(id);

    // Log role deletion
    await createAuditLog(AUDIT_ACTIONS.ROLE_DELETE, currentUser.sub, {
      resourceType: 'role',
      resourceId: id,
      details: { name: existingRole.name },
      ipAddress,
      userAgent,
    });

    return c.json({
      success: true,
      data: { message: 'Role deleted successfully' },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot delete system role')) {
      throw AppError.badRequest(error.message);
    }
    throw error;
  }
});

/**
 * GET /rbac/permissions
 * List all permissions
 */
roleRoutes.get('/permissions/list', requirePermission(PERMISSIONS.ROLES_VIEW), async (c) => {
  const permissions = await listPermissions();

  return c.json({
    success: true,
    data: { permissions },
  });
});

/**
 * GET /rbac/permissions/by-category
 * Get permissions grouped by category
 */
roleRoutes.get('/permissions/by-category', requirePermission(PERMISSIONS.ROLES_VIEW), async (c) => {
  const permissionsByCategory = await getPermissionsByCategory();

  return c.json({
    success: true,
    data: { permissionsByCategory },
  });
});

export default roleRoutes;
