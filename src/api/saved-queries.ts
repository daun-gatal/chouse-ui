/**
 * Saved Queries API
 */

import { api } from './client';

// ============================================
// Types
// ============================================

export interface SavedQuery {
  id: string;
  name: string;
  query: string;
  created_at: string;
  updated_at: string;
  owner: string;
  is_public: boolean;
}

export interface SaveQueryInput {
  id: string;
  name: string;
  query: string;
  isPublic?: boolean;
}

export interface UpdateQueryInput {
  name: string;
  query: string;
}

// ============================================
// API Functions
// ============================================

/**
 * Check if saved queries feature is enabled
 */
export async function checkSavedQueriesStatus(): Promise<boolean> {
  const response = await api.get<{ isEnabled: boolean }>('/saved-queries/status');
  return response.isEnabled;
}

/**
 * Activate saved queries feature (admin only)
 */
export async function activateSavedQueries(): Promise<{ message: string }> {
  return api.post('/saved-queries/activate');
}

/**
 * Deactivate saved queries feature (admin only)
 */
export async function deactivateSavedQueries(): Promise<{ message: string }> {
  return api.post('/saved-queries/deactivate');
}

/**
 * Get all saved queries
 */
export async function getSavedQueries(): Promise<SavedQuery[]> {
  return api.get<SavedQuery[]>('/saved-queries');
}

/**
 * Save a new query
 */
export async function saveQuery(input: SaveQueryInput): Promise<{ message: string }> {
  return api.post('/saved-queries', input);
}

/**
 * Update an existing saved query
 */
export async function updateSavedQuery(
  id: string,
  input: UpdateQueryInput
): Promise<{ message: string }> {
  return api.put(`/saved-queries/${id}`, input);
}

/**
 * Delete a saved query
 */
export async function deleteSavedQuery(id: string): Promise<{ message: string }> {
  return api.delete(`/saved-queries/${id}`);
}

