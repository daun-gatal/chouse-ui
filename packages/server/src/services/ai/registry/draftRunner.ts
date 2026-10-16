/**
 * Runs a registry drafter with targeted re-asks (issue #381).
 *
 * The first call drafts, refines or redrafts. Every section that still needs
 * attention is then sent back to the drafter on its own, with the validator's
 * messages, up to MAX_REDRAFT_ROUNDS times; sections that passed are kept as
 * they are. A section that still fails comes back flagged, never blank.
 */

import { getCapability } from "../capabilities";
import { isStructured, runStructuredCapability } from "../engine";
import type { AgentRunContext } from "../types";
import { attentionCount, failingSections, foldRedraft, MAX_REDRAFT_ROUNDS, type DraftKind, type DraftRequest, type DraftResult } from "./drafting";

export const DRAFT_FEATURES: Record<DraftKind, string> = {
  agent: "draft-ai-agent",
  harness: "draft-ai-harness",
  skill: "draft-ai-skill",
};

export type DraftCall = <T>(featureId: string, request: DraftRequest<T>, ctx: AgentRunContext) => Promise<DraftResult<T>>;

/** One drafter run through the engine. */
const runOnce: DraftCall = async <T>(featureId: string, request: DraftRequest<T>, ctx: AgentRunContext): Promise<DraftResult<T>> => {
  const cap = getCapability(featureId);
  if (!cap || !isStructured(cap)) throw new Error(`Drafting feature '${featureId}' is not registered`);
  return await runStructuredCapability(cap, cap.inputSchema.parse(request), ctx) as DraftResult<T>;
};

export async function runDraft<T>(
  kind: DraftKind,
  request: DraftRequest<T>,
  ctx: AgentRunContext,
  call: DraftCall = runOnce,
): Promise<DraftResult<T>> {
  const featureId = DRAFT_FEATURES[kind];
  let result = await call(featureId, request, ctx);
  for (let round = 0; round < MAX_REDRAFT_ROUNDS && attentionCount(result) > 0; round++) {
    const feedback = failingSections(result);
    const redraft = await call<T>(featureId, {
      // Feature hints and the pasted reference still apply to the re-ask.
      agentHints: request.agentHints,
      reference: request.reference,
      entityId: request.entityId,
      goal: request.goal,
      current: result.input,
      currentMeta: result.meta,
      sections: Object.keys(feedback),
      feedback,
    }, ctx);
    result = foldRedraft(result, redraft);
  }
  return result;
}
