/**
 * ClickHouse User Management Service
 * 
 * Manages ClickHouse database users (not RBAC users).
 * Generates and executes DDL statements for user creation, modification, and deletion.
 * Uses metadata table to store user configuration (role, cluster, allowed databases/tables).
 */

import { ClickHouseService } from '../../services/clickhouse';
import { getDatabase, getSchema } from '../db';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { ClickHouseUserMetadata } from '../schema';
import { logger } from '../../utils/logger';

// Type helper for working with dual database setup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ============================================
// Types
// ============================================

export type ClickHouseUserRole = 'developer' | 'analyst' | 'viewer';

export interface ClickHouseUser {
  name: string;
  host_ip?: string;
  host_names?: string;
  default_roles_all?: number;
  default_roles_list?: string;
  default_roles_except?: string;
  auth_type?: string;
  password?: string;
  password_hash?: string;
  password_sha256_hex?: string;
  password_double_sha1_hex?: string;
  grants?: string;
}

export interface CreateClickHouseUserInput {
  username: string;
  password?: string; // Optional when authType is 'no_password'
  role: ClickHouseUserRole;
  allowedDatabases?: string[];
  allowedTables?: Array<{ database: string; table: string }>;
  hostIp?: string;
  hostNames?: string;
  cluster?: string;
  authType?: string; // e.g., 'sha256_password', 'double_sha1_password', 'plaintext_password', 'no_password'
}

export interface UpdateClickHouseUserInput {
  password?: string;
  role?: ClickHouseUserRole;
  allowedDatabases?: string[];
  allowedTables?: Array<{ database: string; table: string }>;
  hostIp?: string;
  hostNames?: string;
  cluster?: string;
  authType?: string; // e.g., 'sha256_password', 'double_sha1_password', 'plaintext_password'
}

export interface ClickHouseUserDDL {
  createUser: string;
  grantStatements: string[];
  fullDDL: string;
}

// ============================================
// DDL Generation
// ============================================

/**
 * Generate DDL statements for creating a ClickHouse user
 */
export function generateUserDDL(input: CreateClickHouseUserInput): ClickHouseUserDDL {
  const { username, password, role, allowedDatabases = [], allowedTables = [], hostIp, hostNames, cluster, authType = 'sha256_password' } = input;

  // Escape username and password for SQL
  const escapedUsername = username.replace(/`/g, '``');
  // Only escape password if it's provided (not needed for no_password)
  const escapedPassword = password ? password.replace(/'/g, "''") : '';

  // Build CREATE USER statement
  let createUser = `CREATE USER IF NOT EXISTS \`${escapedUsername}\``;

  // Add ON CLUSTER clause if specified
  if (cluster) {
    const escapedCluster = cluster.replace(/`/g, '``');
    createUser += ` ON CLUSTER \`${escapedCluster}\``;
  }

  // Add host restrictions if specified
  if (hostIp || hostNames) {
    const hostParts: string[] = [];
    if (hostIp) {
      hostParts.push(`HOST IP '${hostIp.replace(/'/g, "''")}'`);
    }
    if (hostNames) {
      hostParts.push(`HOST NAME '${hostNames.replace(/'/g, "''")}'`);
    }
    if (hostParts.length > 0) {
      createUser += ` ${hostParts.join(' OR ')}`;
    }
  } else {
    createUser += ` HOST ANY`;
  }

  // Add password with auth type
  if (authType === 'no_password') {
    createUser += ` IDENTIFIED WITH no_password`;
  } else {
    createUser += ` IDENTIFIED WITH ${authType} BY '${escapedPassword}'`;
  }

  // Helper function to add ON CLUSTER clause to statements
  const addClusterClause = (statement: string): string => {
    if (cluster) {
      const escapedCluster = cluster.replace(/`/g, '``');
      return statement.replace(/;$/, '') + ` ON CLUSTER \`${escapedCluster}\``;
    }
    return statement;
  };

  // Build GRANT statements based on role
  const grantStatements: string[] = [];

  const hasRestrictions = allowedDatabases.length > 0 || allowedTables.length > 0;

  if (hasRestrictions) {
    // If there are restrictions, revoke all first, then grant specific permissions
    grantStatements.push(addClusterClause(`REVOKE ALL ON *.* FROM \`${escapedUsername}\``));

    // Apply table-level restrictions if specified (most specific first)
    if (allowedTables.length > 0) {
      // Group by database for efficiency
      const tablesByDb = new Map<string, string[]>();
      allowedTables.forEach(({ database, table }) => {
        if (!tablesByDb.has(database)) {
          tablesByDb.set(database, []);
        }
        tablesByDb.get(database)!.push(table);
      });

      tablesByDb.forEach((tables, database) => {
        const escapedDb = database.replace(/`/g, '``');
        tables.forEach(table => {
          const escapedTable = table.replace(/`/g, '``');
          switch (role) {
            case 'developer':
              grantStatements.push(addClusterClause(`GRANT ALTER TABLE ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
              grantStatements.push(addClusterClause(`GRANT DROP TABLE ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
              grantStatements.push(addClusterClause(`GRANT SELECT ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
              grantStatements.push(addClusterClause(`GRANT INSERT ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
              grantStatements.push(addClusterClause(`GRANT UPDATE ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
              grantStatements.push(addClusterClause(`GRANT DELETE ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
              break;
            case 'analyst':
              grantStatements.push(addClusterClause(`GRANT SELECT ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
              grantStatements.push(addClusterClause(`GRANT INSERT ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
              grantStatements.push(addClusterClause(`GRANT UPDATE ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
              grantStatements.push(addClusterClause(`GRANT DELETE ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
              break;
            case 'viewer':
              grantStatements.push(addClusterClause(`GRANT SELECT ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
              break;
          }
        });
      });
    } else if (allowedDatabases.length > 0) {
      // Apply database-level restrictions if no table-level restrictions
      allowedDatabases.forEach(db => {
        const escapedDb = db.replace(/`/g, '``');
        switch (role) {
          case 'developer':
            grantStatements.push(addClusterClause(`GRANT CREATE TABLE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
            grantStatements.push(addClusterClause(`GRANT ALTER TABLE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
            grantStatements.push(addClusterClause(`GRANT DROP TABLE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
            grantStatements.push(addClusterClause(`GRANT SELECT ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
            grantStatements.push(addClusterClause(`GRANT INSERT ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
            grantStatements.push(addClusterClause(`GRANT UPDATE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
            grantStatements.push(addClusterClause(`GRANT DELETE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
            break;
          case 'analyst':
            grantStatements.push(addClusterClause(`GRANT SELECT ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
            grantStatements.push(addClusterClause(`GRANT INSERT ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
            grantStatements.push(addClusterClause(`GRANT UPDATE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
            grantStatements.push(addClusterClause(`GRANT DELETE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
            break;
          case 'viewer':
            grantStatements.push(addClusterClause(`GRANT SELECT ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
            break;
        }
      });
    }
  } else {
    // No restrictions - grant permissions on all databases/tables
    switch (role) {
      case 'developer':
        // Developer: Can create databases, tables, and execute DDL/DML
        grantStatements.push(addClusterClause(`GRANT CREATE DATABASE ON *.* TO \`${escapedUsername}\``));
        grantStatements.push(addClusterClause(`GRANT CREATE TABLE ON *.* TO \`${escapedUsername}\``));
        grantStatements.push(addClusterClause(`GRANT ALTER TABLE ON *.* TO \`${escapedUsername}\``));
        grantStatements.push(addClusterClause(`GRANT DROP TABLE ON *.* TO \`${escapedUsername}\``));
        grantStatements.push(addClusterClause(`GRANT SELECT ON *.* TO \`${escapedUsername}\``));
        grantStatements.push(addClusterClause(`GRANT INSERT ON *.* TO \`${escapedUsername}\``));
        grantStatements.push(addClusterClause(`GRANT UPDATE ON *.* TO \`${escapedUsername}\``));
        grantStatements.push(addClusterClause(`GRANT DELETE ON *.* TO \`${escapedUsername}\``));
        break;

      case 'analyst':
        // Analyst: Can read and write data, but not create/drop databases/tables
        grantStatements.push(addClusterClause(`GRANT SELECT ON *.* TO \`${escapedUsername}\``));
        grantStatements.push(addClusterClause(`GRANT INSERT ON *.* TO \`${escapedUsername}\``));
        grantStatements.push(addClusterClause(`GRANT UPDATE ON *.* TO \`${escapedUsername}\``));
        grantStatements.push(addClusterClause(`GRANT DELETE ON *.* TO \`${escapedUsername}\``));
        break;

      case 'viewer':
        // Viewer: Read-only access
        grantStatements.push(addClusterClause(`GRANT SELECT ON *.* TO \`${escapedUsername}\``));
        break;
    }
  }

  // Combine all statements
  const fullDDL = [createUser, ...grantStatements].join(';\n') + ';';

  return {
    createUser: createUser + ';',
    grantStatements: grantStatements.map(s => s + ';'),
    fullDDL,
  };
}

/**
 * Generate DDL for updating a ClickHouse user
 */
export function generateUpdateUserDDL(
  username: string,
  input: UpdateClickHouseUserInput,
  currentGrants?: { allowedDatabases?: string[]; allowedTables?: Array<{ database: string; table: string }>; role?: ClickHouseUserRole | null; authType?: string }
): ClickHouseUserDDL {
  const { password, role, allowedDatabases, allowedTables, hostIp, hostNames, cluster } = input;
  // Get authType from currentGrants (metadata) - we don't allow changing it
  const currentAuthType = currentGrants?.authType || 'sha256_password';
  const escapedUsername = username.replace(/`/g, '``');

  const statements: string[] = [];

  // Helper function to add ON CLUSTER clause to statements
  const addClusterClause = (statement: string): string => {
    if (cluster) {
      const escapedCluster = cluster.replace(/`/g, '``');
      return statement.replace(/;$/, '') + ` ON CLUSTER \`${escapedCluster}\``;
    }
    return statement;
  };

  // Update password if provided
  // Note: authType cannot be changed during update - we use the existing authType from metadata
  if (password) {
    const escapedPassword = password.replace(/'/g, "''");
    if (currentAuthType === 'no_password') {
      // If current auth is no_password, we can't set a password - skip this
      // User would need to change auth type, which we don't allow
    } else {
      statements.push(`ALTER USER \`${escapedUsername}\` IDENTIFIED WITH ${currentAuthType} BY '${escapedPassword}'`);
    }
  }
  // We don't allow changing authType during update, so we skip that logic

  // Update host restrictions if provided
  // Note: ClickHouse doesn't support REMOVE HOST ANY directly
  // We need to handle this carefully - if hostIp/hostNames are empty strings, we want to allow all hosts
  // If they have values, we want to set specific restrictions
  // Since we can't easily remove all existing restrictions without knowing what they are,
  // we'll use ADD which will work correctly if the user doesn't have existing restrictions
  // For a complete solution, we'd need to query system.users first to see existing host_ip/host_names
  if (hostIp !== undefined || hostNames !== undefined) {
    const hostParts: string[] = [];

    // Empty string means allow all hosts (HOST ANY)
    // Non-empty string means specific restriction
    if (hostIp && hostIp.trim()) {
      hostParts.push(`HOST IP '${hostIp.replace(/'/g, "''")}'`);
    }
    if (hostNames && hostNames.trim()) {
      hostParts.push(`HOST NAME '${hostNames.replace(/'/g, "''")}'`);
    }

    if (hostParts.length > 0) {
      // Add specific host restrictions
      // Note: This will add to existing restrictions. To fully replace, we'd need to query and remove existing ones first
      statements.push(`ALTER USER \`${escapedUsername}\` ADD ${hostParts.join(' OR ')}`);
    } else if (hostIp === '' || hostNames === '') {
      // Explicitly set to allow all hosts
      // Note: ADD HOST ANY will work, but if user already has restrictions, they'll still apply
      // For a complete solution, we'd need to query system.users and remove existing restrictions first
      statements.push(`ALTER USER \`${escapedUsername}\` ADD HOST ANY`);
    }
    // If both are undefined (not provided), we don't change host restrictions
  }

  // Handle grants update
  if (role !== undefined || allowedDatabases !== undefined || allowedTables !== undefined) {
    // Determine effective values (use input if provided, otherwise keep current)
    const effectiveRole = role !== undefined ? role : (currentGrants?.role || 'viewer');
    const effectiveAllowedDbs = allowedDatabases !== undefined
      ? allowedDatabases
      : (currentGrants?.allowedDatabases || []);
    const effectiveAllowedTables = allowedTables !== undefined
      ? allowedTables
      : (currentGrants?.allowedTables || []);

    // Empty arrays mean no restrictions (full access)
    // Non-empty arrays mean specific restrictions
    const hasRestrictions = effectiveAllowedDbs.length > 0 || effectiveAllowedTables.length > 0;

    // Always revoke all grants first to ensure clean state
    statements.push(addClusterClause(`REVOKE ALL ON *.* FROM \`${escapedUsername}\``));

    // Now generate grants based on effective values
    if (hasRestrictions) {
      // Apply table-level restrictions if specified (most specific first)
      if (effectiveAllowedTables.length > 0) {
        const tablesByDb = new Map<string, string[]>();
        effectiveAllowedTables.forEach(({ database, table }) => {
          if (!tablesByDb.has(database)) {
            tablesByDb.set(database, []);
          }
          tablesByDb.get(database)!.push(table);
        });

        tablesByDb.forEach((tables, database) => {
          const escapedDb = database.replace(/`/g, '``');
          tables.forEach(table => {
            const escapedTable = table.replace(/`/g, '``');
            switch (effectiveRole) {
              case 'developer':
                statements.push(addClusterClause(`GRANT ALTER TABLE ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
                statements.push(addClusterClause(`GRANT DROP TABLE ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
                statements.push(addClusterClause(`GRANT SELECT ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
                statements.push(addClusterClause(`GRANT INSERT ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
                statements.push(addClusterClause(`GRANT UPDATE ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
                statements.push(addClusterClause(`GRANT DELETE ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
                break;
              case 'analyst':
                statements.push(addClusterClause(`GRANT SELECT ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
                statements.push(addClusterClause(`GRANT INSERT ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
                statements.push(addClusterClause(`GRANT UPDATE ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
                statements.push(addClusterClause(`GRANT DELETE ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
                break;
              case 'viewer':
                statements.push(addClusterClause(`GRANT SELECT ON \`${escapedDb}\`.\`${escapedTable}\` TO \`${escapedUsername}\``));
                break;
            }
          });
        });
      } else if (effectiveAllowedDbs.length > 0) {
        // Apply database-level restrictions if no table-level restrictions
        effectiveAllowedDbs.forEach(db => {
          const escapedDb = db.replace(/`/g, '``');
          switch (effectiveRole) {
            case 'developer':
              statements.push(addClusterClause(`GRANT CREATE TABLE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
              statements.push(addClusterClause(`GRANT ALTER TABLE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
              statements.push(addClusterClause(`GRANT DROP TABLE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
              statements.push(addClusterClause(`GRANT SELECT ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
              statements.push(addClusterClause(`GRANT INSERT ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
              statements.push(addClusterClause(`GRANT UPDATE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
              statements.push(addClusterClause(`GRANT DELETE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
              break;
            case 'analyst':
              statements.push(addClusterClause(`GRANT SELECT ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
              statements.push(addClusterClause(`GRANT INSERT ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
              statements.push(addClusterClause(`GRANT UPDATE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
              statements.push(addClusterClause(`GRANT DELETE ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
              break;
            case 'viewer':
              statements.push(addClusterClause(`GRANT SELECT ON \`${escapedDb}\`.* TO \`${escapedUsername}\``));
              break;
          }
        });
      }
    } else {
      // No restrictions - grant permissions on all databases/tables
      switch (effectiveRole) {
        case 'developer':
          statements.push(addClusterClause(`GRANT CREATE DATABASE ON *.* TO \`${escapedUsername}\``));
          statements.push(addClusterClause(`GRANT CREATE TABLE ON *.* TO \`${escapedUsername}\``));
          statements.push(addClusterClause(`GRANT ALTER TABLE ON *.* TO \`${escapedUsername}\``));
          statements.push(addClusterClause(`GRANT DROP TABLE ON *.* TO \`${escapedUsername}\``));
          statements.push(addClusterClause(`GRANT SELECT ON *.* TO \`${escapedUsername}\``));
          statements.push(addClusterClause(`GRANT INSERT ON *.* TO \`${escapedUsername}\``));
          statements.push(addClusterClause(`GRANT UPDATE ON *.* TO \`${escapedUsername}\``));
          statements.push(addClusterClause(`GRANT DELETE ON *.* TO \`${escapedUsername}\``));
          break;
        case 'analyst':
          statements.push(addClusterClause(`GRANT SELECT ON *.* TO \`${escapedUsername}\``));
          statements.push(addClusterClause(`GRANT INSERT ON *.* TO \`${escapedUsername}\``));
          statements.push(addClusterClause(`GRANT UPDATE ON *.* TO \`${escapedUsername}\``));
          statements.push(addClusterClause(`GRANT DELETE ON *.* TO \`${escapedUsername}\``));
          break;
        case 'viewer':
          statements.push(addClusterClause(`GRANT SELECT ON *.* TO \`${escapedUsername}\``));
          break;
      }
    }
  }

  // Ensure all statements end with semicolon (but not double semicolons)
  const normalizedStatements = statements.map(s => {
    const trimmed = s.trim();
    return trimmed.endsWith(';') ? trimmed : trimmed + ';';
  });

  const fullDDL = normalizedStatements.length > 0 ? normalizedStatements.join('\n') : '';

  return {
    createUser: normalizedStatements[0] || '',
    grantStatements: normalizedStatements.slice(1),
    fullDDL,
  };
}

// ============================================
// Metadata Management
// ============================================

/**
 * Save ClickHouse user metadata to the database
 */
export async function saveUserMetadata(
  connectionId: string,
  username: string,
  input: CreateClickHouseUserInput | UpdateClickHouseUserInput,
  createdBy?: string
): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const metadata = {
    id: randomUUID(),
    username,
    connectionId,
    role: input.role!,
    cluster: input.cluster || null,
    hostIp: input.hostIp || null,
    hostNames: input.hostNames || null,
    authType: input.authType || 'sha256_password',
    allowedDatabases: input.allowedDatabases || [],
    allowedTables: input.allowedTables || [],
    createdBy: createdBy || null,
  };

  // Check if metadata already exists
  const existing = await db.select()
    .from(schema.clickhouseUsersMetadata)
    .where(and(
      eq(schema.clickhouseUsersMetadata.username, username),
      eq(schema.clickhouseUsersMetadata.connectionId, connectionId)
    ))
    .limit(1);

  if (existing.length > 0) {
    // Update existing metadata
    await db.update(schema.clickhouseUsersMetadata)
      .set({
        role: metadata.role,
        cluster: metadata.cluster,
        hostIp: metadata.hostIp,
        hostNames: metadata.hostNames,
        authType: metadata.authType,
        allowedDatabases: metadata.allowedDatabases,
        allowedTables: metadata.allowedTables,
        updatedAt: new Date(),
      })
      .where(eq(schema.clickhouseUsersMetadata.id, existing[0].id));
  } else {
    // Insert new metadata
    await db.insert(schema.clickhouseUsersMetadata).values(metadata);
  }
}

/**
 * Get ClickHouse user metadata from the database
 */
export async function getUserMetadata(
  connectionId: string,
  username: string
): Promise<{
  role: ClickHouseUserRole;
  cluster?: string | null;
  hostIp?: string | null;
  hostNames?: string | null;
  authType?: string | null;
  allowedDatabases: string[];
  allowedTables: Array<{ database: string; table: string }>;
} | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const results = await db.select()
    .from(schema.clickhouseUsersMetadata)
    .where(and(
      eq(schema.clickhouseUsersMetadata.username, username),
      eq(schema.clickhouseUsersMetadata.connectionId, connectionId)
    ))
    .limit(1);

  if (results.length === 0) {
    return null;
  }

  const meta = results[0];
  return {
    role: meta.role as ClickHouseUserRole,
    cluster: meta.cluster || undefined,
    hostIp: meta.hostIp || undefined,
    hostNames: meta.hostNames || undefined,
    authType: meta.authType || undefined,
    allowedDatabases: meta.allowedDatabases || [],
    allowedTables: meta.allowedTables || [],
  };
}

/**
 * Delete ClickHouse user metadata
 */
export async function deleteUserMetadata(
  connectionId: string,
  username: string
): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  await db.delete(schema.clickhouseUsersMetadata)
    .where(and(
      eq(schema.clickhouseUsersMetadata.username, username),
      eq(schema.clickhouseUsersMetadata.connectionId, connectionId)
    ));
}

// ============================================
// User Management Operations
// ============================================

/**
 * List all ClickHouse users
 * Optionally enriches with metadata if connectionId is provided
 */
export async function listClickHouseUsers(
  service: ClickHouseService,
  connectionId?: string
): Promise<ClickHouseUser[]> {
  try {
    const result = await service.executeQuery<ClickHouseUser & { host_ip?: string | string[]; host_names?: string | string[] }>(
      `SELECT 
        name,
        host_ip,
        host_names,
        default_roles_all,
        default_roles_list,
        default_roles_except,
        auth_type
      FROM system.users
      ORDER BY name`
    );

    // Convert host_ip and host_names arrays to strings (ClickHouse returns them as arrays)
    const users = (result.data || []).map(user => ({
      ...user,
      host_ip: Array.isArray(user.host_ip) ? (user.host_ip[0] || undefined) : user.host_ip,
      host_names: Array.isArray(user.host_names) ? (user.host_names[0] || undefined) : user.host_names,
    }));

    // If connectionId is provided, enrich with metadata (especially for host_ip/host_names)
    if (connectionId) {
      const db = getDatabase() as AnyDb;
      const schema = getSchema();

      try {
        const metadataResults = await db.select()
          .from(schema.clickhouseUsersMetadata)
          .where(eq(schema.clickhouseUsersMetadata.connectionId, connectionId));

        const metadataMap = new Map<string, { hostIp?: string | null; hostNames?: string | null; authType?: string | null }>(
          metadataResults.map((meta: ClickHouseUserMetadata) => [meta.username, { hostIp: meta.hostIp, hostNames: meta.hostNames, authType: meta.authType }])
        );

        // Enrich users with metadata
        return users.map(user => {
          const metadata = metadataMap.get(user.name);
          if (metadata) {
            return {
              ...user,
              // Use metadata host_ip/host_names/auth_type if available (more reliable than ClickHouse's format)
              host_ip: (metadata.hostIp && metadata.hostIp.trim()) ? metadata.hostIp : user.host_ip,
              host_names: (metadata.hostNames && metadata.hostNames.trim()) ? metadata.hostNames : user.host_names,
              auth_type: metadata.authType || user.auth_type,
            };
          }
          return user;
        });
      } catch (error) {
        logger.warn({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Failed to load metadata for listing');
        // Return users without metadata enrichment if it fails
        return users;
      }
    }

    return users;
  } catch (error) {
    throw new Error(`Failed to list ClickHouse users: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get a specific ClickHouse user with metadata
 */
export async function getClickHouseUser(
  service: ClickHouseService,
  username: string,
  connectionId?: string
): Promise<(ClickHouseUser & { role?: ClickHouseUserRole | null; allowedDatabases?: string[]; allowedTables?: Array<{ database: string; table: string }> }) | null> {
  try {
    const escapedUsername = username.replace(/'/g, "''");
    const result = await service.executeQuery<ClickHouseUser & { host_ip?: string | string[]; host_names?: string | string[] }>(
      `SELECT 
        name,
        host_ip,
        host_names,
        default_roles_all,
        default_roles_list,
        default_roles_except,
        auth_type
      FROM system.users
      WHERE name = '${escapedUsername}'
      LIMIT 1`
    );

    const user = result.data?.[0];
    if (!user) return null;

    // Convert host_ip and host_names arrays to strings (ClickHouse returns them as arrays)
    const baseUser = {
      ...user,
      host_ip: Array.isArray(user.host_ip) ? (user.host_ip[0] || undefined) : user.host_ip,
      host_names: Array.isArray(user.host_names) ? (user.host_names[0] || undefined) : user.host_names,
    };

    // Try to load metadata if connectionId is provided
    if (connectionId) {
      try {
        const metadata = await getUserMetadata(connectionId, username);
        if (metadata) {
          return {
            ...baseUser,
            // Override host_ip, host_names, and auth_type with metadata values (more reliable than ClickHouse's format)
            host_ip: (metadata.hostIp && metadata.hostIp.trim()) ? metadata.hostIp : baseUser.host_ip,
            host_names: (metadata.hostNames && metadata.hostNames.trim()) ? metadata.hostNames : baseUser.host_names,
            auth_type: metadata.authType || baseUser.auth_type,
            role: metadata.role,
            allowedDatabases: metadata.allowedDatabases,
            allowedTables: metadata.allowedTables,
          };
        }
      } catch (error) {
        logger.warn({ module: 'ClickHouse Users', username, err: error instanceof Error ? error.message : String(error) }, 'Failed to load metadata');
        // Fall through to grant parsing
      }
    }

    // Fallback: parse grants if metadata not available
    try {
      const grants = await getUserGrants(service, username);
      return {
        ...baseUser,
        role: grants.role,
        allowedDatabases: grants.allowedDatabases,
        allowedTables: grants.allowedTables,
      };
    } catch (error) {
      logger.warn({ module: 'ClickHouse Users', username, err: error instanceof Error ? error.message : String(error) }, 'Failed to parse grants');
      return baseUser;
    }
  } catch (error) {
    throw new Error(`Failed to get ClickHouse user: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get grants for a ClickHouse user and parse them to extract databases and tables
 */
export async function getUserGrants(
  service: ClickHouseService,
  username: string
): Promise<{ allowedDatabases: string[]; allowedTables: Array<{ database: string; table: string }>; role: ClickHouseUserRole | null }> {
  try {
    const escapedUsername = username.replace(/`/g, '``');

    // Get grants for the user
    // ClickHouse returns grants in a specific format - try different query formats
    let grantsResult;
    try {
      grantsResult = await service.executeQuery<{ grant?: string;[key: string]: any }>(
        `SHOW GRANTS FOR \`${escapedUsername}\``
      );
    } catch (error) {
      // Try alternative format
      try {
        grantsResult = await service.executeQuery<{ [key: string]: any }>(
          `SELECT grant FROM system.grants WHERE user_name = '${escapedUsername.replace(/'/g, "''")}'`
        );
      } catch (err2) {
        logger.warn({ module: 'ClickHouse Users', username, err: error instanceof Error ? error.message : String(error) }, 'Failed to get grants');
        return {
          allowedDatabases: [],
          allowedTables: [],
          role: null,
        };
      }
    }

    const grants = grantsResult.data || [];
    logger.debug({ module: 'ClickHouse Users', username }, 'getUserGrants: raw grants');
    const allowedDatabases = new Set<string>();
    const allowedTables: Array<{ database: string; table: string }> = [];
    let role: ClickHouseUserRole | null = null;
    let hasFullAccess = false;

    // Parse grants to extract databases and tables
    const permissions = new Set<string>();

    for (const row of grants) {
      // Handle different possible column names and formats
      let grant: string = '';
      if (typeof row === 'string') {
        grant = row;
      } else if (row.grant) {
        grant = row.grant;
      } else if (row.GRANT) {
        grant = row.GRANT;
      } else {
        // Try to find the grant string in the object
        const values = Object.values(row);
        grant = values.find(v => typeof v === 'string' && v.length > 0) as string || '';
      }

      if (!grant || typeof grant !== 'string') {
        logger.debug({ module: 'ClickHouse Users' }, 'getUserGrants: skipping invalid grant row');
        continue;
      }

      logger.debug({ module: 'ClickHouse Users' }, 'getUserGrants: processing grant');

      // Skip REVOKE statements
      if (grant.toUpperCase().startsWith('REVOKE')) {
        continue;
      }

      const grantUpper = grant.toUpperCase();

      // Collect all permissions to determine role
      if (grantUpper.includes('GRANT')) {
        if (grantUpper.includes('CREATE DATABASE')) permissions.add('CREATE_DATABASE');
        if (grantUpper.includes('CREATE TABLE')) permissions.add('CREATE_TABLE');
        if (grantUpper.includes('DROP TABLE')) permissions.add('DROP_TABLE');
        if (grantUpper.includes('ALTER TABLE')) permissions.add('ALTER_TABLE');
        if (grantUpper.includes('SELECT')) permissions.add('SELECT');
        if (grantUpper.includes('INSERT')) permissions.add('INSERT');
        if (grantUpper.includes('UPDATE')) permissions.add('UPDATE');
        if (grantUpper.includes('DELETE')) permissions.add('DELETE');
      }

      // Check for full access (*.*)
      if (grantUpper.includes('ON *.*') || grantUpper.includes('ON `*`.`*`')) {
        hasFullAccess = true;
        continue;
      }

      // Parse database/table patterns
      // Pattern: GRANT ... ON `database`.* TO ...
      // Pattern: GRANT ... ON `database`.`table` TO ...
      const onMatch = grant.match(/ON\s+([^T]+?)\s+TO/i);
      if (onMatch) {
        const target = onMatch[1].trim();

        // Match `database`.* or `database`.`table`
        const dbTableMatch = target.match(/`([^`]+)`\.(`([^`]+)`|\*)/);
        if (dbTableMatch) {
          const database = dbTableMatch[1];
          const tableOrStar = dbTableMatch[2];

          if (tableOrStar === '*') {
            // Database-level access
            allowedDatabases.add(database);
          } else {
            // Table-level access
            const table = dbTableMatch[3];
            allowedTables.push({ database, table });
            // Also add the database if not already added
            allowedDatabases.add(database);
          }
        }
      }
    }

    // Determine role based on permissions
    if (permissions.has('CREATE_DATABASE') || permissions.has('CREATE_TABLE') ||
      permissions.has('DROP_TABLE') || permissions.has('ALTER_TABLE')) {
      role = 'developer';
    } else if (permissions.has('INSERT') || permissions.has('UPDATE') || permissions.has('DELETE')) {
      role = 'analyst';
    } else if (permissions.has('SELECT')) {
      role = 'viewer';
    }

    // If user has *.* access, return empty arrays (meaning no restrictions)
    // Otherwise, return the specific databases/tables
    const result = {
      allowedDatabases: hasFullAccess ? [] : Array.from(allowedDatabases),
      allowedTables: hasFullAccess ? [] : allowedTables,
      role,
    };

    logger.debug({ module: 'ClickHouse Users', username }, 'getUserGrants: parsed grants');
    return result;
  } catch (error) {
    // If grants can't be retrieved, return empty (user might not exist or have no grants)
    logger.warn({ module: 'ClickHouse Users', username, err: error instanceof Error ? error.message : String(error) }, 'Failed to get grants');
    return {
      allowedDatabases: [],
      allowedTables: [],
      role: null,
    };
  }
}

/**
 * Create a ClickHouse user
 */
export async function createClickHouseUser(
  service: ClickHouseService,
  input: CreateClickHouseUserInput,
  connectionId?: string,
  createdBy?: string
): Promise<void> {
  try {
    const ddl = generateUserDDL(input);

    // Execute each statement separately (ClickHouse doesn't support multi-statement queries)
    // First, create the user
    await service.executeQuery(ddl.createUser);

    // Then execute each grant statement separately
    for (const grantStatement of ddl.grantStatements) {
      // Remove trailing semicolon if present (it's already in the statement)
      const statement = grantStatement.trim();
      if (statement) {
        await service.executeQuery(statement);
      }
    }

    // Save metadata after successful creation
    if (connectionId) {
      try {
        await saveUserMetadata(connectionId, input.username, input, createdBy);
      } catch (error) {
        logger.warn({ module: 'ClickHouse Users', username: input.username, err: error instanceof Error ? error.message : String(error) }, 'Failed to save metadata');
        // Don't fail the whole operation if metadata save fails
      }
    }
  } catch (error) {
    throw new Error(`Failed to create ClickHouse user: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Update a ClickHouse user
 */
export async function updateClickHouseUser(
  service: ClickHouseService,
  username: string,
  input: UpdateClickHouseUserInput,
  connectionId?: string,
  currentGrants?: { allowedDatabases?: string[]; allowedTables?: Array<{ database: string; table: string }>; role?: ClickHouseUserRole | null; authType?: string }
): Promise<void> {
  try {
    const ddl = generateUpdateUserDDL(username, input, currentGrants);

    // Execute each statement separately (ClickHouse doesn't support multi-statement queries)
    const allStatements = [ddl.createUser, ...ddl.grantStatements].filter(s => s.trim());

    for (const statement of allStatements) {
      const trimmedStatement = statement.trim();
      if (trimmedStatement) {
        await service.executeQuery(trimmedStatement);
      }
    }

    // Update metadata after successful update
    if (connectionId) {
      try {
        // Merge current grants with input to get full picture
        // Try to get current metadata to preserve authType
        let currentAuthType: string | undefined;
        try {
          const currentMetadata = await getUserMetadata(connectionId, username);
          currentAuthType = currentMetadata?.authType || undefined;
        } catch (error) {
          // Ignore error, will use default
        }

        const fullInput: UpdateClickHouseUserInput = {
          role: input.role ?? currentGrants?.role ?? undefined,
          allowedDatabases: input.allowedDatabases ?? currentGrants?.allowedDatabases ?? [],
          allowedTables: input.allowedTables ?? currentGrants?.allowedTables ?? [],
          hostIp: input.hostIp,
          hostNames: input.hostNames,
          cluster: input.cluster,
          authType: input.authType ?? currentAuthType,
        };
        await saveUserMetadata(connectionId, username, fullInput);
      } catch (error) {
        logger.warn({ module: 'ClickHouse Users', username, err: error instanceof Error ? error.message : String(error) }, 'Failed to update metadata');
        // Don't fail the whole operation if metadata update fails
      }
    }
  } catch (error) {
    throw new Error(`Failed to update ClickHouse user: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Delete a ClickHouse user
 */
export async function deleteClickHouseUser(
  service: ClickHouseService,
  username: string,
  connectionId?: string
): Promise<void> {
  try {
    const escapedUsername = username.replace(/`/g, '``');
    const ddl = `DROP USER IF EXISTS \`${escapedUsername}\`;`;

    await service.executeQuery(ddl);

    // Delete metadata after successful deletion
    if (connectionId) {
      try {
        await deleteUserMetadata(connectionId, username);
      } catch (error) {
        logger.warn({ module: 'ClickHouse Users', username, err: error instanceof Error ? error.message : String(error) }, 'Failed to delete metadata');
        // Don't fail the whole operation if metadata delete fails
      }
    }
  } catch (error) {
    throw new Error(`Failed to delete ClickHouse user: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Sync unregistered ClickHouse users to metadata
 * This will create metadata entries for users that exist in ClickHouse but don't have metadata
 */
export async function syncUnregisteredUsers(
  service: ClickHouseService,
  connectionId: string,
  createdBy?: string
): Promise<{ synced: number; errors: Array<{ username: string; error: string }> }> {
  const synced: number[] = [];
  const errors: Array<{ username: string; error: string }> = [];

  try {
    // Get all ClickHouse users
    const allUsers = await listClickHouseUsers(service);

    // Get all existing metadata for this connection
    const db = getDatabase() as any;
    const schema = getSchema();
    const existingMetadata = await db.select()
      .from(schema.clickhouseUsersMetadata)
      .where(eq(schema.clickhouseUsersMetadata.connectionId, connectionId));

    const existingUsernames = new Set(existingMetadata.map((m: any) => m.username));

    // Find users without metadata
    const unregisteredUsers = allUsers.filter(user => !existingUsernames.has(user.name));

    // Sync each unregistered user
    for (const user of unregisteredUsers) {
      try {
        // Try to parse grants to determine role and access
        let role: ClickHouseUserRole = 'viewer';
        let allowedDatabases: string[] = [];
        let allowedTables: Array<{ database: string; table: string }> = [];

        try {
          const grants = await getUserGrants(service, user.name);
          role = grants.role || 'viewer';
          allowedDatabases = grants.allowedDatabases || [];
          allowedTables = grants.allowedTables || [];
        } catch (error) {
          logger.warn({ module: 'ClickHouse Users', username: user.name, err: error instanceof Error ? error.message : String(error) }, 'Sync: failed to parse grants, using defaults');
          // Use defaults if grant parsing fails
        }

        // Create metadata entry
        await saveUserMetadata(
          connectionId,
          user.name,
          {
            role,
            allowedDatabases,
            allowedTables,
            hostIp: user.host_ip || undefined,
            hostNames: user.host_names || undefined,
            authType: user.auth_type || 'sha256_password',
          },
          createdBy
        );

        synced.push(1);
      } catch (error) {
        errors.push({
          username: user.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      synced: synced.length,
      errors,
    };
  } catch (error) {
    throw new Error(`Failed to sync unregistered users: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
