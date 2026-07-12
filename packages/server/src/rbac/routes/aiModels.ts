/**
 * AI Models Routes
 * 
 * API endpoints for managing AI base Models.
 */

import { Hono } from 'hono';
import { requireParam } from "../../types";
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
    createAiModel,
    getAiModelById,
    getAiProviderById,
    listAiModels,
    updateAiModel,
    deleteAiModel,
} from '../services/aiModels';
import { validateAiModelParams, type AiModelParams } from '../constants/aiModelParams';
import { rbacAuthMiddleware, requirePermission, getRbacUser, getClientIp } from '../middleware';
import { createAuditLogWithContext } from '../services/rbac';
import { AUDIT_ACTIONS, PERMISSIONS } from '../schema/base';
import { requestLogger } from '../../utils/logger';

const aiModelsRoutes = new Hono();

// Shape-level validation (provider-agnostic, widest bounds any provider accepts).
// Per-provider allowlists, tighter ranges, and cross-field rules run afterwards
// via validateAiModelParams once the provider type is known.
const aiModelParamsSchema = z.object({
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    topK: z.number().int().min(1).max(500).optional(),
    frequencyPenalty: z.number().min(-2).max(2).optional(),
    presencePenalty: z.number().min(-2).max(2).optional(),
    maxTokens: z.number().int().min(1).max(2_000_000).optional(),
    stopSequences: z.array(z.string().min(1).max(500)).max(10).optional(),
    verbosity: z.enum(['low', 'medium', 'high']).optional(),
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
    thinkingBudgetTokens: z.number().int().min(-1).max(128_000).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    requestTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
    apiVersion: z.string().min(1).max(32).optional(),
    safetySettings: z.array(z.object({ category: z.string().min(1), threshold: z.string().min(1) }).strict()).max(10).optional(),
    recursionLimit: z.number().int().min(8).max(1000).optional(),
    runTimeoutMs: z.number().int().min(10_000).max(3_600_000).optional(),
    extra: z.record(z.unknown()).optional(),
}).strict();

const createModelSchema = z.object({
    providerId: z.string().min(1),
    name: z.string().min(1).max(255),
    modelId: z.string().min(1).max(255),
    params: aiModelParamsSchema.nullable().optional(),
});

const updateModelSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    modelId: z.string().min(1).max(255).optional(),
    params: aiModelParamsSchema.nullable().optional(),
});

function invalidParamsResponse(errors: string[]): { success: false; error: { code: string; message: string } } {
    return { success: false, error: { code: 'INVALID_PARAMS', message: errors.join('; ') } };
}

function paramsAuditDetails(params: AiModelParams | null | undefined): Record<string, unknown> {
    if (params === null) return { paramsCleared: true };
    if (params === undefined) return {};
    return { paramsKeys: Object.keys(params) };
}

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
            requestLogger(c.get('requestId')).error({ module: 'AI Models', err: error instanceof Error ? error.message : String(error) }, 'List error');
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
            const id = requireParam(c, 'id');
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

            const provider = await getAiProviderById(input.providerId);
            if (!provider) {
                return c.json({ success: false, error: { code: 'INVALID_PROVIDER', message: 'Provider not found' } }, 400);
            }
            if (input.params) {
                const errors = validateAiModelParams(input.params, provider.providerType);
                if (errors.length > 0) return c.json(invalidParamsResponse(errors), 400);
            }

            const model = await createAiModel(input);

            await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_MODEL_CREATE, user.sub, {
                resourceType: 'ai_base_model',
                resourceId: model.id,
                details: { operation: 'create', name: model.name, modelId: model.modelId, ...paramsAuditDetails(input.params) },
                ipAddress: getClientIp(c),
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
            const id = requireParam(c, 'id');
            const input = c.req.valid('json');

            if (input.params) {
                const existing = await getAiModelById(id);
                if (!existing) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Model not found' } }, 404);
                const provider = await getAiProviderById(existing.providerId);
                if (!provider) {
                    return c.json({ success: false, error: { code: 'INVALID_PROVIDER', message: 'Provider not found' } }, 400);
                }
                const errors = validateAiModelParams(input.params, provider.providerType);
                if (errors.length > 0) return c.json(invalidParamsResponse(errors), 400);
            }

            const model = await updateAiModel(id, input);
            if (!model) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Model not found' } }, 404);

            await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_MODEL_UPDATE, user.sub, {
                resourceType: 'ai_base_model',
                resourceId: model.id,
                details: { operation: 'update', changes: Object.keys(input), ...paramsAuditDetails(input.params) },
                ipAddress: getClientIp(c),
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
            const id = requireParam(c, 'id');
            const deleted = await deleteAiModel(id);
            if (!deleted) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Model not found' } }, 404);

            await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_MODEL_DELETE, user.sub, {
                resourceType: 'ai_base_model',
                resourceId: id,
                details: { operation: 'delete' },
                ipAddress: getClientIp(c),
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
