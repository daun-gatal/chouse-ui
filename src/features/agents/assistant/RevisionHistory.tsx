/**
 * Every saved revision of an agent, harness or skill, with one-click rollback.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { History, RotateCcw } from "lucide-react";

import type { RegistryRevision } from "@/api/aiAgents";
import { Button } from "@/components/ui/button";
import { formatAgo } from "@/features/observe/lib";
import { EmptyState, ErrorState, LoadingGrid } from "@/features/observe/ui";
import { useAssistantMutations, useRevisions } from "./hooks";
import { revisionLabel } from "./lib";
import { errorMessage } from "./shared";

export function RevisionHistory({ entity, id, canManage, onRestored }: {
  entity: RegistryRevision["entity"];
  id: string;
  canManage: boolean;
  onRestored?: () => void;
}): ReactElement {
  const revisions = useRevisions(entity, id);
  const { rollback } = useAssistantMutations();
  const [open, setOpen] = useState<string | null>(null);

  if (revisions.isLoading) return <LoadingGrid count={2} />;
  if (revisions.isError || !revisions.data) return <ErrorState title="History could not be loaded." error={revisions.error} />;
  if (revisions.data.length === 0) return <EmptyState icon={History} title="No history yet" />;

  const restore = async (revision: RegistryRevision): Promise<void> => {
    try {
      await rollback.mutateAsync(revision.id);
      toast.success(`Restored version ${revision.version}`);
      onRestored?.();
    } catch (error) {
      toast.error(errorMessage(error, "Could not restore that version"));
    }
  };

  return (
    <ol className="space-y-2">
      {revisions.data.map((revision, index) => (
        <li key={revision.id} className="rounded-xs border border-ink-500 bg-ink-200/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] text-paper">
              <span className="font-mono text-paper-dim">v{revision.version}</span> · {revisionLabel(revision.action)}
              <span className="ml-2 text-[11px] text-paper-faint">{formatAgo(revision.createdAt)}{revision.actor ? "" : " · by CHouse"}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" className="h-7 rounded-xs px-2 text-[11px]" onClick={() => setOpen(open === revision.id ? null : revision.id)}>
                {open === revision.id ? "Hide" : "Show"}
              </Button>
              {canManage && index > 0 && (
                <Button variant="outline" className="h-7 rounded-xs px-2 text-[11px]" disabled={rollback.isPending} onClick={() => void restore(revision)}>
                  <RotateCcw className="mr-1 h-3 w-3" /> Restore
                </Button>
              )}
            </div>
          </div>
          {open === revision.id && (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper">{JSON.stringify(revision.snapshot, null, 2)}</pre>
          )}
        </li>
      ))}
    </ol>
  );
}
