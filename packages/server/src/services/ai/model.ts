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
import type { AiConfigWithKey } from "../../rbac/services/aiModels";
import type { LanguageModel } from "ai";

export interface ResolvedModel {
  model: LanguageModel;
  config: AiConfigWithKey;
  /** Human label for reports/audit (model id, falling back to config name). */
  label: string;
}

/**
 * Resolve the language model for a run. `modelId` selects a specific config;
 * omit it to use the default active config.
 */
export async function resolveModel(modelId?: string): Promise<ResolvedModel> {
  const config = await getConfiguration(modelId);
  const validation = validateConfiguration(config);
  if (!validation.valid) {
    throw AppError.badRequest(validation.error || "AI is not configured");
  }
  const model = initializeAIModel(config!);
  const label = config!.model?.modelId ?? config!.model?.name ?? "configured model";
  return { model, config: config!, label };
}
