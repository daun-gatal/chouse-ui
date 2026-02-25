/**
 * AI Models Routes
 * 
 * API endpoints for managing AI base Models.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
    createAiModel,
    getAiModelById,
    listAiModels,
    updateAiModel,
    deleteAiModel,
} from '../services/aiModels';
import { rbacAuthMiddleware, requirePermission, getRbacUser, getClientIp } from '../middleware';
import { createAuditLog } from '../services/rbac';
import { AUDIT_ACTIONS, PERMISSIONS } from '../schema/base';

const aiModelsRoutes = new Hono();

const createModelSchema = z.object({
    providerId: z.string().min(1),
    name: z.string().min(1).max(255),
    modelId: z.string().min(1).max(255),
});

const updateModelSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    modelId: z.string().min(1).max(255).optional(),
});

aiModelsRoutes.get(
    '/',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_VIEW),
    zValidator('query', z.object({ providerId: z.string().optional() })),
    async (c) => {
        try {
            const query = c.req.valid('query');
            const results = await listAiModels(query.providerId);
            return c.json({ success: true, data: results });
        } catch (error) {
            console.error('[AI Models] List error:', error);
            return c.json({ success: false, error: { code: 'LIST_FAILED', message: error instanceof Error ? error.message : 'Failed to list models' } }, 500);
        }
    }
);

aiModelsRoutes.get(
    '/:id',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_VIEW),
    async (c) => {
        try {
            const id = c.req.param('id');
            const model = await getAiModelById(id);
            if (!model) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Model not found' } }, 404);
            return c.json({ success: true, data: model });
        } catch (error) {
            return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch model' } }, 500);
        }
    }
);

aiModelsRoutes.post(
    '/',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_CREATE),
    zValidator('json', createModelSchema),
    async (c) => {
        try {
            const user = getRbacUser(c);
            const input = c.req.valid('json');
            const model = await createAiModel(input);

            await createAuditLog(AUDIT_ACTIONS.SETTINGS_UPDATE, user.sub, {
                resourceType: 'ai_base_model',
                resourceId: model.id,
                details: { operation: 'create', name: model.name, modelId: model.modelId },
                ipAddress: getClientIp(c),
                userAgent: c.req.header('User-Agent'),
            });
            return c.json({ success: true, data: model }, 201);
        } catch (error) {
            return c.json({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create model' } }, 500);
        }
    }
);

aiModelsRoutes.patch(
    '/:id',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_UPDATE),
    zValidator('json', updateModelSchema),
    async (c) => {
        try {
            const user = getRbacUser(c);
            const id = c.req.param('id');
            const input = c.req.valid('json');

            const model = await updateAiModel(id, input);
            if (!model) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Model not found' } }, 404);

            await createAuditLog(AUDIT_ACTIONS.SETTINGS_UPDATE, user.sub, {
                resourceType: 'ai_base_model',
                resourceId: model.id,
                details: { operation: 'update', changes: Object.keys(input) },
                ipAddress: getClientIp(c),
                userAgent: c.req.header('User-Agent'),
            });
            return c.json({ success: true, data: model });
        } catch (error) {
            return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update model' } }, 500);
        }
    }
);

aiModelsRoutes.delete(
    '/:id',
    rbacAuthMiddleware,
    requirePermission(PERMISSIONS.AI_MODELS_DELETE),
    async (c) => {
        try {
            const user = getRbacUser(c);
            const id = c.req.param('id');
            const deleted = await deleteAiModel(id);
            if (!deleted) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Model not found' } }, 404);

            await createAuditLog(AUDIT_ACTIONS.SETTINGS_UPDATE, user.sub, {
                resourceType: 'ai_base_model',
                resourceId: id,
                details: { operation: 'delete' },
                ipAddress: getClientIp(c),
                userAgent: c.req.header('User-Agent'),
            });
            return c.json({ success: true, data: { deleted: true } });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete model';
            const status = message.includes('Cannot delete') ? 400 : 500;
            return c.json({ success: false, error: { code: 'DELETE_FAILED', message } }, status);
        }
    }
);

export default aiModelsRoutes;
