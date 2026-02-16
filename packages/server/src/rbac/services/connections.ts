/**
 * ClickHouse Connections Service
 * 
 * Manages ClickHouse server connections with encrypted password storage.
 */

import { eq, and, desc, asc, like, or, sql, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import { getDatabase, getSchema } from '../db';
import { type ClickHouseClient } from '@clickhouse/client';
import { ClientManager } from '../../services/clientManager';

// Type helper for working with dual database setup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

import type { User, ClickHouseConnection, DataAccessRule, UserRole } from '../schema';

// ============================================
// Types
// ============================================

export interface ConnectionInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  database?: string | null;
  sslEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ConnectionResponse {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  database: string | null;
  isDefault: boolean;
  isActive: boolean;
  sslEnabled: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown> | null;
}

export interface ConnectionWithPassword extends ConnectionResponse {
  password: string | null;
}

export interface TestConnectionResult {
  success: boolean;
  version?: string;
  databases?: string[];
  error?: string;
  latencyMs?: number;
}

// ============================================
// Encryption Utilities
// ============================================

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000; // OWASP recommended minimum
const KEY_LENGTH = 32; // 256 bits for AES-256

/**
 * Get encryption key using PBKDF2 with proper key derivation
 * In production, requires RBAC_ENCRYPTION_KEY to be set
 */
function getEncryptionKey(): Buffer {
  const NODE_ENV = process.env.NODE_ENV || 'development';

  // In production, require explicit encryption key
  if (NODE_ENV === 'production') {
    const encryptionKey = process.env.RBAC_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error(
        'RBAC_ENCRYPTION_KEY must be set in production. ' +
        'Generate a secure 32-byte (64 hex characters) key and set it as an environment variable.'
      );
    }
    if (encryptionKey.length < 32) {
      throw new Error(
        'RBAC_ENCRYPTION_KEY must be at least 32 characters long. ' +
        'For AES-256, use a 32-byte (64 hex characters) key.'
      );
    }
  }

  // Get secret - prefer RBAC_ENCRYPTION_KEY, fallback to JWT_SECRET, then default (dev only)
  const secret = process.env.RBAC_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    (NODE_ENV === 'production' ? '' : 'chouseui-dev-key-do-not-use-in-production');

  if (!secret) {
    throw new Error('Encryption key not configured. Set RBAC_ENCRYPTION_KEY or JWT_SECRET environment variable.');
  }

  // Use environment variable salt or generate a deterministic one from secret
  // Note: For production, use a fixed salt stored in env var for consistency
  // For development, derive from secret (less secure but acceptable)
  const saltEnv = process.env.RBAC_ENCRYPTION_SALT;
  let salt: string;

  if (saltEnv) {
    salt = saltEnv;
  } else if (NODE_ENV === 'production') {
    throw new Error(
      'RBAC_ENCRYPTION_SALT must be set in production. ' +
      'Use a unique, random 32-byte (64 hex characters) salt value.'
    );
  } else {
    // Development: derive salt from secret (not ideal but acceptable for dev)
    // This ensures same secret always produces same key in dev
    const crypto = require('crypto');
    salt = crypto.createHash('sha256').update(secret).digest('hex').substring(0, 64);
  }

  // Use PBKDF2 with SHA-256 for key derivation (more secure than scrypt for this use case)
  return pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

export function encryptPassword(password: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(password, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decryptPassword(encryptedData: string): string {
  try {
    const key = getEncryptionKey();
    const parts = encryptedData.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format. Expected format: iv:authTag:encrypted');
    }

    const [ivHex, authTagHex, encrypted] = parts;

    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error('Invalid encrypted data: missing components');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    if (iv.length !== IV_LENGTH) {
      throw new Error(`Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.length}`);
    }

    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH} bytes, got ${authTag.length}`);
    }

    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // Re-throw with more context instead of silently failing
    const errorMessage = error instanceof Error ? error.message : 'Unknown decryption error';
    throw new Error(`Failed to decrypt password: ${errorMessage}`);
  }
}

// ============================================
// Connection Management
// ============================================

/**
 * Create a new ClickHouse connection
 */
export async function createConnection(
  input: ConnectionInput,
  createdBy?: string
): Promise<ConnectionResponse> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const id = randomUUID();
  const now = new Date();

  // Encrypt password if provided
  const passwordEncrypted = input.password ? encryptPassword(input.password) : null;

  await db.insert(schema.clickhouseConnections).values({
    id,
    name: input.name,
    host: input.host,
    port: input.port || 8123,
    username: input.username,
    passwordEncrypted,
    database: input.database || null,
    isDefault: false,
    isActive: true,
    sslEnabled: input.sslEnabled || false,
    createdBy,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata || null,
  });

  return getConnectionById(id) as Promise<ConnectionResponse>;
}

/**
 * Get connection by ID
 */
export async function getConnectionById(id: string): Promise<ConnectionResponse | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const results = await db.select()
    .from(schema.clickhouseConnections)
    .where(eq(schema.clickhouseConnections.id, id))
    .limit(1);

  if (results.length === 0) return null;

  const conn = results[0];
  return {
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    database: conn.database,
    isDefault: conn.isDefault,
    isActive: conn.isActive,
    sslEnabled: conn.sslEnabled,
    createdBy: conn.createdBy,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    metadata: conn.metadata,
  };
}

/**
 * Get connection with decrypted password (for internal use)
 */
export async function getConnectionWithPassword(id: string): Promise<ConnectionWithPassword | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const results = await db.select()
    .from(schema.clickhouseConnections)
    .where(eq(schema.clickhouseConnections.id, id))
    .limit(1);

  if (results.length === 0) return null;

  const conn = results[0];
  let password: string | null = null;

  if (conn.passwordEncrypted) {
    try {
      password = decryptPassword(conn.passwordEncrypted);
    } catch (error) {
      // Log the error but throw it to prevent silent failures
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to decrypt password for connection ${id}:`, errorMessage);
      throw new Error(`Failed to decrypt password for connection ${id}: ${errorMessage}`);
    }
  }

  return {
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password,
    database: conn.database,
    isDefault: conn.isDefault,
    isActive: conn.isActive,
    sslEnabled: conn.sslEnabled,
    createdBy: conn.createdBy,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    metadata: conn.metadata,
  };
}

/**
 * List all connections
 */
export async function listConnections(options?: {
  activeOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ connections: ConnectionResponse[]; total: number }> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const conditions = [];

  if (options?.activeOnly) {
    conditions.push(eq(schema.clickhouseConnections.isActive, true));
  }

  if (options?.search) {
    conditions.push(
      or(
        like(schema.clickhouseConnections.name, `%${options.search}%`),
        like(schema.clickhouseConnections.host, `%${options.search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await db.select({ count: sql<number>`count(*)` })
    .from(schema.clickhouseConnections)
    .where(whereClause);

  const total = Number(countResult[0]?.count || 0);

  // Get connections
  let query = db.select()
    .from(schema.clickhouseConnections)
    .where(whereClause)
    .orderBy(desc(schema.clickhouseConnections.isDefault), asc(schema.clickhouseConnections.name));

  if (options?.limit) {
    query = query.limit(options.limit) as typeof query;
  }
  if (options?.offset) {
    query = query.offset(options.offset) as typeof query;
  }

  const results = await query;

  const connections: ConnectionResponse[] = results.map((conn: ClickHouseConnection) => ({
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    database: conn.database,
    isDefault: conn.isDefault ?? false,
    isActive: conn.isActive ?? true,
    sslEnabled: conn.sslEnabled ?? false,
    createdBy: conn.createdBy,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    metadata: conn.metadata,
  }));

  return { connections, total };
}

/**
 * Update a connection
 */
export async function updateConnection(
  id: string,
  input: Partial<ConnectionInput> & { isDefault?: boolean; isActive?: boolean }
): Promise<ConnectionResponse | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const now = new Date();

  const existing = await getConnectionById(id);
  if (!existing) return null;

  const updateData: Record<string, unknown> = {
    updatedAt: now,
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.host !== undefined) updateData.host = input.host;
  if (input.port !== undefined) updateData.port = input.port;
  if (input.username !== undefined) updateData.username = input.username;
  if (input.database !== undefined) updateData.database = input.database;
  if (input.sslEnabled !== undefined) updateData.sslEnabled = input.sslEnabled;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;
  if (input.metadata !== undefined) updateData.metadata = input.metadata;

  // Handle password update
  if (input.password !== undefined) {
    updateData.passwordEncrypted = input.password ? encryptPassword(input.password) : null;
  }

  // Handle default flag
  if (input.isDefault === true) {
    // Remove default from all other connections first
    await db.update(schema.clickhouseConnections)
      .set({ isDefault: false, updatedAt: now })
      .where(eq(schema.clickhouseConnections.isDefault, true));

    updateData.isDefault = true;
  } else if (input.isDefault === false) {
    updateData.isDefault = false;
  }

  await db.update(schema.clickhouseConnections)
    .set(updateData)
    .where(eq(schema.clickhouseConnections.id, id));

  return getConnectionById(id);
}

/**
 * Delete a connection
 */
export async function deleteConnection(id: string): Promise<boolean> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const existing = await getConnectionById(id);
  if (!existing) return false;

  await db.delete(schema.clickhouseConnections)
    .where(eq(schema.clickhouseConnections.id, id));

  return true;
}

/**
 * Get the default connection
 */
export async function getDefaultConnection(): Promise<ConnectionResponse | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const results = await db.select()
    .from(schema.clickhouseConnections)
    .where(and(
      eq(schema.clickhouseConnections.isDefault, true),
      eq(schema.clickhouseConnections.isActive, true)
    ))
    .limit(1);

  if (results.length === 0) {
    // Fall back to any active connection
    const fallback = await db.select()
      .from(schema.clickhouseConnections)
      .where(eq(schema.clickhouseConnections.isActive, true))
      .orderBy(asc(schema.clickhouseConnections.createdAt))
      .limit(1);

    if (fallback.length === 0) return null;

    const conn = fallback[0];
    return {
      id: conn.id,
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      database: conn.database,
      isDefault: conn.isDefault,
      isActive: conn.isActive,
      sslEnabled: conn.sslEnabled,
      createdBy: conn.createdBy,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
      metadata: conn.metadata,
    };
  }

  const conn = results[0];
  return {
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    database: conn.database,
    isDefault: conn.isDefault,
    isActive: conn.isActive,
    sslEnabled: conn.sslEnabled,
    createdBy: conn.createdBy,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    metadata: conn.metadata,
  };
}

// ============================================
// Connection Testing
// ============================================

/**
 * Test a connection (without saving)
 */
export async function testConnection(input: ConnectionInput): Promise<TestConnectionResult> {
  const startTime = Date.now();
  let client: ClickHouseClient | null = null;

  try {
    const protocol = input.sslEnabled ? 'https' : 'http';
    const url = `${protocol}://${input.host}:${input.port || 8123}`;

    client = ClientManager.getInstance().getClient({
      url,
      username: input.username,
      password: input.password || '',
      database: input.database || 'default',
    });

    // Test query
    const versionResult = await client.query({
      query: 'SELECT version() as version',
      format: 'JSONEachRow',
    });
    const versionData = await versionResult.json() as { version: string }[];
    const version = versionData[0]?.version;

    // Get database list
    const dbResult = await client.query({
      query: 'SHOW DATABASES',
      format: 'JSONEachRow',
    });
    const dbData = await dbResult.json() as { name: string }[];
    const databases = dbData.map((d: { name: string }) => d.name);

    const latencyMs = Date.now() - startTime;

    return {
      success: true,
      version,
      databases,
      latencyMs,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
      latencyMs: Date.now() - startTime,
    };
  }
}

/**
 * Test an existing saved connection
 */
export async function testSavedConnection(id: string): Promise<TestConnectionResult> {
  const conn = await getConnectionWithPassword(id);
  if (!conn) {
    return {
      success: false,
      error: 'Connection not found',
    };
  }

  return testConnection({
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: conn.password || undefined,
    database: conn.database || undefined,
    sslEnabled: conn.sslEnabled,
  });
}

// ============================================
// User Connection Access
// ============================================

/**
 * Grant user access to a connection
 */
export async function grantConnectionAccess(
  userId: string,
  connectionId: string
): Promise<boolean> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  // Check if already exists
  const existing = await db.select()
    .from(schema.userConnections)
    .where(and(
      eq(schema.userConnections.userId, userId),
      eq(schema.userConnections.connectionId, connectionId)
    ))
    .limit(1);

  if (existing.length > 0) {
    // Update to enable access
    await db.update(schema.userConnections)
      .set({ canUse: true })
      .where(eq(schema.userConnections.id, existing[0].id));
    return true;
  }

  // Create new access record
  await db.insert(schema.userConnections).values({
    id: randomUUID(),
    userId,
    connectionId,
    canUse: true,
    createdAt: new Date(),
  });

  return true;
}

/**
 * Revoke user access to a connection
 */
export async function revokeConnectionAccess(
  userId: string,
  connectionId: string
): Promise<boolean> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  await db.delete(schema.userConnections)
    .where(and(
      eq(schema.userConnections.userId, userId),
      eq(schema.userConnections.connectionId, connectionId)
    ));

  return true;
}

/**
 * Get users with access to a connection
 */
export async function getConnectionUsers(connectionId: string): Promise<Array<{
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  isActive: boolean;
  roles: string[];
  hasDirectAccess: boolean;
  accessViaRoles: string[];
}>> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  // Get users with direct access (userConnections table)
  const userConnections = await db.select({
    userId: schema.userConnections.userId,
  })
    .from(schema.userConnections)
    .where(and(
      eq(schema.userConnections.connectionId, connectionId),
      eq(schema.userConnections.canUse, true)
    ));

  const directAccessUserIds = new Set(userConnections.map((uc: { userId: string }) => uc.userId));

  // Get all users who have direct access
  const directAccessUsers = directAccessUserIds.size > 0
    ? await db.select()
      .from(schema.users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .where(inArray(schema.users.id as any, Array.from(directAccessUserIds)))
    : [];

  // Get users who have access via data access rules (user-specific or role-based)
  const dataAccessRules = await db.select()
    .from(schema.dataAccessRules)
    .where(eq(schema.dataAccessRules.connectionId, connectionId));

  const userIdsFromRules = new Set<string>();
  const roleIdsFromRules = new Set<string>();

  dataAccessRules.forEach((rule: DataAccessRule) => {
    if (rule.userId) {
      userIdsFromRules.add(rule.userId);
    }
    if (rule.roleId) {
      roleIdsFromRules.add(rule.roleId);
    }
  });

  // Get users from role-based rules
  const usersFromRoles: User[] = [];
  if (roleIdsFromRules.size > 0) {
    const userRoles = await db.select()
      .from(schema.userRoles)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .where(inArray(schema.userRoles.roleId as any, Array.from(roleIdsFromRules)));

    const userIdsFromRoles = new Set(userRoles.map((ur: UserRole) => ur.userId));

    if (userIdsFromRoles.size > 0) {
      const users = await db.select()
        .from(schema.users)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where(inArray(schema.users.id as any, Array.from(userIdsFromRoles)));
      usersFromRoles.push(...users);
    }
  }

  // Get users from user-specific rules
  const usersFromRules: User[] = [];
  if (userIdsFromRules.size > 0) {
    const users = await db.select()
      .from(schema.users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .where(inArray(schema.users.id as any, Array.from(userIdsFromRules)));
    usersFromRules.push(...users);
  }

  // Combine all users and deduplicate
  const allUserIds = new Set<string>();
  const userMap = new Map<string, User>();

  [...directAccessUsers, ...usersFromRules, ...usersFromRoles].forEach((user: User) => {
    if (!allUserIds.has(user.id)) {
      allUserIds.add(user.id);
      userMap.set(user.id, user);
    }
  });

  // Build response with access information
  const result: Array<{
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    isActive: boolean;
    roles: string[];
    hasDirectAccess: boolean;
    accessViaRoles: string[];
  }> = [];

  for (const user of userMap.values()) {
    const hasDirectAccess = directAccessUserIds.has(user.id);

    // Get user's roles
    const userRoles = await db.select({
      roleId: schema.userRoles.roleId,
      roleName: schema.roles.name,
    })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(eq(schema.userRoles.userId, user.id));

    const roleNames = userRoles.map((ur: { roleName: string; roleId: string }) => ur.roleName);

    // Determine which roles grant access via data access rules
    const accessViaRoles = userRoles
      .filter((ur: { roleName: string; roleId: string }) => roleIdsFromRules.has(ur.roleId))
      .map((ur: { roleName: string; roleId: string }) => ur.roleName);

    result.push({
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      isActive: user.isActive,
      roles: roleNames,
      hasDirectAccess,
      accessViaRoles,
    });
  }

  return result;
}

/**
 * Get connections accessible by a user
 * Considers both userConnections table AND data access rules with specific connectionIds
 */
export async function getUserConnections(userId: string): Promise<ConnectionResponse[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  // Collect connection IDs from multiple sources
  const connectionIdSet = new Set<string>();

  // IMPORTANT: Connection access is ONLY controlled by the userConnections table.
  // Data access rules control which databases/tables a user can access WITHIN a connection,
  // but they do NOT grant access to the connection itself.
  // 
  // This separation ensures that:
  // 1. Admins explicitly grant connection access via the "Manage Access" feature
  // 2. Data access rules only apply to databases/tables within already-granted connections

  // Get user's direct connection access (userConnections table)
  const userConns = await db.select()
    .from(schema.userConnections)
    .where(and(
      eq(schema.userConnections.userId, userId),
      eq(schema.userConnections.canUse, true)
    ));

  console.log(`[getUserConnections] User ${userId} has ${userConns.length} direct connection access(es)`);

  if (userConns.length === 0) {
    console.log(`[getUserConnections] User ${userId} has NO connection access - returning empty array`);
    return [];
  }

  // User has explicit connection access - return only those connections
  userConns.forEach((uc: any) => {
    connectionIdSet.add(uc.connectionId);
    console.log(`[getUserConnections] Direct access to connection: ${uc.connectionId}`);
  });

  // Get the filtered connections
  const connectionIds = Array.from(connectionIdSet);

  const connections = await db.select()
    .from(schema.clickhouseConnections)
    .where(and(
      inArray(schema.clickhouseConnections.id, connectionIds),
      eq(schema.clickhouseConnections.isActive, true)
    ))
    .orderBy(desc(schema.clickhouseConnections.isDefault), asc(schema.clickhouseConnections.name));

  return connections.map((conn: any) => ({
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    database: conn.database,
    isDefault: conn.isDefault,
    isActive: conn.isActive,
    sslEnabled: conn.sslEnabled,
    createdBy: conn.createdBy,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    metadata: conn.metadata,
  }));
}

