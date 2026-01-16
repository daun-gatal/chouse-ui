/**
 * Saved Queries Service
 * 
 * Manages saved SQL queries scoped by user.
 * Queries can optionally be associated with a connection for filtering.
 * connectionId is optional - null means shared across all connections.
 */

import { eq, and, or, desc, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDatabase, getSchema } from '../db';

// ============================================
// Types
// ============================================

export interface SavedQueryInput {
  name: string;
  query: string;
  description?: string;
  isPublic?: boolean;
  connectionId?: string | null;
  connectionName?: string | null;
}

export interface SavedQueryResponse {
  id: string;
  userId: string;
  connectionId: string | null;
  connectionName: string | null;
  name: string;
  query: string;
  description: string | null;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Convert database row to response format
 */
function toResponse(row: {
  id: string;
  userId: string;
  connectionId: string | null;
  connectionName?: string | null;
  name: string;
  query: string;
  description: string | null;
  isPublic: boolean;
  createdAt: Date | number;
  updatedAt: Date | number;
}): SavedQueryResponse {
  return {
    id: row.id,
    userId: row.userId,
    connectionId: row.connectionId,
    connectionName: row.connectionName ?? null,
    name: row.name,
    query: row.query,
    description: row.description,
    isPublic: row.isPublic,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt * 1000),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt * 1000),
  };
}

// ============================================
// Service Functions
// ============================================

/**
 * Get all saved queries for a user
 * Optionally filter by connectionId
 * Includes user's own queries and public queries from other users
 * 
 * @param userId - The user ID
 * @param connectionId - Optional connection ID to filter by (null = get all)
 */
export async function getSavedQueries(
  userId: string,
  connectionId?: string | null
): Promise<SavedQueryResponse[]> {
  const db = getDatabase();
  const schema = getSchema();

  let query = db
    .select()
    .from(schema.savedQueries)
    .where(
      or(
        eq(schema.savedQueries.userId, userId),
        eq(schema.savedQueries.isPublic, true)
      )
    )
    .orderBy(desc(schema.savedQueries.updatedAt));

  const rows = await query;

  // Filter by connectionId if provided
  let filteredRows = rows;
  if (connectionId !== undefined && connectionId !== null) {
    filteredRows = rows.filter(row => 
      row.connectionId === connectionId || row.connectionId === null
    );
  }

  return filteredRows.map(toResponse);
}

/**
 * Get a single saved query by ID
 */
export async function getSavedQueryById(
  id: string,
  userId: string
): Promise<SavedQueryResponse | null> {
  const db = getDatabase();
  const schema = getSchema();

  const rows = await db
    .select()
    .from(schema.savedQueries)
    .where(
      and(
        eq(schema.savedQueries.id, id),
        or(
          eq(schema.savedQueries.userId, userId),
          eq(schema.savedQueries.isPublic, true)
        )
      )
    )
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  return toResponse(rows[0]);
}

/**
 * Create a new saved query
 * connectionId is optional - null means shared across all connections
 */
export async function createSavedQuery(
  userId: string,
  input: SavedQueryInput
): Promise<SavedQueryResponse> {
  const db = getDatabase();
  const schema = getSchema();

  const id = randomUUID();
  const now = new Date();

  const newQuery = {
    id,
    userId,
    connectionId: input.connectionId ?? null,
    connectionName: input.connectionName ?? null,
    name: input.name,
    query: input.query,
    description: input.description ?? null,
    isPublic: input.isPublic ?? false,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(schema.savedQueries).values(newQuery as typeof schema.savedQueries.$inferInsert);

  return toResponse(newQuery);
}

/**
 * Update an existing saved query
 * Only the owner can update the query
 */
export async function updateSavedQuery(
  id: string,
  userId: string,
  input: Partial<SavedQueryInput>
): Promise<SavedQueryResponse | null> {
  const db = getDatabase();
  const schema = getSchema();

  // First check if the query exists and belongs to the user
  const existing = await db
    .select()
    .from(schema.savedQueries)
    .where(
      and(
        eq(schema.savedQueries.id, id),
        eq(schema.savedQueries.userId, userId)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    return null;
  }

  const now = new Date();

  const updateData: Record<string, unknown> = {
    updatedAt: now,
  };

  if (input.name !== undefined) {
    updateData.name = input.name;
  }
  if (input.query !== undefined) {
    updateData.query = input.query;
  }
  if (input.description !== undefined) {
    updateData.description = input.description;
  }
  if (input.isPublic !== undefined) {
    updateData.isPublic = input.isPublic;
  }
  if (input.connectionId !== undefined) {
    updateData.connectionId = input.connectionId;
  }
  if (input.connectionName !== undefined) {
    updateData.connectionName = input.connectionName;
  }

  await db
    .update(schema.savedQueries)
    .set(updateData)
    .where(
      and(
        eq(schema.savedQueries.id, id),
        eq(schema.savedQueries.userId, userId)
      )
    );

  // Fetch and return the updated query
  const updated = await db
    .select()
    .from(schema.savedQueries)
    .where(eq(schema.savedQueries.id, id))
    .limit(1);

  if (updated.length === 0) {
    return null;
  }

  return toResponse(updated[0]);
}

/**
 * Delete a saved query
 * Only the owner can delete the query
 */
export async function deleteSavedQuery(
  id: string,
  userId: string
): Promise<boolean> {
  const db = getDatabase();
  const schema = getSchema();

  // Check if the query exists and belongs to the user
  const existing = await db
    .select()
    .from(schema.savedQueries)
    .where(
      and(
        eq(schema.savedQueries.id, id),
        eq(schema.savedQueries.userId, userId)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    return false;
  }

  await db
    .delete(schema.savedQueries)
    .where(
      and(
        eq(schema.savedQueries.id, id),
        eq(schema.savedQueries.userId, userId)
      )
    );

  return true;
}

/**
 * Get count of saved queries for a user
 */
export async function getSavedQueryCount(userId: string): Promise<number> {
  const db = getDatabase();
  const schema = getSchema();

  const rows = await db
    .select()
    .from(schema.savedQueries)
    .where(eq(schema.savedQueries.userId, userId));

  return rows.length;
}

/**
 * Get unique connection names from user's saved queries
 * Used for the connection filter dropdown
 */
export async function getQueryConnectionNames(userId: string): Promise<string[]> {
  const db = getDatabase();
  const schema = getSchema();

  const rows = await db
    .select({ connectionName: schema.savedQueries.connectionName })
    .from(schema.savedQueries)
    .where(eq(schema.savedQueries.userId, userId));

  const uniqueNames = new Set<string>();
  rows.forEach(row => {
    if (row.connectionName) {
      uniqueNames.add(row.connectionName);
    }
  });

  return Array.from(uniqueNames).sort();
}
