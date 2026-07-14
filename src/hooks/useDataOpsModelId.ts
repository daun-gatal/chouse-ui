/**
 * Effective AI model id for DataOps AI invocations.
 *
 * Returns undefined (= backend uses the system-default model) when nothing is
 * selected, while the active-model list is still loading, or when the
 * persisted id is no longer in the active list — a stale id must never be
 * sent, since the server rejects unknown/inactive config ids.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchAiModels } from "@/api/ai";
import { useDataOpsModelStore } from "@/stores";

export function useDataOpsModelId(): string | undefined {
  const modelId = useDataOpsModelStore((s) => s.modelId);
  // Same key/staleTime as useAiModelSelection so the cache is shared.
  const { data: models } = useQuery({
    queryKey: ["ai-models"],
    queryFn: fetchAiModels,
    enabled: Boolean(modelId),
    staleTime: 5 * 60_000,
  });
  if (!modelId || !models) return undefined;
  return models.some((m) => m.id === modelId) ? modelId : undefined;
}
