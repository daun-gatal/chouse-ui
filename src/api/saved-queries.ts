/**
 * Saved Queries API
 * 
 * API functions for managing saved SQL queries.
 * Queries are scoped by user, with optional connection association.
 */

import { api } from './client';

// ============================================
// Types
// ============================================

export interface SavedQuery {
  id: string;
  userId: string;
  connectionId: string | null;
  connectionName: string | null;
  name: string;
  query: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveQueryInput {
  connectionId?: string | null;
  connectionName?: string | null;
  name: string;
  query: string;
  description?: string;
  isPublic?: boolean;
}

export interface UpdateQueryInput {
  name?: string;
  query?: string;
  description?: string;
  isPublic?: boolean;
  connectionId?: string | null;
  connectionName?: string | null;
}

// ============================================
// API Functions
// ============================================

/**
 * Get all saved queries for the current user
 * Optionally filter by connection ID
 * Returns user's own queries and public queries from other users
 */
export async function getSavedQueries(connectionId?: string): Promise<SavedQuery[]> {
  const params = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : '';
  return api.get<SavedQuery[]>(`/saved-queries${params}`);
}

/**
 * Get unique connection names from user's saved queries
 * Used for the connection filter dropdown
 */
export async function getQueryConnectionNames(): Promise<string[]> {
  return api.get<string[]>('/saved-queries/connections');
}

/**
 * Get a single saved query by ID
 */
export async function getSavedQueryById(id: string): Promise<SavedQuery> {
  return api.get<SavedQuery>(`/saved-queries/${id}`);
}

/**
 * Save a new query
 * connectionId is optional - null means shared across all connections
 */
export async function saveQuery(input: SaveQueryInput): Promise<SavedQuery> {
  return api.post('/saved-queries', input);
}

/**
 * Update an existing saved query
 */
export async function updateSavedQuery(
  id: string,
  input: UpdateQueryInput
): Promise<SavedQuery> {
  return api.put(`/saved-queries/${id}`, input);
}

/**
 * Delete a saved query
 */
export async function deleteSavedQuery(id: string): Promise<{ message: string }> {
  return api.delete(`/saved-queries/${id}`);
}
