/**
 * Model context window (ADR 0022 §6).
 *
 * DeepAgents' summarization reads `model.profile.maxInputTokens`: with it, a run
 * summarizes at 85% of the window and keeps the latest 10%; without it, a fixed
 * 170k-token trigger applies, which a smaller model overflows first. LangChain
 * fills the profile from its own model table, so custom and local model names
 * have none. A configured `contextWindow` is written onto the instance's
 * profile; a model with neither cannot run.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { AppError } from "../../types";

interface ProfiledModel {
  profile?: unknown;
}

/** The profile's `maxInputTokens`, or null when the profile does not know the model. */
export function profileContextWindow(model: object): number | null {
  const profile = (model as ProfiledModel).profile;
  if (!profile || typeof profile !== "object" || !("maxInputTokens" in profile)) return null;
  const value = (profile as { maxInputTokens: unknown }).maxInputTokens;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function missingContextWindowMessage(modelName: string): string {
  return `Set a context window for the AI model '${modelName}' in Admin › AI models: its input window is not in the built-in model list, so agents cannot tell when to summarize.`;
}

/**
 * Put the configured window on the model's profile, or require that the
 * profile already has one. The instance property shadows the class's
 * `profile` getter for this instance only.
 */
export function applyContextWindow(model: BaseChatModel, contextWindow: number | undefined, modelName: string): BaseChatModel {
  if (contextWindow === undefined) {
    if (profileContextWindow(model) === null) throw AppError.badRequest(missingContextWindowMessage(modelName));
    return model;
  }
  const base = (model as ProfiledModel).profile;
  const profile = { ...(base && typeof base === "object" ? base : {}), maxInputTokens: contextWindow };
  Object.defineProperty(model, "profile", { value: profile, configurable: true, enumerable: false, writable: false });
  return model;
}
