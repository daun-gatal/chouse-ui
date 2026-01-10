/**
 * RBAC Database Seeding
 * 
 * Seeds the database with default roles, permissions, and a super admin user.
 */

import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { getDatabase, getSchema } from '../db';
import { hashPassword } from './password';

// Type helper to avoid TypeScript union type issues with RbacDb
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;
import {
  SYSTEM_ROLES,
  PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_HIERARCHY,
  type SystemRole,
} from '../schema/base';

// ============================================
// Permission Categories
// ============================================

const PERMISSION_CATEGORIES: Record<string, string[]> = {
  'User Management': [
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_UPDATE,
    PERMISSIONS.USERS_DELETE,
  ],
  'Role Management': [
    PERMISSIONS.ROLES_VIEW,
    PERMISSIONS.ROLES_CREATE,
    PERMISSIONS.ROLES_UPDATE,
    PERMISSIONS.ROLES_DELETE,
    PERMISSIONS.ROLES_ASSIGN,
  ],
  'ClickHouse Users': [
    PERMISSIONS.CH_USERS_VIEW,
    PERMISSIONS.CH_USERS_CREATE,
    PERMISSIONS.CH_USERS_UPDATE,
    PERMISSIONS.CH_USERS_DELETE,
  ],
  'Database Operations': [
    PERMISSIONS.DB_VIEW,
    PERMISSIONS.DB_CREATE,
    PERMISSIONS.DB_DROP,
  ],
  'Table Operations': [
    PERMISSIONS.TABLE_VIEW,
    PERMISSIONS.TABLE_CREATE,
    PERMISSIONS.TABLE_ALTER,
    PERMISSIONS.TABLE_DROP,
    PERMISSIONS.TABLE_SELECT,
    PERMISSIONS.TABLE_INSERT,
    PERMISSIONS.TABLE_UPDATE,
    PERMISSIONS.TABLE_DELETE,
  ],
  'Query Operations': [
    PERMISSIONS.QUERY_EXECUTE,
    PERMISSIONS.QUERY_EXECUTE_DDL,
    PERMISSIONS.QUERY_EXECUTE_DML,
    PERMISSIONS.QUERY_HISTORY_VIEW,
    PERMISSIONS.QUERY_HISTORY_VIEW_ALL,
  ],
  'Saved Queries': [
    PERMISSIONS.SAVED_QUERIES_VIEW,
    PERMISSIONS.SAVED_QUERIES_CREATE,
    PERMISSIONS.SAVED_QUERIES_UPDATE,
    PERMISSIONS.SAVED_QUERIES_DELETE,
    PERMISSIONS.SAVED_QUERIES_SHARE,
  ],
  'Metrics & Monitoring': [
    PERMISSIONS.METRICS_VIEW,
    PERMISSIONS.METRICS_VIEW_ADVANCED,
  ],
  'Settings': [
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SETTINGS_UPDATE,
  ],
  'Audit': [
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.AUDIT_EXPORT,
  ],
};

// Human-readable permission names
const PERMISSION_DISPLAY_NAMES: Record<string, string> = {
  [PERMISSIONS.USERS_VIEW]: 'View Users',
  [PERMISSIONS.USERS_CREATE]: 'Create Users',
  [PERMISSIONS.USERS_UPDATE]: 'Update Users',
  [PERMISSIONS.USERS_DELETE]: 'Delete Users',
  [PERMISSIONS.ROLES_VIEW]: 'View Roles',
  [PERMISSIONS.ROLES_CREATE]: 'Create Roles',
  [PERMISSIONS.ROLES_UPDATE]: 'Update Roles',
  [PERMISSIONS.ROLES_DELETE]: 'Delete Roles',
  [PERMISSIONS.ROLES_ASSIGN]: 'Assign Roles',
  [PERMISSIONS.CH_USERS_VIEW]: 'View ClickHouse Users',
  [PERMISSIONS.CH_USERS_CREATE]: 'Create ClickHouse Users',
  [PERMISSIONS.CH_USERS_UPDATE]: 'Update ClickHouse Users',
  [PERMISSIONS.CH_USERS_DELETE]: 'Delete ClickHouse Users',
  [PERMISSIONS.DB_VIEW]: 'View Databases',
  [PERMISSIONS.DB_CREATE]: 'Create Databases',
  [PERMISSIONS.DB_DROP]: 'Drop Databases',
  [PERMISSIONS.TABLE_VIEW]: 'View Tables',
  [PERMISSIONS.TABLE_CREATE]: 'Create Tables',
  [PERMISSIONS.TABLE_ALTER]: 'Alter Tables',
  [PERMISSIONS.TABLE_DROP]: 'Drop Tables',
  [PERMISSIONS.TABLE_SELECT]: 'Select from Tables',
  [PERMISSIONS.TABLE_INSERT]: 'Insert into Tables',
  [PERMISSIONS.TABLE_UPDATE]: 'Update Tables',
  [PERMISSIONS.TABLE_DELETE]: 'Delete from Tables',
  [PERMISSIONS.QUERY_EXECUTE]: 'Execute Queries',
  [PERMISSIONS.QUERY_EXECUTE_DDL]: 'Execute DDL Queries',
  [PERMISSIONS.QUERY_EXECUTE_DML]: 'Execute DML Queries',
  [PERMISSIONS.QUERY_HISTORY_VIEW]: 'View Own Query History',
  [PERMISSIONS.QUERY_HISTORY_VIEW_ALL]: 'View All Query History',
  [PERMISSIONS.SAVED_QUERIES_VIEW]: 'View Saved Queries',
  [PERMISSIONS.SAVED_QUERIES_CREATE]: 'Create Saved Queries',
  [PERMISSIONS.SAVED_QUERIES_UPDATE]: 'Update Saved Queries',
  [PERMISSIONS.SAVED_QUERIES_DELETE]: 'Delete Saved Queries',
  [PERMISSIONS.SAVED_QUERIES_SHARE]: 'Share Saved Queries',
  [PERMISSIONS.METRICS_VIEW]: 'View Metrics',
  [PERMISSIONS.METRICS_VIEW_ADVANCED]: 'View Advanced Metrics',
  [PERMISSIONS.SETTINGS_VIEW]: 'View Settings',
  [PERMISSIONS.SETTINGS_UPDATE]: 'Update Settings',
  [PERMISSIONS.AUDIT_VIEW]: 'View Audit Logs',
  [PERMISSIONS.AUDIT_EXPORT]: 'Export Audit Logs',
};

// Role display names and descriptions
const ROLE_DEFINITIONS: Record<SystemRole, { displayName: string; description: string }> = {
  [SYSTEM_ROLES.SUPER_ADMIN]: {
    displayName: 'Super Administrator',
    description: 'Full system access with all permissions',
  },
  [SYSTEM_ROLES.ADMIN]: {
    displayName: 'Administrator',
    description: 'User management and full ClickHouse access',
  },
  [SYSTEM_ROLES.DEVELOPER]: {
    displayName: 'Developer',
    description: 'DDL and DML access for development',
  },
  [SYSTEM_ROLES.ANALYST]: {
    displayName: 'Analyst',
    description: 'Read/write access for data analysis',
  },
  [SYSTEM_ROLES.VIEWER]: {
    displayName: 'Viewer',
    description: 'Read-only access to data',
  },
  [SYSTEM_ROLES.GUEST]: {
    displayName: 'Guest',
    description: 'Read-only access to all tabs and data',
  },
};

// ============================================
// Seeding Functions
// ============================================

/**
 * Seed all permissions
 */
export async function seedPermissions(): Promise<Map<string, string>> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const permissionIdMap = new Map<string, string>();

  console.log('[RBAC] Seeding permissions...');

  for (const [category, perms] of Object.entries(PERMISSION_CATEGORIES)) {
    for (const permName of perms) {
      const id = randomUUID();
      const displayName = PERMISSION_DISPLAY_NAMES[permName] || permName;

      // Check if permission already exists
      // @ts-ignore - Union type issue with RbacDb, resolved at runtime
      const existing = await db.select()
        .from(schema.permissions)
        .where(eq(schema.permissions.name, permName))
        .limit(1);

      if (existing.length === 0) {
        // @ts-ignore - Union type issue with RbacDb, resolved at runtime
        await db.insert(schema.permissions).values({
          id,
          name: permName,
          displayName,
          description: `Permission to ${displayName.toLowerCase()}`,
          category,
          isSystem: true,
          createdAt: new Date(),
        });
        permissionIdMap.set(permName, id);
      } else {
        permissionIdMap.set(permName, existing[0].id);
      }
    }
  }

  console.log(`[RBAC] Seeded ${permissionIdMap.size} permissions`);
  return permissionIdMap;
}

/**
 * Seed system roles with their permissions
 */
export async function seedRoles(permissionIdMap: Map<string, string>): Promise<Map<string, string>> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const roleIdMap = new Map<string, string>();

  console.log('[RBAC] Seeding roles...');

  for (const roleName of Object.values(SYSTEM_ROLES)) {
    const id = randomUUID();
    const def = ROLE_DEFINITIONS[roleName];
    const priority = ROLE_HIERARCHY[roleName];

    // Check if role already exists
    // @ts-ignore - Union type issue with RbacDb, resolved at runtime
    const existing = await db.select()
      .from(schema.roles)
      .where(eq(schema.roles.name, roleName))
      .limit(1);

    if (existing.length === 0) {
      // @ts-ignore - Union type issue with RbacDb, resolved at runtime
      await db.insert(schema.roles).values({
        id,
        name: roleName,
        displayName: def.displayName,
        description: def.description,
        isSystem: true,
        isDefault: roleName === SYSTEM_ROLES.VIEWER, // Viewer is the default role
        priority,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      roleIdMap.set(roleName, id);

      // Assign permissions to role
      const rolePerms = DEFAULT_ROLE_PERMISSIONS[roleName];
      for (const permName of rolePerms) {
        const permId = permissionIdMap.get(permName);
        if (permId) {
          // @ts-ignore - Union type issue with RbacDb, resolved at runtime
          await db.insert(schema.rolePermissions).values({
            id: randomUUID(),
            roleId: id,
            permissionId: permId,
            createdAt: new Date(),
          });
        }
      }
    } else {
      roleIdMap.set(roleName, existing[0].id);
    }
  }

  console.log(`[RBAC] Seeded ${roleIdMap.size} roles`);
  return roleIdMap;
}

/**
 * Create default super admin user
 */
export async function seedSuperAdmin(roleIdMap: Map<string, string>): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const adminEmail = process.env.RBAC_ADMIN_EMAIL || 'admin@localhost';
  const adminUsername = process.env.RBAC_ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.RBAC_ADMIN_PASSWORD || 'admin123!';

  console.log('[RBAC] Checking for super admin user...');

  // Check if super admin already exists
  // @ts-ignore - Union type issue with RbacDb, resolved at runtime
  const existing = await db.select()
    .from(schema.users)
    .where(eq(schema.users.email, adminEmail))
    .limit(1);

  if (existing.length === 0) {
    const userId = randomUUID();
    const passwordHash = await hashPassword(adminPassword);

    // @ts-ignore - Union type issue with RbacDb, resolved at runtime
    await db.insert(schema.users).values({
      id: userId,
      email: adminEmail,
      username: adminUsername,
      passwordHash,
      displayName: 'System Administrator',
      isActive: true,
      isSystemUser: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Assign super admin role
    const superAdminRoleId = roleIdMap.get(SYSTEM_ROLES.SUPER_ADMIN);
    if (superAdminRoleId) {
      // @ts-ignore - Union type issue with RbacDb, resolved at runtime
      await db.insert(schema.userRoles).values({
        id: randomUUID(),
        userId,
        roleId: superAdminRoleId,
        assignedAt: new Date(),
      });
    }

    console.log(`[RBAC] Created super admin user: ${adminEmail}`);
    
    if (adminPassword === 'admin123!') {
      console.log('[RBAC] ⚠️  WARNING: Using default admin password. Please change it immediately!');
      console.log('[RBAC] Set RBAC_ADMIN_PASSWORD environment variable for production.');
    }
  } else {
    console.log('[RBAC] Super admin user already exists');
  }
}

/**
 * Run full database seeding
 */
export async function seedDatabase(): Promise<void> {
  console.log('[RBAC] Starting database seeding...');
  
  try {
    const permissionIdMap = await seedPermissions();
    const roleIdMap = await seedRoles(permissionIdMap);
    await seedSuperAdmin(roleIdMap);
    
    console.log('[RBAC] Database seeding completed successfully');
  } catch (error) {
    console.error('[RBAC] Database seeding failed:', error);
    throw error;
  }
}

/**
 * Check if database needs seeding
 */
export async function needsSeeding(): Promise<boolean> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  try {
    // @ts-ignore - Union type issue with RbacDb, resolved at runtime
    const roles = await db.select()
      .from(schema.roles)
      .limit(1);
    
    return roles.length === 0;
  } catch {
    // Table might not exist yet
    return true;
  }
}
