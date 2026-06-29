/**
 * AI Models Service
 * 
 * Manages AI Providers, Models, and Configurations with encrypted API key storage.
 */

import { eq, and, desc, asc, like, or, sql, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDatabase, getDatabaseType, getSchema } from '../db';
import { encryptPassword, decryptPassword } from './connections';
import { ProviderType, isValidProviderType } from '../constants/aiProviders';

// Type helper for working with dual database setup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

import type { AiProvider, AiModel, AiConfig } from '../schema';
import { logger } from '../../utils/logger';

export const AI_CAPABILITY_IDS = [
    "chat",
    "optimize-query",
    "debug-query",
    "check-optimize",
    "optimize-log",
    "diagnose-error",
    "diagnose-parts",
    "diagnose-schema",
    "fleet-scan",
] as const;

export type AiCapabilityId = typeof AI_CAPABILITY_IDS[number];

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

export interface AiConfigPolicyResponse {
    id: string;
    configId: string;
    capabilityId: AiCapabilityId;
    isEnabled: boolean;
    priority: number;
    temperature: number | null;
    maxOutputTokens: number | null;
    stopAtSteps: number | null;
    maxContextMessages: number | null;
    maxToolCalls: number | null;
    maxResultRows: number | null;
    maxRuntimeMs: number | null;
    providerOptions: Record<string, unknown> | null;
    fallbackConfigIds: string[];
    createdAt: Date;
    updatedAt: Date;
}

export interface AiConfigPolicyInput {
    capabilityId: AiCapabilityId;
    isEnabled?: boolean;
    priority?: number;
    temperature?: number | null;
    maxOutputTokens?: number | null;
    stopAtSteps?: number | null;
    maxContextMessages?: number | null;
    maxToolCalls?: number | null;
    maxResultRows?: number | null;
    maxRuntimeMs?: number | null;
    providerOptions?: Record<string, unknown> | null;
    fallbackConfigIds?: string[];
}

export interface AiConfigFullResponse extends AiConfigResponse {
    model: AiModelResponse;
    provider: AiProviderResponse;
    policies?: AiConfigPolicyResponse[];
}

export interface AiConfigWithKey extends AiConfigFullResponse {
    provider: AiProviderWithKey;
    policy?: AiConfigPolicyResponse | null;
}

function isAiCapabilityId(value: unknown): value is AiCapabilityId {
    return typeof value === "string" && (AI_CAPABILITY_IDS as readonly string[]).includes(value);
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
    if (value == null) return fallback;
    if (typeof value === "string") {
        try {
            return JSON.parse(value) as T;
        } catch {
            return fallback;
        }
    }
    return value as T;
}

function nullableNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function ensureAiConfigPolicyStorage(): Promise<void> {
    const db = getDatabase() as AnyDb;
    const dbType = getDatabaseType();
    if (dbType === "sqlite") {
        db.run(sql`
            CREATE TABLE IF NOT EXISTS rbac_ai_config_policies (
                id                   TEXT    PRIMARY KEY NOT NULL,
                config_id            TEXT    NOT NULL REFERENCES rbac_ai_configs(id) ON DELETE CASCADE,
                capability_id        TEXT    NOT NULL,
                is_enabled           INTEGER NOT NULL DEFAULT 1,
                priority             INTEGER NOT NULL DEFAULT 100,
                temperature          REAL,
                max_output_tokens    INTEGER,
                stop_at_steps        INTEGER,
                max_context_messages INTEGER,
                max_tool_calls       INTEGER,
                max_result_rows      INTEGER,
                max_runtime_ms       INTEGER,
                provider_options     TEXT,
                fallback_config_ids  TEXT,
                created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
                updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
            )
        `);
        db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS ai_config_policies_config_capability_idx ON rbac_ai_config_policies (config_id, capability_id)`);
        db.run(sql`CREATE INDEX IF NOT EXISTS ai_config_policies_capability_idx ON rbac_ai_config_policies (capability_id)`);
        db.run(sql`CREATE INDEX IF NOT EXISTS ai_config_policies_enabled_priority_idx ON rbac_ai_config_policies (is_enabled, priority)`);
    } else {
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS rbac_ai_config_policies (
                id                   TEXT PRIMARY KEY NOT NULL,
                config_id            TEXT NOT NULL REFERENCES rbac_ai_configs(id) ON DELETE CASCADE,
                capability_id        VARCHAR(80) NOT NULL,
                is_enabled           BOOLEAN NOT NULL DEFAULT true,
                priority             INTEGER NOT NULL DEFAULT 100,
                temperature          REAL,
                max_output_tokens    INTEGER,
                stop_at_steps        INTEGER,
                max_context_messages INTEGER,
                max_tool_calls       INTEGER,
                max_result_rows      INTEGER,
                max_runtime_ms       INTEGER,
                provider_options     JSONB,
                fallback_config_ids  JSONB,
                created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
        `);
        await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS ai_config_policies_config_capability_idx ON rbac_ai_config_policies (config_id, capability_id)`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_config_policies_capability_idx ON rbac_ai_config_policies (capability_id)`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_config_policies_enabled_priority_idx ON rbac_ai_config_policies (is_enabled, priority)`);
    }
}

function mapPolicy(row: Record<string, unknown>): AiConfigPolicyResponse {
    const capabilityId = String(row.capabilityId ?? row.capability_id ?? "");
    if (!isAiCapabilityId(capabilityId)) {
        throw new Error(`Invalid AI capability policy id: ${capabilityId}`);
    }
    return {
        id: String(row.id),
        configId: String(row.configId ?? row.config_id),
        capabilityId,
        isEnabled: Boolean(row.isEnabled ?? row.is_enabled),
        priority: Number(row.priority ?? 100),
        temperature: nullableNumber(row.temperature),
        maxOutputTokens: nullableNumber(row.maxOutputTokens ?? row.max_output_tokens),
        stopAtSteps: nullableNumber(row.stopAtSteps ?? row.stop_at_steps),
        maxContextMessages: nullableNumber(row.maxContextMessages ?? row.max_context_messages),
        maxToolCalls: nullableNumber(row.maxToolCalls ?? row.max_tool_calls),
        maxResultRows: nullableNumber(row.maxResultRows ?? row.max_result_rows),
        maxRuntimeMs: nullableNumber(row.maxRuntimeMs ?? row.max_runtime_ms),
        providerOptions: parseJsonValue<Record<string, unknown> | null>(row.providerOptions ?? row.provider_options, null),
        fallbackConfigIds: parseJsonValue<string[]>(row.fallbackConfigIds ?? row.fallback_config_ids, []),
        createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt ?? row.created_at ?? Date.now())),
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(String(row.updatedAt ?? row.updated_at ?? Date.now())),
    };
}

function validatePolicyInput(input: AiConfigPolicyInput): void {
    if (!isAiCapabilityId(input.capabilityId)) {
        throw new Error(`Invalid capability id: ${input.capabilityId}`);
    }
    const intFields: Array<[keyof AiConfigPolicyInput, number, number]> = [
        ["priority", 0, 10_000],
        ["maxOutputTokens", 1, 200_000],
        ["stopAtSteps", 1, 100],
        ["maxContextMessages", 1, 200],
        ["maxToolCalls", 1, 500],
        ["maxResultRows", 1, 100_000],
        ["maxRuntimeMs", 1_000, 600_000],
    ];
    for (const [key, min, max] of intFields) {
        const value = input[key];
        if (value == null) continue;
        if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
            throw new Error(`${String(key)} must be an integer between ${min} and ${max}`);
        }
    }
    if (input.temperature != null && (typeof input.temperature !== "number" || input.temperature < 0 || input.temperature > 2)) {
        throw new Error("temperature must be between 0 and 2");
    }
    if (input.fallbackConfigIds && new Set(input.fallbackConfigIds).size !== input.fallbackConfigIds.length) {
        throw new Error("fallbackConfigIds cannot contain duplicates");
    }
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

                logger.info({ module: 'AI Models', count: configIds.length }, 'Deactivated configs due to provider deactivation');
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

export async function listAiConfigPolicies(configId: string): Promise<AiConfigPolicyResponse[]> {
    await ensureAiConfigPolicyStorage();
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    const rows = await db.select()
        .from(schema.aiConfigPolicies)
        .where(eq(schema.aiConfigPolicies.configId, configId))
        .orderBy(asc(schema.aiConfigPolicies.priority), asc(schema.aiConfigPolicies.capabilityId));
    return rows.map((row: Record<string, unknown>) => mapPolicy(row));
}

export async function replaceAiConfigPolicies(
    configId: string,
    policies: AiConfigPolicyInput[],
): Promise<AiConfigPolicyResponse[]> {
    await ensureAiConfigPolicyStorage();
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    const config = await getAiConfigById(configId);
    if (!config) throw new Error("Config not found");

    const seen = new Set<string>();
    for (const policy of policies) {
        validatePolicyInput(policy);
        if (seen.has(policy.capabilityId)) {
            throw new Error(`Duplicate policy for capability ${policy.capabilityId}`);
        }
        seen.add(policy.capabilityId);
        if (policy.fallbackConfigIds?.includes(configId)) {
            throw new Error("fallbackConfigIds cannot include the owning config");
        }
    }

    const fallbackIds = [...new Set(policies.flatMap((p) => p.fallbackConfigIds ?? []))];
    if (fallbackIds.length > 0) {
        const rows = await db.select({
            id: schema.aiConfigs.id,
            isActive: schema.aiConfigs.isActive,
        })
            .from(schema.aiConfigs)
            .where(inArray(schema.aiConfigs.id, fallbackIds));
        const activeIds = new Set(
            rows
                .filter((row: { id: string; isActive: boolean | number }) => Boolean(row.isActive))
                .map((row: { id: string }) => row.id),
        );
        const missing = fallbackIds.filter((id) => !activeIds.has(id));
        if (missing.length > 0) {
            throw new Error(`Fallback config(s) must be active: ${missing.join(", ")}`);
        }
    }

    await db.delete(schema.aiConfigPolicies).where(eq(schema.aiConfigPolicies.configId, configId));

    const now = new Date();
    for (const policy of policies) {
        await db.insert(schema.aiConfigPolicies).values({
            id: randomUUID(),
            configId,
            capabilityId: policy.capabilityId,
            isEnabled: policy.isEnabled ?? true,
            priority: policy.priority ?? 100,
            temperature: policy.temperature ?? null,
            maxOutputTokens: policy.maxOutputTokens ?? null,
            stopAtSteps: policy.stopAtSteps ?? null,
            maxContextMessages: policy.maxContextMessages ?? null,
            maxToolCalls: policy.maxToolCalls ?? null,
            maxResultRows: policy.maxResultRows ?? null,
            maxRuntimeMs: policy.maxRuntimeMs ?? null,
            providerOptions: policy.providerOptions ?? null,
            fallbackConfigIds: policy.fallbackConfigIds ?? [],
            createdAt: now,
            updatedAt: now,
        });
    }

    return listAiConfigPolicies(configId);
}

export async function getAiConfigPolicy(
    configId: string,
    capabilityId: string,
): Promise<AiConfigPolicyResponse | null> {
    if (!isAiCapabilityId(capabilityId)) return null;
    await ensureAiConfigPolicyStorage();
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    const rows = await db.select()
        .from(schema.aiConfigPolicies)
        .where(and(
            eq(schema.aiConfigPolicies.configId, configId),
            eq(schema.aiConfigPolicies.capabilityId, capabilityId),
        ))
        .limit(1);
    return rows.length > 0 ? mapPolicy(rows[0] as Record<string, unknown>) : null;
}

export async function listEligibleAiConfigs(
    capabilityId?: string,
): Promise<AiConfigFullResponse[]> {
    const { configs } = await listAiConfigs({ activeOnly: true, limit: 100 });
    if (!capabilityId || !isAiCapabilityId(capabilityId)) return configs;

    await ensureAiConfigPolicyStorage();
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    const policyRows = await db.select()
        .from(schema.aiConfigPolicies)
        .where(and(
            eq(schema.aiConfigPolicies.capabilityId, capabilityId),
            eq(schema.aiConfigPolicies.isEnabled, true),
        ))
        .orderBy(asc(schema.aiConfigPolicies.priority));

    if (policyRows.length === 0) return configs;

    const policies: AiConfigPolicyResponse[] = policyRows.map((row: Record<string, unknown>) => mapPolicy(row));
    const byConfigId = new Map<string, AiConfigFullResponse>(
        configs.map((cfg: AiConfigFullResponse) => [cfg.id, cfg]),
    );
    const eligibleConfigs: AiConfigFullResponse[] = [];
    for (const policy of policies) {
        const cfg = byConfigId.get(policy.configId);
        if (cfg) eligibleConfigs.push({ ...cfg, policies: [policy] });
    }
    return eligibleConfigs;
}

export async function getPreferredAiConfigForCapability(
    capabilityId?: string,
): Promise<AiConfigWithKey | null> {
    if (!capabilityId || !isAiCapabilityId(capabilityId)) return getDefaultAiConfig();
    await ensureAiConfigPolicyStorage();
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    const rows = await db.select({
        policy: schema.aiConfigPolicies,
        config: schema.aiConfigs,
    })
        .from(schema.aiConfigPolicies)
        .innerJoin(schema.aiConfigs, eq(schema.aiConfigPolicies.configId, schema.aiConfigs.id))
        .where(and(
            eq(schema.aiConfigPolicies.capabilityId, capabilityId),
            eq(schema.aiConfigPolicies.isEnabled, true),
            eq(schema.aiConfigs.isActive, true),
        ))
        .orderBy(asc(schema.aiConfigPolicies.priority), asc(schema.aiConfigs.name))
        .limit(1);

    if (rows.length === 0) return getDefaultAiConfig();

    const policy = mapPolicy(rows[0].policy as Record<string, unknown>);
    const config = await getAiConfigWithKey(rows[0].config.id);
    return config ? { ...config, policy } : getDefaultAiConfig();
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
            logger.error({ module: 'AI Models', providerId: row.provider.id, err: error instanceof Error ? error.message : String(error) }, 'Failed to decrypt API key');
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
