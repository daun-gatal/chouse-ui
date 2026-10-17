/**
 * The user's AI model for AI invocations on Data, Dashboards and AI Governance.
 *
 * Returns undefined only when the user chose "System default". A stored model
 * that was removed or deactivated is still sent: the server rejects it with a
 * clear error and AiModelButton marks it unavailable, so a run never quietly
 * uses a different model than the one the user picked.
 */

import { useAiModelStore } from "@/stores";

export function useAiModelId(): string | undefined {
  return useAiModelStore((s) => s.modelId) ?? undefined;
}
