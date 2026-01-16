/**
 * User Preferences Service
 * 
 * Handles user-specific UI preferences, favorites, and recent items.
 * All operations are scoped to the authenticated user.
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDatabase, getSchema, isSqlite } from '../db';

// Type helper for working with dual database setup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ============================================
// Types
// ============================================

export interface FavoriteItem {
  id: string;
  database: string;
  table?: string;
  connectionId?: string | null;
  connectionName?: string | null;
  createdAt: Date;
}

export interface RecentItem {
  id: string;
  database: string;
  table?: string;
  connectionId?: string | null;
  connectionName?: string | null;
  accessedAt: Date;
}

export interface UserPreferences {
  explorerSortBy?: 'name' | 'date' | 'size';
  explorerViewMode?: 'tree' | 'list' | 'compact';
  explorerShowFavoritesOnly?: boolean;
  workspacePreferences?: Record<string, unknown>;
}

// ============================================
// Favorites
// ============================================

/**
 * Get all favorites for a user
 */
export async function getUserFavorites(userId: string): Promise<FavoriteItem[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  
  const favorites = await db
    .select({
      id: schema.userFavorites.id,
      database: schema.userFavorites.database,
      table: schema.userFavorites.table,
      connectionId: schema.userFavorites.connectionId,
      connectionName: schema.userFavorites.connectionName,
      createdAt: schema.userFavorites.createdAt,
    })
    .from(schema.userFavorites)
    .where(eq(schema.userFavorites.userId, userId))
    .orderBy(desc(schema.userFavorites.createdAt));
  
  return favorites.map((fav: any) => ({
    id: fav.id,
    database: fav.database,
    table: fav.table || undefined,
    connectionId: fav.connectionId || null,
    connectionName: fav.connectionName || null,
    createdAt: fav.createdAt instanceof Date ? fav.createdAt : new Date(fav.createdAt),
  }));
}

/**
 * Add a favorite for a user
 */
export async function addUserFavorite(
  userId: string,
  database: string,
  table?: string,
  connectionId?: string | null,
  connectionName?: string | null
): Promise<FavoriteItem> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  
  // Check if favorite already exists (with same connection)
  const [existing] = await db
    .select()
    .from(schema.userFavorites)
    .where(
      and(
        eq(schema.userFavorites.userId, userId),
        eq(schema.userFavorites.database, database),
        table 
          ? eq(schema.userFavorites.table, table)
          : sql`${schema.userFavorites.table} IS NULL`,
        connectionId
          ? eq(schema.userFavorites.connectionId, connectionId)
          : sql`${schema.userFavorites.connectionId} IS NULL`
      )
    )
    .limit(1);
  
  if (existing) {
    // Already exists, return it
    return {
      id: existing.id,
      database: existing.database,
      table: existing.table || undefined,
      connectionId: existing.connectionId || null,
      connectionName: existing.connectionName || null,
      createdAt: existing.createdAt instanceof Date ? existing.createdAt : new Date(existing.createdAt),
    };
  }
  
  // Insert new favorite
  const id = randomUUID();
  const favorite = {
    id,
    userId,
    database,
    table: table || null,
    connectionId: connectionId || null,
    connectionName: connectionName || null,
  };
  
  await db.insert(schema.userFavorites).values(favorite);
  
  // Fetch the created favorite
  const [created] = await db
    .select()
    .from(schema.userFavorites)
    .where(eq(schema.userFavorites.id, id))
    .limit(1);
  
  if (!created) {
    throw new Error('Failed to create favorite');
  }
  
  return {
    id: created.id,
    database: created.database,
    table: created.table || undefined,
    connectionId: created.connectionId || null,
    connectionName: created.connectionName || null,
    createdAt: created.createdAt instanceof Date ? created.createdAt : new Date(created.createdAt),
  };
}

/**
 * Remove a favorite for a user
 */
export async function removeUserFavorite(
  userId: string,
  favoriteId: string
): Promise<boolean> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  
  const result = await db
    .delete(schema.userFavorites)
    .where(
      and(
        eq(schema.userFavorites.id, favoriteId),
        eq(schema.userFavorites.userId, userId)
      )
    );
  
  // Check if any rows were deleted
  if (isSqlite()) {
    return (result as any).changes > 0;
  } else {
    return (result as any).rowCount > 0;
  }
}

/**
 * Clear all favorites for a user
 */
export async function clearUserFavorites(userId: string): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  
  await db
    .delete(schema.userFavorites)
    .where(eq(schema.userFavorites.userId, userId));
}

/**
 * Check if a database/table is favorited by a user
 */
export async function isUserFavorite(
  userId: string,
  database: string,
  table?: string,
  connectionId?: string | null
): Promise<boolean> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  
  const [favorite] = await db
    .select()
    .from(schema.userFavorites)
    .where(
      and(
        eq(schema.userFavorites.userId, userId),
        eq(schema.userFavorites.database, database),
        table 
          ? eq(schema.userFavorites.table, table)
          : sql`${schema.userFavorites.table} IS NULL`,
        connectionId
          ? eq(schema.userFavorites.connectionId, connectionId)
          : sql`${schema.userFavorites.connectionId} IS NULL`
      )
    )
    .limit(1);
  
  return !!favorite;
}

// ============================================
// Recent Items
// ============================================

/**
 * Get recent items for a user (limited to most recent N)
 */
export async function getUserRecentItems(
  userId: string,
  limit: number = 10
): Promise<RecentItem[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  
  const recentItems = await db
    .select({
      id: schema.userRecentItems.id,
      database: schema.userRecentItems.database,
      table: schema.userRecentItems.table,
      connectionId: schema.userRecentItems.connectionId,
      connectionName: schema.userRecentItems.connectionName,
      accessedAt: schema.userRecentItems.accessedAt,
    })
    .from(schema.userRecentItems)
    .where(eq(schema.userRecentItems.userId, userId))
    .orderBy(desc(schema.userRecentItems.accessedAt))
    .limit(limit);
  
  return recentItems.map((item: any) => ({
    id: item.id,
    database: item.database,
    table: item.table || undefined,
    connectionId: item.connectionId || null,
    connectionName: item.connectionName || null,
    accessedAt: item.accessedAt instanceof Date ? item.accessedAt : new Date(item.accessedAt),
  }));
}

/**
 * Add or update a recent item for a user
 */
export async function addUserRecentItem(
  userId: string,
  database: string,
  table?: string,
  connectionId?: string | null,
  connectionName?: string | null
): Promise<RecentItem> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  
  // Check if item already exists (with same connection)
  const [existing] = await db
    .select()
    .from(schema.userRecentItems)
    .where(
      and(
        eq(schema.userRecentItems.userId, userId),
        eq(schema.userRecentItems.database, database),
        table 
          ? eq(schema.userRecentItems.table, table)
          : sql`${schema.userRecentItems.table} IS NULL`,
        connectionId
          ? eq(schema.userRecentItems.connectionId, connectionId)
          : sql`${schema.userRecentItems.connectionId} IS NULL`
      )
    )
    .limit(1);
  
  if (existing) {
    // Update accessed_at
    await db
      .update(schema.userRecentItems)
      .set({ accessedAt: new Date() })
      .where(eq(schema.userRecentItems.id, existing.id));
    
    return {
      id: existing.id,
      database: existing.database,
      table: existing.table || undefined,
      connectionId: existing.connectionId || null,
      connectionName: existing.connectionName || null,
      accessedAt: new Date(),
    };
  } else {
    // Insert new item
    const id = randomUUID();
    await db.insert(schema.userRecentItems).values({
      id,
      userId,
      database,
      table: table || null,
      connectionId: connectionId || null,
      connectionName: connectionName || null,
      accessedAt: new Date(),
    });
    
    return {
      id,
      database,
      table,
      connectionId: connectionId || null,
      connectionName: connectionName || null,
      accessedAt: new Date(),
    };
  }
}

/**
 * Clear all recent items for a user
 */
export async function clearUserRecentItems(userId: string): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  
  await db
    .delete(schema.userRecentItems)
    .where(eq(schema.userRecentItems.userId, userId));
}

// ============================================
// Preferences
// ============================================

/**
 * Get user preferences
 */
export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  
  const [prefs] = await db
    .select()
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  
  if (!prefs) {
    return {};
  }
  
  return {
    explorerSortBy: prefs.explorerSortBy as any,
    explorerViewMode: prefs.explorerViewMode as any,
    explorerShowFavoritesOnly: prefs.explorerShowFavoritesOnly || false,
    workspacePreferences: prefs.workspacePreferences || {},
  };
}

/**
 * Update user preferences (upsert)
 */
export async function updateUserPreferences(
  userId: string,
  preferences: Partial<UserPreferences>
): Promise<UserPreferences> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  
  const id = randomUUID();
  const values: any = {
    id,
    userId,
    updatedAt: new Date(),
  };
  
  if (preferences.explorerSortBy !== undefined) {
    values.explorerSortBy = preferences.explorerSortBy;
  }
  if (preferences.explorerViewMode !== undefined) {
    values.explorerViewMode = preferences.explorerViewMode;
  }
  if (preferences.explorerShowFavoritesOnly !== undefined) {
    values.explorerShowFavoritesOnly = preferences.explorerShowFavoritesOnly;
  }
  if (preferences.workspacePreferences !== undefined) {
    values.workspacePreferences = preferences.workspacePreferences;
  }
  
  // Check if preferences exist
  const [existing] = await db
    .select()
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  
  if (existing) {
    // Update existing
    await db
      .update(schema.userPreferences)
      .set(values)
      .where(eq(schema.userPreferences.userId, userId));
  } else {
    // Insert new
    await db.insert(schema.userPreferences).values(values);
  }
  
  return getUserPreferences(userId);
}
