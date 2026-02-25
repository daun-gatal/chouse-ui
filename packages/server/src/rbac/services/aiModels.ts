/**
 * AI Models Service
 * 
 * Manages AI Providers, Models, and Configurations with encrypted API key storage.
 */

import { eq, and, desc, asc, like, or, sql, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDatabase, getSchema } from '../db';
import { encryptPassword, decryptPassword } from './connections';
import { ProviderType, isValidProviderType } from '../constants/aiProviders';

// Type helper for working with dual database setup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

import type { AiProvider, AiModel, AiConfig } from '../schema';

// ============================================
// Types
// ============================================

export interface AiProviderResponse {
    id: string;
    name: string;
    providerType: ProviderType;
    baseUrl: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export interface AiProviderWithKey extends AiProviderResponse {
    apiKey: string | null;
}

export interface AiModelResponse {
    id: string;
    providerId: string;
    name: string;
    modelId: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface AiConfigResponse {
    id: string;
    modelId: string;
    name: string;
    isActive: boolean;
    isDefault: boolean;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface AiConfigFullResponse extends AiConfigResponse {
    model: AiModelResponse;
    provider: AiProviderResponse;
}

export interface AiConfigWithKey extends AiConfigFullResponse {
    provider: AiProviderWithKey;
}

// ============================================
// Providers Management
// ============================================

export async function createAiProvider(
    input: { name: string; providerType: ProviderType; baseUrl?: string | null; apiKey?: string; isActive?: boolean }
): Promise<AiProviderResponse> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    const id = randomUUID();
    const now = new Date();

    // Validate providerType
    if (!isValidProviderType(input.providerType)) {
        throw new Error(`Invalid provider type: ${input.providerType}. Valid types are: ${['openai', 'anthropic', 'google', 'huggingface', 'openai-compatible'].join(', ')}`);
    }

    const apiKeyEncrypted = input.apiKey ? encryptPassword(input.apiKey) : null;

    await db.insert(schema.aiProviders).values({
        id,
        name: input.name,
        providerType: input.providerType,
        baseUrl: input.baseUrl || null,
        apiKeyEncrypted,
        isActive: input.isActive ?? true,
        createdAt: now,
        updatedAt: now,
    });

    const created = await getAiProviderById(id);
    if (!created) throw new Error("Failed to create provider");
    return created;
}

export async function getAiProviderById(id: string): Promise<AiProviderResponse | null> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    const results = await db.select()
        .from(schema.aiProviders)
        .where(eq(schema.aiProviders.id, id))
        .limit(1);

    if (results.length === 0) return null;

    const p = results[0];
    return {
        id: p.id,
        name: p.name,
        providerType: p.providerType as ProviderType,
        baseUrl: p.baseUrl,
        isActive: p.isActive ?? true,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
    };
}

export async function updateAiProvider(
    id: string,
    input: { name?: string; providerType?: ProviderType; baseUrl?: string | null; apiKey?: string; isActive?: boolean }
): Promise<AiProviderResponse | null> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    const now = new Date();

    // Validate providerType if provided
    if (input.providerType !== undefined && !isValidProviderType(input.providerType)) {
        throw new Error(`Invalid provider type: ${input.providerType}. Valid types are: ${['openai', 'anthropic', 'google', 'huggingface', 'openai-compatible'].join(', ')}`);
    }

    const updateData: Record<string, any> = { updatedAt: now };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.providerType !== undefined) updateData.providerType = input.providerType;
    if (input.baseUrl !== undefined) updateData.baseUrl = input.baseUrl;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;
    if (input.apiKey !== undefined) {
        updateData.apiKeyEncrypted = input.apiKey ? encryptPassword(input.apiKey) : null;
    }

    await db.update(schema.aiProviders)
        .set(updateData)
        .where(eq(schema.aiProviders.id, id));

    // Cascade deactivation to all configs when provider is deactivated
    if (input.isActive === false) {
        // Get all model IDs for this provider
        const models = await db.select({ id: schema.aiModels.id })
            .from(schema.aiModels)
            .where(eq(schema.aiModels.providerId, id));

        const modelIds = models.map((m: { id: string }) => m.id);

        if (modelIds.length > 0) {
            // Get all config IDs for these models
            const configs = await db.select({ id: schema.aiConfigs.id })
                .from(schema.aiConfigs)
                .where(inArray(schema.aiConfigs.modelId, modelIds));

            const configIds = configs.map((c: { id: string }) => c.id);

            if (configIds.length > 0) {
                // Deactivate all configs
                await db.update(schema.aiConfigs)
                    .set({ isActive: false, updatedAt: now })
                    .where(inArray(schema.aiConfigs.id, configIds));

                console.log(`[AI Models] Deactivated ${configIds.length} config(s) due to provider deactivation`);
            }
        }
    }

    return getAiProviderById(id);
}

export async function deleteAiProvider(id: string): Promise<boolean> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    // Prevent deletion if there are dependent models
    const dependentModels = await db.select().from(schema.aiModels).where(eq(schema.aiModels.providerId, id)).limit(1);
    if (dependentModels.length > 0) {
        throw new Error("Cannot delete provider because it has dependent models. Please delete them first.");
    }

    await db.delete(schema.aiProviders).where(eq(schema.aiProviders.id, id));
    return true;
}

export async function listAiProviders(): Promise<AiProviderResponse[]> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    const results = await db.select().from(schema.aiProviders).orderBy(asc(schema.aiProviders.name));
    return results.map((p: any) => ({
        id: p.id,
        name: p.name,
        providerType: p.providerType as ProviderType,
        baseUrl: p.baseUrl,
        isActive: p.isActive ?? true,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
    }));
}

// ============================================
// Models Management
// ============================================

export async function createAiModel(
    input: { providerId: string; name: string; modelId: string }
): Promise<AiModelResponse> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    const id = randomUUID();
    const now = new Date();

    await db.insert(schema.aiModels).values({
        id,
        providerId: input.providerId,
        name: input.name,
        modelId: input.modelId,
        createdAt: now,
        updatedAt: now,
    });

    const m = await getAiModelById(id);
    if (!m) throw new Error("Failed to create model");
    return m;
}

export async function getAiModelById(id: string): Promise<AiModelResponse | null> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    const results = await db.select()
        .from(schema.aiModels)
        .where(eq(schema.aiModels.id, id))
        .limit(1);

    if (results.length === 0) return null;

    const m = results[0];
    return {
        id: m.id,
        providerId: m.providerId,
        name: m.name,
        modelId: m.modelId,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
    };
}

export async function updateAiModel(
    id: string,
    input: { name?: string; modelId?: string }
): Promise<AiModelResponse | null> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    const now = new Date();

    const updateData: Record<string, any> = { updatedAt: now };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.modelId !== undefined) updateData.modelId = input.modelId;

    await db.update(schema.aiModels).set(updateData).where(eq(schema.aiModels.id, id));
    return getAiModelById(id);
}

export async function deleteAiModel(id: string): Promise<boolean> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    // Prevent deletion if there are dependent configs
    const dependentConfigs = await db.select().from(schema.aiConfigs).where(eq(schema.aiConfigs.modelId, id)).limit(1);
    if (dependentConfigs.length > 0) {
        throw new Error("Cannot delete model because it has dependent configurations. Please delete them first.");
    }

    await db.delete(schema.aiModels).where(eq(schema.aiModels.id, id));
    return true;
}

export async function listAiModels(providerId?: string): Promise<AiModelResponse[]> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    let query = db.select().from(schema.aiModels);
    if (providerId) {
        query = query.where(eq(schema.aiModels.providerId, providerId));
    }
    const results = await query.orderBy(asc(schema.aiModels.name));

    return results.map((m: any) => ({
        id: m.id,
        providerId: m.providerId,
        name: m.name,
        modelId: m.modelId,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
    }));
}

// ============================================
// Configs Management
// ============================================

export async function createAiConfig(
    input: { modelId: string; name: string; isActive?: boolean; isDefault?: boolean },
    createdBy?: string
): Promise<AiConfigResponse> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    const id = randomUUID();
    const now = new Date();

    // Validate: Cannot create active config if provider is inactive
    const isActive = input.isActive ?? true;
    if (isActive) {
        // Get model's provider info via join
        const modelWithProvider = await db.select({
            model: schema.aiModels,
            provider: schema.aiProviders
        })
            .from(schema.aiModels)
            .innerJoin(schema.aiProviders, eq(schema.aiModels.providerId, schema.aiProviders.id))
            .where(eq(schema.aiModels.id, input.modelId))
            .limit(1);

        if (modelWithProvider.length === 0) {
            throw new Error(`Model with id "${input.modelId}" not found`);
        }

        const provider = modelWithProvider[0].provider;
        if (!provider.isActive) {
            throw new Error(`Cannot create active config because the provider "${provider.name}" is inactive. Please activate the provider first or create the config as inactive.`);
        }
    }

    // Handle isDefault logic
    if (input.isDefault) {
        await db.update(schema.aiConfigs)
            .set({ isDefault: false, updatedAt: now })
            .where(eq(schema.aiConfigs.isDefault, true));
    }

    await db.insert(schema.aiConfigs).values({
        id,
        modelId: input.modelId,
        name: input.name,
        isActive,
        isDefault: input.isDefault ?? false,
        createdBy,
        createdAt: now,
        updatedAt: now,
    });

    const c = await getAiConfigById(id);
    if (!c) throw new Error("Failed to create config");
    return c;
}

export async function getAiConfigById(id: string): Promise<AiConfigResponse | null> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    const results = await db.select()
        .from(schema.aiConfigs)
        .where(eq(schema.aiConfigs.id, id))
        .limit(1);

    if (results.length === 0) return null;

    const c = results[0];
    return {
        id: c.id,
        modelId: c.modelId,
        name: c.name,
        isActive: c.isActive ?? true,
        isDefault: c.isDefault ?? false,
        createdBy: c.createdBy,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
    };
}

export async function updateAiConfig(
    id: string,
    input: { name?: string; isActive?: boolean; isDefault?: boolean }
): Promise<AiConfigResponse | null> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    const now = new Date();

    // Validate: Cannot activate config if provider is inactive
    if (input.isActive === true) {
        // Get config's model and provider info via join
        const configWithProvider = await db.select({
            config: schema.aiConfigs,
            model: schema.aiModels,
            provider: schema.aiProviders
        })
            .from(schema.aiConfigs)
            .innerJoin(schema.aiModels, eq(schema.aiConfigs.modelId, schema.aiModels.id))
            .innerJoin(schema.aiProviders, eq(schema.aiModels.providerId, schema.aiProviders.id))
            .where(eq(schema.aiConfigs.id, id))
            .limit(1);

        if (configWithProvider.length === 0) {
            return null; // Config not found
        }

        const provider = configWithProvider[0].provider;
        if (!provider.isActive) {
            throw new Error(`Cannot activate config because its provider "${provider.name}" is inactive. Please activate the provider first.`);
        }
    }

    const updateData: Record<string, any> = { updatedAt: now };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    if (input.isDefault === true) {
        await db.update(schema.aiConfigs)
            .set({ isDefault: false, updatedAt: now })
            .where(eq(schema.aiConfigs.isDefault, true));
        updateData.isDefault = true;
    } else if (input.isDefault === false) {
        updateData.isDefault = false;
    }

    await db.update(schema.aiConfigs).set(updateData).where(eq(schema.aiConfigs.id, id));
    return getAiConfigById(id);
}

export async function deleteAiConfig(id: string): Promise<boolean> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    await db.delete(schema.aiConfigs).where(eq(schema.aiConfigs.id, id));
    return true;
}

export async function listAiConfigs(options?: {
    activeOnly?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
}): Promise<{ configs: AiConfigFullResponse[]; total: number }> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    const conditions = [];

    if (options?.activeOnly) {
        conditions.push(eq(schema.aiConfigs.isActive, true));
    }

    if (options?.search) {
        conditions.push(
            like(schema.aiConfigs.name, `%${options.search}%`)
            // To properly search across joins we'd need nested queries, keeping it simple for now
        );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(schema.aiConfigs)
        .where(whereClause);

    const total = Number(countResult[0]?.count || 0);

    // Build the query via joins
    let query = db.select({
        config: schema.aiConfigs,
        model: schema.aiModels,
        provider: schema.aiProviders
    })
        .from(schema.aiConfigs)
        .innerJoin(schema.aiModels, eq(schema.aiConfigs.modelId, schema.aiModels.id))
        .innerJoin(schema.aiProviders, eq(schema.aiModels.providerId, schema.aiProviders.id))
        .where(whereClause)
        .orderBy(desc(schema.aiConfigs.isDefault), asc(schema.aiConfigs.name));

    if (options?.limit) {
        query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
        query = query.offset(options.offset) as typeof query;
    }

    const results = await query;

    const configs: AiConfigFullResponse[] = results.map((row: any) => ({
        id: row.config.id,
        modelId: row.config.modelId,
        name: row.config.name,
        isActive: row.config.isActive ?? true,
        isDefault: row.config.isDefault ?? false,
        createdBy: row.config.createdBy,
        createdAt: row.config.createdAt,
        updatedAt: row.config.updatedAt,
        model: {
            id: row.model.id,
            providerId: row.model.providerId,
            name: row.model.name,
            modelId: row.model.modelId,
            createdAt: row.model.createdAt,
            updatedAt: row.model.updatedAt,
        },
        provider: {
            id: row.provider.id,
            name: row.provider.name,
            providerType: row.provider.providerType as ProviderType,
            baseUrl: row.provider.baseUrl,
            isActive: row.provider.isActive ?? true,
            createdAt: row.provider.createdAt,
            updatedAt: row.provider.updatedAt,
        }
    }));

    return { configs, total };
}

/**
 * Get the full AI Config with Decrypted provider key
 * Used for AI generation
 */
export async function getAiConfigWithKey(id: string): Promise<AiConfigWithKey | null> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    const results = await db.select({
        config: schema.aiConfigs,
        model: schema.aiModels,
        provider: schema.aiProviders
    })
        .from(schema.aiConfigs)
        .innerJoin(schema.aiModels, eq(schema.aiConfigs.modelId, schema.aiModels.id))
        .innerJoin(schema.aiProviders, eq(schema.aiModels.providerId, schema.aiProviders.id))
        .where(eq(schema.aiConfigs.id, id))
        .limit(1);

    if (results.length === 0) return null;

    const row = results[0];

    let apiKey: string | null = null;
    if (row.provider.apiKeyEncrypted) {
        try {
            apiKey = decryptPassword(row.provider.apiKeyEncrypted);
        } catch (error) {
            console.error(`Failed to decrypt API key for AI provider ${row.provider.id}:`, error);
            throw new Error(`Failed to decrypt API key for AI provider ${row.provider.id}`);
        }
    }

    return {
        id: row.config.id,
        modelId: row.config.modelId,
        name: row.config.name,
        isActive: row.config.isActive ?? true,
        isDefault: row.config.isDefault ?? false,
        createdBy: row.config.createdBy,
        createdAt: row.config.createdAt,
        updatedAt: row.config.updatedAt,
        model: {
            id: row.model.id,
            providerId: row.model.providerId,
            name: row.model.name,
            modelId: row.model.modelId,
            createdAt: row.model.createdAt,
            updatedAt: row.model.updatedAt,
        },
        provider: {
            id: row.provider.id,
            name: row.provider.name,
            providerType: row.provider.providerType as ProviderType,
            baseUrl: row.provider.baseUrl,
            isActive: row.provider.isActive ?? true,
            apiKey,
            createdAt: row.provider.createdAt,
            updatedAt: row.provider.updatedAt,
        }
    };
}

export async function getDefaultAiConfig(): Promise<AiConfigWithKey | null> {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();

    // First try explicitly default + active
    let results = await db.select()
        .from(schema.aiConfigs)
        .where(and(
            eq(schema.aiConfigs.isDefault, true),
            eq(schema.aiConfigs.isActive, true)
        ))
        .limit(1);

    // Fallup to any active config
    if (results.length === 0) {
        results = await db.select()
            .from(schema.aiConfigs)
            .where(eq(schema.aiConfigs.isActive, true))
            .orderBy(asc(schema.aiConfigs.createdAt))
            .limit(1);
    }

    if (results.length === 0) return null;

    return getAiConfigWithKey(results[0].id);
}
