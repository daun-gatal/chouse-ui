/**
 * Model resolution — wraps aiConfig so every capability resolves its provider
 * model the same way. Throws AppError.badRequest with the config's own message
 * when the selected/default config is missing or invalid.
 */

import { AppError } from "../../types";
import {
  getConfiguration,
  validateConfiguration,
  initializeAIModel,
} from "../aiConfig";
import {
  getAiConfigPolicy,
  getPreferredAiConfigForCapability,
  type AiConfigPolicyResponse,
  type AiConfigWithKey,
} from "../../rbac/services/aiModels";
import { logger } from "../../utils/logger";
import type { LanguageModel } from "ai";

export interface ResolvedModel {
  model: LanguageModel;
  config: AiConfigWithKey;
  /** Human label for reports/audit (model id, falling back to config name). */
  label: string;
  policy?: AiConfigPolicyResponse | null;
}

export async function resolveFallbackModels(
  policy: AiConfigPolicyResponse | null | undefined,
  capabilityId?: string,
): Promise<ResolvedModel[]> {
  if (!policy?.fallbackConfigIds?.length) return [];

  const resolved: ResolvedModel[] = [];
  for (const fallbackId of policy.fallbackConfigIds) {
    try {
      resolved.push(await resolveModel(fallbackId, capabilityId));
    } catch (error) {
      logger.warn(
        {
          module: "AIModel",
          configId: fallbackId,
          capabilityId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Skipping invalid AI fallback deployment",
      );
    }
  }
  return resolved;
}

/**
 * Resolve the language model for a run. `modelId` selects a specific config;
 * omit it to use the default active config.
 */
export async function resolveModel(
  modelId?: string,
  capabilityId?: string,
): Promise<ResolvedModel> {
  let config = modelId
    ? await getConfiguration(modelId)
    : await getPreferredAiConfigForCapability(capabilityId);
  let policy = config?.policy ?? null;

  if (modelId && capabilityId && config) {
    policy = await getAiConfigPolicy(modelId, capabilityId);
    if (policy && !policy.isEnabled) {
      throw AppError.badRequest(`The selected AI model is disabled for capability '${capabilityId}'.`);
    }
  }

  const validation = validateConfiguration(config);
  if (!validation.valid) {
    throw AppError.badRequest(validation.error || "AI is not configured");
  }
  const model = initializeAIModel(config!);
  const label = config!.model?.modelId ?? config!.model?.name ?? "configured model";
  return { model, config: config!, label, policy };
}
