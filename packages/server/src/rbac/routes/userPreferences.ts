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
  getUserOnboardingProgress,
  updateUserOnboardingProgress,
} from '../services/userPreferences';
import { getUserById, completeBootstrapOnboarding } from '../services/rbac';
import { getUserConnections, listConnections } from '../services/connections';
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
    connectionId: z.string().optional().nullable(),
    connectionName: z.string().optional().nullable(),
  })),
  async (c) => {
    const user = getRbacUser(c);
    const { database, table, connectionId, connectionName } = c.req.valid('json');
    
    const favorite = await addUserFavorite(user.sub, database, table, connectionId, connectionName);
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
    connectionId: z.string().optional(),
  })),
  async (c) => {
    const user = getRbacUser(c);
    const { database, table, connectionId } = c.req.valid('query');
    
    const isFav = await isUserFavorite(user.sub, database, table, connectionId);
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
    connectionId: z.string().optional().nullable(),
    connectionName: z.string().optional().nullable(),
  })),
  async (c) => {
    const user = getRbacUser(c);
    const { database, table, connectionId, connectionName } = c.req.valid('json');
    
    const recentItem = await addUserRecentItem(user.sub, database, table, connectionId, connectionName);
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

const OnboardingPatchSchema = z.object({
  welcomeSeen: z.boolean().optional(),
  completedChapterIds: z.array(z.string().min(1).max(100)).max(128).optional(),
  dismissedChapterIds: z.array(z.string().min(1).max(100)).max(128).optional(),
  lastChapterId: z.string().min(1).max(100).nullable().optional(),
  lastStepId: z.string().min(1).max(100).nullable().optional(),
  lastStepIndex: z.number().int().min(0).max(1000).optional(),
  completedAt: z.string().datetime().nullable().optional(),
  bootstrapComplete: z.boolean().optional(),
});

/** GET /preferences/onboarding — resumable progress and fresh-install context. */
userPreferencesRoutes.get('/preferences/onboarding', async (c) => {
  const user = getRbacUser(c);
  const [progress, fullUser] = await Promise.all([
    getUserOnboardingProgress(user.sub),
    getUserById(user.sub),
  ]);
  if (!fullUser) throw AppError.notFound('User not found');

  return c.json({
    progress,
    bootstrapOnboardingPending: fullUser.bootstrapOnboardingPending,
    requiresPasswordChange: fullUser.requiresPasswordChange,
  });
});

/** PATCH /preferences/onboarding — merge only the onboarding preference key. */
userPreferencesRoutes.patch(
  '/preferences/onboarding',
  zValidator('json', OnboardingPatchSchema),
  async (c) => {
    const user = getRbacUser(c);
    const { bootstrapComplete, ...progressPatch } = c.req.valid('json');
    const hasProgressPatch = Object.keys(progressPatch).length > 0;

    if (bootstrapComplete) {
      const [connections, fullUser] = await Promise.all([
        user.roles.includes('super_admin')
          ? listConnections({ activeOnly: true }).then((result) => result.connections)
          : getUserConnections(user.sub),
        getUserById(user.sub),
      ]);
      if (!fullUser) throw AppError.notFound('User not found');
      if (connections.length === 0) {
        throw AppError.badRequest('Add a ClickHouse connection before completing setup');
      }
      if (fullUser.requiresPasswordChange) {
        throw AppError.badRequest('Change the bootstrap administrator password before completing setup');
      }

      const progress = hasProgressPatch
        ? await updateUserOnboardingProgress(user.sub, progressPatch)
        : await getUserOnboardingProgress(user.sub);

      // Commit bootstrap metadata last so a successful commit is never followed by
      // another fallible database operation that could turn the response into an error.
      await completeBootstrapOnboarding(user.sub);

      return c.json({
        progress,
        bootstrapOnboardingPending: false,
        requiresPasswordChange: false,
      });
    }

    const [progress, fullUser] = await Promise.all([
      hasProgressPatch
        ? updateUserOnboardingProgress(user.sub, progressPatch)
        : getUserOnboardingProgress(user.sub),
      getUserById(user.sub),
    ]);
    if (!fullUser) throw AppError.notFound('User not found');

    return c.json({
      progress,
      bootstrapOnboardingPending: fullUser.bootstrapOnboardingPending,
      requiresPasswordChange: fullUser.requiresPasswordChange,
    });
  },
);

export default userPreferencesRoutes;
