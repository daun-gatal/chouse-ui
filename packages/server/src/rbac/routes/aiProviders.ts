/**
 * AI Providers Routes
 * 
 * API endpoints for managing AI Providers.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
    createAiProvider,
    getAiProviderById,
    listAiProviders,
    updateAiProvider,
    deleteAiProvider,
} from '../services/aiModels';
import { rbacAuthMiddleware, requirePermission, getRbacUser, getClientIp } from '../middleware';
import { createAuditLogWithContext } from '../services/rbac';
import { AUDIT_ACTIONS, PERMISSIONS } from '../schema/base';
import { PROVIDER_TYPES, type ProviderType } from '../constants/aiProviders';
import { requestLogger } from '../../utils/logger';

const aiProvidersRoutes = new Hono();

const createProviderSchema = z.object({
    name: z.string().min(1).max(255),
    providerType: z.enum(PROVIDER_TYPES as unknown as [string, ...string[]]),
    baseUrl: z.string().url().optional().nullable(),
    apiKey: z.string().optional(),
    isActive: z.boolean().default(true),
});

const updateProviderSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    providerType: z.enum(PROVIDER_TYPES as unknown as [string, ...string[]]).optional(),
    baseUrl: z.string().url().optional().nullable(),
    apiKey: z.string().optional(),
    isActive: z.boolean().optional(),
});

aiProvidersRoutes.get(
    '/',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_VIEW),
    async (c) => {
        try {
            const results = await listAiProviders();
            return c.json({ success: true, data: results });
        } catch (error) {
            requestLogger(c.get('requestId')).error({ module: 'AI Providers', err: error instanceof Error ? error.message : String(error) }, 'List error');
            return c.json({ success: false, error: { code: 'LIST_FAILED', message: error instanceof Error ? error.message : 'Failed to list AI providers' } }, 500);
        }
    }
);

aiProvidersRoutes.get(
    '/:id',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_VIEW),
    async (c) => {
        try {
            const id = c.req.param('id');
            const provider = await getAiProviderById(id);
            if (!provider) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } }, 404);
            return c.json({ success: true, data: provider });
        } catch (error) {
            return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch provider' } }, 500);
        }
    }
);

aiProvidersRoutes.post(
    '/',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_CREATE),
    zValidator('json', createProviderSchema),
    async (c) => {
        try {
            const user = getRbacUser(c);
            const input = c.req.valid('json');
            const provider = await createAiProvider({
                ...input,
                providerType: input.providerType as ProviderType,
            });

            await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_PROVIDER_CREATE, user.sub, {
                resourceType: 'ai_provider',
                resourceId: provider.id,
                details: { operation: 'create', name: provider.name, providerType: provider.providerType },
                ipAddress: getClientIp(c),
            });
            return c.json({ success: true, data: provider }, 201);
        } catch (error) {
            requestLogger(c.get('requestId')).error({ module: 'AI Providers', err: error instanceof Error ? error.message : String(error) }, 'Create error');
            return c.json({ success: false, error: { code: 'CREATE_FAILED', message: error instanceof Error ? error.message : 'Failed to create provider' } }, 500);
        }
    }
);

aiProvidersRoutes.patch(
    '/:id',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_UPDATE),
    zValidator('json', updateProviderSchema),
    async (c) => {
        try {
            const user = getRbacUser(c);
            const id = c.req.param('id');
            const input = c.req.valid('json');

            const updateInput: Parameters<typeof updateAiProvider>[1] = {
                ...(input.name !== undefined && { name: input.name }),
                ...(input.providerType !== undefined && { providerType: input.providerType as ProviderType }),
                ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
                ...(input.apiKey !== undefined && { apiKey: input.apiKey }),
                ...(input.isActive !== undefined && { isActive: input.isActive }),
            };

            const provider = await updateAiProvider(id, updateInput);
            if (!provider) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } }, 404);

            await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_PROVIDER_UPDATE, user.sub, {
                resourceType: 'ai_provider',
                resourceId: provider.id,
                details: { operation: 'update', changes: Object.keys(input).filter(k => k !== 'apiKey') },
                ipAddress: getClientIp(c),
            });
            return c.json({ success: true, data: provider });
        } catch (error) {
            requestLogger(c.get('requestId')).error({ module: 'AI Providers', err: error instanceof Error ? error.message : String(error) }, 'Update error');
            return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: error instanceof Error ? error.message : 'Failed to update provider' } }, 500);
        }
    }
);

aiProvidersRoutes.delete(
    '/:id',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_DELETE),
    async (c) => {
        try {
            const user = getRbacUser(c);
            const id = c.req.param('id');
            const deleted = await deleteAiProvider(id);
            if (!deleted) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } }, 404);

            await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_PROVIDER_DELETE, user.sub, {
                resourceType: 'ai_provider',
                resourceId: id,
                details: { operation: 'delete' },
                ipAddress: getClientIp(c),
            });
            return c.json({ success: true, data: { deleted: true } });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete provider';
            const status = message.includes('Cannot delete') ? 400 : 500;
            return c.json({ success: false, error: { code: 'DELETE_FAILED', message } }, status);
        }
    }
);

export default aiProvidersRoutes;
