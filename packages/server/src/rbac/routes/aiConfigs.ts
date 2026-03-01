/**
 * AI Configs Routes
 * 
 * API endpoints for managing AI Configurations.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
    createAiConfig,
    getAiConfigById,
    listAiConfigs,
    updateAiConfig,
    deleteAiConfig,
    getDefaultAiConfig,
} from '../services/aiModels';
import { rbacAuthMiddleware, requirePermission, getRbacUser, getClientIp } from '../middleware';
import { createAuditLogWithContext } from '../services/rbac';
import { AUDIT_ACTIONS, PERMISSIONS } from '../schema/base';
import { requestLogger } from '../../utils/logger';

const aiConfigsRoutes = new Hono();

const createConfigSchema = z.object({
    modelId: z.string().min(1),
    name: z.string().min(1).max(255),
    isActive: z.boolean().default(true),
    isDefault: z.boolean().default(false),
});

const updateConfigSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
});

const listQuerySchema = z.object({
    search: z.string().optional(),
    activeOnly: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

// List all AI configs
aiConfigsRoutes.get(
    '/',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_VIEW),
    zValidator('query', listQuerySchema),
    async (c) => {
        try {
            const query = c.req.valid('query');
            const result = await listAiConfigs({
                search: query.search,
                activeOnly: query.activeOnly,
                limit: query.limit,
                offset: query.offset,
            });

            return c.json({
                success: true,
                data: {
                    configs: result.configs,
                    total: result.total,
                    limit: query.limit,
                    offset: query.offset,
                },
            });
        } catch (error) {
            requestLogger(c.get('requestId')).error({ module: 'AI Configs', err: error instanceof Error ? error.message : String(error) }, 'List error');
            return c.json({ success: false, error: { code: 'LIST_FAILED', message: 'Failed to list configs' } }, 500);
        }
    }
);

// Get default configuration
aiConfigsRoutes.get(
    '/default',
    rbacAuthMiddleware,
    async (c) => {
        try {
            const config = await getDefaultAiConfig();
            if (!config) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'No default config' } }, 404);
            const { apiKey, ...safeConfig } = config.provider;
            return c.json({ success: true, data: { ...config, provider: safeConfig } });
        } catch (error) {
            return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch default' } }, 500);
        }
    }
);

// Get active configurations (for the frontend selector)
aiConfigsRoutes.get(
    '/active',
    rbacAuthMiddleware,
    async (c) => {
        try {
            const result = await listAiConfigs({ activeOnly: true, limit: 100 });
            // Remove sensitive info just to be safe (it's not decrypted anyway here but provider object could be sensitive)
            const safeData = result.configs.map(cfg => ({ ...cfg }));
            return c.json({ success: true, data: safeData });
        } catch (error) {
            return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch active configs' } }, 500);
        }
    }
);

aiConfigsRoutes.get(
    '/:id',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_VIEW),
    async (c) => {
        try {
            const id = c.req.param('id');
            const config = await getAiConfigById(id);
            if (!config) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Config not found' } }, 404);
            return c.json({ success: true, data: config });
        } catch (error) {
            return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch config' } }, 500);
        }
    }
);

aiConfigsRoutes.post(
    '/',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_CREATE),
    zValidator('json', createConfigSchema),
    async (c) => {
        try {
            const user = getRbacUser(c);
            const input = c.req.valid('json');
            const config = await createAiConfig(input, user.sub);

            await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_CONFIG_CREATE, user.sub, {
                resourceType: 'ai_config',
                resourceId: config.id,
                details: { operation: 'create', name: config.name },
                ipAddress: getClientIp(c),
            });
            return c.json({ success: true, data: config }, 201);
        } catch (error) {
            requestLogger(c.get('requestId')).error({ module: 'AI Configs', err: error instanceof Error ? error.message : String(error) }, 'Create error');
            const errorMessage = error instanceof Error ? error.message : 'Failed to create config';
            const statusCode = errorMessage.includes('inactive') ? 400 : 500;
            return c.json({ success: false, error: { code: 'CREATE_FAILED', message: errorMessage } }, statusCode);
        }
    }
);

aiConfigsRoutes.patch(
    '/:id',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_UPDATE),
    zValidator('json', updateConfigSchema),
    async (c) => {
        try {
            const user = getRbacUser(c);
            const id = c.req.param('id');
            const input = c.req.valid('json');

            const config = await updateAiConfig(id, input);
            if (!config) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Config not found' } }, 404);

            await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_CONFIG_UPDATE, user.sub, {
                resourceType: 'ai_config',
                resourceId: config.id,
                details: { operation: 'update', changes: Object.keys(input) },
                ipAddress: getClientIp(c),
            });
            return c.json({ success: true, data: config });
        } catch (error) {
            requestLogger(c.get('requestId')).error({ module: 'AI Configs', err: error instanceof Error ? error.message : String(error) }, 'Update error');
            const errorMessage = error instanceof Error ? error.message : 'Failed to update config';
            const statusCode = errorMessage.includes('inactive') ? 400 : 500;
            return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: errorMessage } }, statusCode);
        }
    }
);

aiConfigsRoutes.delete(
    '/:id',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_DELETE),
    async (c) => {
        try {
            const user = getRbacUser(c);
            const id = c.req.param('id');
            const deleted = await deleteAiConfig(id);
            if (!deleted) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Config not found' } }, 404);

            await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_CONFIG_DELETE, user.sub, {
                resourceType: 'ai_config',
                resourceId: id,
                details: { operation: 'delete' },
                ipAddress: getClientIp(c),
            });
            return c.json({ success: true, data: { deleted: true } });
        } catch (error) {
            return c.json({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete config' } }, 500);
        }
    }
);

export default aiConfigsRoutes;
