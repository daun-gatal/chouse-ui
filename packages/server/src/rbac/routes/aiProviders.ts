/**
 * AI Providers Routes
 * 
 * API endpoints for managing AI Providers.
 */

import { Hono } from 'hono';
import { requireParam } from "../../types";
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

// Bedrock has no single API key; the route packs these three fields into a
// JSON string stored in the encrypted api_key_encrypted slot (no schema change).
const AWS_CREDENTIAL_FIELDS = ['awsRegion', 'awsAccessKeyId', 'awsSecretAccessKey'] as const;

const awsCredentialShape = {
    awsRegion: z.string().min(1).max(255).optional(),
    awsAccessKeyId: z.string().min(1).max(255).optional(),
    awsSecretAccessKey: z.string().min(1).optional(),
};

function composeBedrockApiKey(input: { awsRegion?: string; awsAccessKeyId?: string; awsSecretAccessKey?: string }): string {
    return JSON.stringify({
        region: input.awsRegion,
        accessKeyId: input.awsAccessKeyId,
        secretAccessKey: input.awsSecretAccessKey,
    });
}

const createProviderSchema = z.object({
    name: z.string().min(1).max(255),
    providerType: z.enum(PROVIDER_TYPES as unknown as [string, ...string[]]),
    baseUrl: z.string().url().optional().nullable(),
    apiKey: z.string().optional(),
    isActive: z.boolean().default(true),
    ...awsCredentialShape,
}).superRefine((data, ctx) => {
    if (data.providerType === 'bedrock') {
        for (const field of AWS_CREDENTIAL_FIELDS) {
            if (!data[field]) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required for bedrock providers` });
            }
        }
        if (data.apiKey) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apiKey'], message: 'apiKey is not used for bedrock providers; supply AWS credentials instead' });
        }
    } else {
        for (const field of AWS_CREDENTIAL_FIELDS) {
            if (data[field] !== undefined) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is only valid for bedrock providers` });
            }
        }
    }
});

const updateProviderSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    providerType: z.enum(PROVIDER_TYPES as unknown as [string, ...string[]]).optional(),
    baseUrl: z.string().url().optional().nullable(),
    apiKey: z.string().optional(),
    isActive: z.boolean().optional(),
    ...awsCredentialShape,
}).superRefine((data, ctx) => {
    const provided = AWS_CREDENTIAL_FIELDS.filter((field) => data[field] !== undefined);
    if (provided.length > 0 && provided.length < AWS_CREDENTIAL_FIELDS.length) {
        for (const field of AWS_CREDENTIAL_FIELDS) {
            if (data[field] === undefined) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'AWS credential fields must be provided together' });
            }
        }
    }
    if (provided.length > 0 && data.apiKey !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apiKey'], message: 'apiKey cannot be combined with AWS credential fields' });
    }
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
            const id = requireParam(c, 'id');
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
            const { awsRegion, awsAccessKeyId, awsSecretAccessKey, ...providerInput } = input;
            const provider = await createAiProvider({
                ...providerInput,
                providerType: input.providerType as ProviderType,
                apiKey: input.providerType === 'bedrock'
                    ? composeBedrockApiKey(input)
                    : providerInput.apiKey,
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
            const id = requireParam(c, 'id');
            const input = c.req.valid('json');

            const hasAwsCredentials = input.awsRegion !== undefined;
            if (hasAwsCredentials) {
                const existing = await getAiProviderById(id);
                if (!existing) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } }, 404);
                const effectiveType = input.providerType ?? existing.providerType;
                if (effectiveType !== 'bedrock') {
                    return c.json({ success: false, error: { code: 'VALIDATION_FAILED', message: 'AWS credential fields are only valid for bedrock providers' } }, 400);
                }
            }

            const updateInput: Parameters<typeof updateAiProvider>[1] = {
                ...(input.name !== undefined && { name: input.name }),
                ...(input.providerType !== undefined && { providerType: input.providerType as ProviderType }),
                ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
                ...(input.apiKey !== undefined && { apiKey: input.apiKey }),
                ...(hasAwsCredentials && { apiKey: composeBedrockApiKey(input) }),
                ...(input.isActive !== undefined && { isActive: input.isActive }),
            };

            const provider = await updateAiProvider(id, updateInput);
            if (!provider) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } }, 404);

            await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_PROVIDER_UPDATE, user.sub, {
                resourceType: 'ai_provider',
                resourceId: provider.id,
                details: { operation: 'update', changes: Object.keys(input).filter(k => k !== 'apiKey' && !(AWS_CREDENTIAL_FIELDS as readonly string[]).includes(k)) },
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
            const id = requireParam(c, 'id');
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
