/**
 * Model resolution — wraps aiConfig so every capability resolves its provider
 * model the same way. Throws AppError.badRequest with the config's own message
 * when the selected/default config is missing or invalid.
 */

import { AppError } from "../../types";
import { getConfiguration, validateConfiguration, initializeDeepAgentModel } from "../aiConfig";
import type { AiConfigWithKey } from "../../rbac/services/aiModels";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface ResolvedModel {
  model: BaseChatModel;
  config: AiConfigWithKey;
  /** Human label for reports/audit (model id, falling back to config name). */
  label: string;
}

// deepagents resolves its harness-profile provider from model.getName(), which
// only recognizes the ChatOpenAI / ChatAnthropic / ChatGoogleGenerativeAI class
// names. These providers instantiate other classes, so without a hint the fast
// profile registered under `openai:<modelId>` (engine.ts) silently would not
// apply. Bedrock is deliberately absent: deepagents keys Bedrock-specific tool
// handling off the real ChatBedrockConverse class name, so it keeps its name
// and forgoes the fast profile.
const OPENAI_NAME_HINT_PROVIDERS: ReadonlySet<string> = new Set([
  "azure-openai",
  "groq",
  "mistral",
  "cohere",
  "ollama",
  "xai",
  "deepseek",
  "cerebras",
]);

/**
 * Resolve the language model for a run. `modelId` selects a specific config;
 * omit it to use the default active config.
 */
export async function resolveDeepAgentModel(modelId?: string): Promise<ResolvedModel> {
  const config = await getConfiguration(modelId);
  const validation = validateConfiguration(config);
  if (!validation.valid) {
    throw AppError.badRequest(validation.error || "AI is not configured");
  }
  const model = initializeDeepAgentModel(config!);
  if (OPENAI_NAME_HINT_PROVIDERS.has(config!.provider.providerType)) {
    // `name` is a public Runnable property consulted first by getName().
    (model as { name?: string }).name = "ChatOpenAI";
  }
  const label = config!.model?.modelId ?? config!.model?.name ?? "configured model";
  return { model, config: config!, label };
}
