/**
 * Sampling-parameter support by model.
 *
 * Claude models after the 4.6 generation reject `temperature`, `top_p` and
 * `top_k` with a 400 ("`temperature` is deprecated for this model"), and
 * OpenAI reasoning models accept only the default temperature and no top_p or
 * penalties. LangChain strips these only for the model ids it knows, and the
 * factory's temperature-0 default would otherwise reach every new model, so the
 * decision is made here from the model id before the client is built.
 *
 * Unrecognized Claude ids are treated as new: dropping sampling only costs the
 * temperature-0 default, while sending it fails the whole request.
 */

import type { AiModelParams } from "../../rbac/constants/aiModelParams";

export interface SamplingFields {
    temperature?: number;
    topP?: number;
    topK?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
}

/**
 * Strip routing prefixes so one id shape covers every way a model is reached:
 * OpenRouter (`anthropic/claude-…`, `openai/gpt-5`) and Bedrock
 * (`anthropic.claude-…`, `us.anthropic.claude-…`).
 */
function bareModelId(modelId: string): string {
    const id = modelId.trim().toLowerCase();
    return id.slice(id.lastIndexOf("/") + 1).replace(/^(?:[a-z-]+\.)?anthropic\./, "");
}

const CLAUDE_GENERATION = /^claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?=$|[-@:.])/;

function claudeAcceptsSampling(id: string): boolean {
    if (/^claude-(?:instant|[123])(?:$|[-.])/.test(id)) return true;
    const match = CLAUDE_GENERATION.exec(id);
    if (!match) return false;
    const major = Number(match[1]);
    const minor = match[2] === undefined ? 0 : Number(match[2]);
    return major < 4 || (major === 4 && minor <= 6);
}

function isOpenAiReasoningModel(id: string): boolean {
    if (/^o\d/.test(id)) return true;
    const gpt = /^gpt-(\d+)/.exec(id);
    return gpt !== null && Number(gpt[1]) >= 5 && !/^gpt-\d+-chat/.test(id);
}

/** Whether a request to this model may carry sampling parameters. */
export function acceptsSampling(modelId: string): boolean {
    const id = bareModelId(modelId);
    if (id.startsWith("claude-")) return claudeAcceptsSampling(id);
    return !isOpenAiReasoningModel(id);
}

/**
 * The sampling fields a provider client should send: the configured values
 * plus the temperature default (`null` for none), or no fields at all for a
 * model that rejects them.
 */
export function samplingFields(
    params: AiModelParams,
    modelId: string,
    defaultTemperature: number | null = 0,
): SamplingFields {
    if (!acceptsSampling(modelId)) return {};
    return {
        temperature: params.temperature ?? defaultTemperature ?? undefined,
        topP: params.topP,
        topK: params.topK,
        frequencyPenalty: params.frequencyPenalty,
        presencePenalty: params.presencePenalty,
    };
}
