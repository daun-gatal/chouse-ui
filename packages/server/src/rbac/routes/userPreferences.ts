/**
 * User Preferences Routes
 * 
 * Handles user-specific UI preferences, favorites, and recent items.
 * All routes require authentication and are scoped to the authenticated user.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  getUserFavorites,
  addUserFavorite,
  removeUserFavorite,
  clearUserFavorites,
  isUserFavorite,
  getUserRecentItems,
  addUserRecentItem,
  clearUserRecentItems,
  getUserPreferences,
  updateUserPreferences,
} from '../services/userPreferences';
import { rbacAuthMiddleware, getRbacUser } from '../middleware/rbacAuth';
import { AppError } from '../../types';

const userPreferencesRoutes = new Hono();

// Apply authentication middleware to all routes
userPreferencesRoutes.use('*', rbacAuthMiddleware);

// ============================================
// Favorites
// ============================================

/**
 * GET /favorites
 * Get all favorites for the authenticated user
 */
userPreferencesRoutes.get('/favorites', async (c) => {
  const user = getRbacUser(c);
  const favorites = await getUserFavorites(user.sub);
  return c.json({ favorites });
});

/**
 * POST /favorites
 * Add a favorite for the authenticated user
 */
userPreferencesRoutes.post(
  '/favorites',
  zValidator('json', z.object({
    database: z.string().min(1),
    table: z.string().optional(),
  })),
  async (c) => {
    const user = getRbacUser(c);
    const { database, table } = c.req.valid('json');
    
    const favorite = await addUserFavorite(user.sub, database, table);
    return c.json({ favorite }, 201);
  }
);

/**
 * DELETE /favorites/:id
 * Remove a favorite for the authenticated user
 */
userPreferencesRoutes.delete('/favorites/:id', async (c) => {
  const user = getRbacUser(c);
  const favoriteId = c.req.param('id');
  
  const deleted = await removeUserFavorite(user.sub, favoriteId);
  if (!deleted) {
    throw AppError.notFound('Favorite not found');
  }
  
  return c.json({ success: true });
});

/**
 * DELETE /favorites
 * Clear all favorites for the authenticated user
 */
userPreferencesRoutes.delete('/favorites', async (c) => {
  const user = getRbacUser(c);
  await clearUserFavorites(user.sub);
  return c.json({ success: true });
});

/**
 * GET /favorites/check
 * Check if a database/table is favorited
 */
userPreferencesRoutes.get(
  '/favorites/check',
  zValidator('query', z.object({
    database: z.string().min(1),
    table: z.string().optional(),
  })),
  async (c) => {
    const user = getRbacUser(c);
    const { database, table } = c.req.valid('query');
    
    const isFav = await isUserFavorite(user.sub, database, table);
    return c.json({ isFavorite: isFav });
  }
);

// ============================================
// Recent Items
// ============================================

/**
 * GET /recent
 * Get recent items for the authenticated user
 */
userPreferencesRoutes.get(
  '/recent',
  zValidator('query', z.object({
    limit: z.string().optional().transform((val) => val ? parseInt(val, 10) : 10),
  }).optional()),
  async (c) => {
    const user = getRbacUser(c);
    const limit = c.req.valid('query')?.limit || 10;
    
    const recentItems = await getUserRecentItems(user.sub, limit);
    return c.json({ recentItems });
  }
);

/**
 * POST /recent
 * Add a recent item for the authenticated user
 */
userPreferencesRoutes.post(
  '/recent',
  zValidator('json', z.object({
    database: z.string().min(1),
    table: z.string().optional(),
  })),
  async (c) => {
    const user = getRbacUser(c);
    const { database, table } = c.req.valid('json');
    
    const recentItem = await addUserRecentItem(user.sub, database, table);
    return c.json({ recentItem }, 201);
  }
);

/**
 * DELETE /recent
 * Clear all recent items for the authenticated user
 */
userPreferencesRoutes.delete('/recent', async (c) => {
  const user = getRbacUser(c);
  await clearUserRecentItems(user.sub);
  return c.json({ success: true });
});

// ============================================
// Preferences
// ============================================

/**
 * GET /preferences
 * Get user preferences
 */
userPreferencesRoutes.get('/preferences', async (c) => {
  const user = getRbacUser(c);
  const preferences = await getUserPreferences(user.sub);
  return c.json({ preferences });
});

/**
 * PUT /preferences
 * Update user preferences
 */
userPreferencesRoutes.put(
  '/preferences',
  zValidator('json', z.object({
    explorerSortBy: z.enum(['name', 'date', 'size']).optional(),
    explorerViewMode: z.enum(['tree', 'list', 'compact']).optional(),
    explorerShowFavoritesOnly: z.boolean().optional(),
    workspacePreferences: z.record(z.unknown()).optional(),
  })),
  async (c) => {
    const user = getRbacUser(c);
    const preferences = c.req.valid('json');
    
    const updated = await updateUserPreferences(user.sub, preferences);
    return c.json({ preferences: updated });
  }
);

export default userPreferencesRoutes;
