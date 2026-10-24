/**
 * Team memories that name a table, shown with its context (ADR 0024
 * §Phase 3): what agents remember about it, and proposals waiting for review
 * for people who review them. Renders nothing when there are none.
 */

import type { ReactElement } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Brain, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/features/agents/assistant/shared";
import { Panel, StatusPill } from "@/features/observe/ui";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";
import { useMemoryMutations, useTableMemories } from "./hooks";

export function TableMemories({ database, table }: { database: string; table: string }): ReactElement | null {
  const connectionId = useAuthStore((s) => s.activeConnectionId);
  const hasPermission = useRbacStore((s) => s.hasPermission);
  const allowed = [RBAC_PERMISSIONS.AI_CHAT, RBAC_PERMISSIONS.AI_OPTIMIZE, RBAC_PERMISSIONS.AI_MEMORIES_MANAGE].some((p) => hasPermission(p));
  const memories = useTableMemories(connectionId, database, table, allowed);
  const { review } = useMemoryMutations();
  const rows = memories.data?.memories ?? [];
  if (!allowed || rows.length === 0) return null;

  const decide = async (id: string, approve: boolean): Promise<void> => {
    try {
      await review.mutateAsync({ id, approve });
      toast.success(approve ? "Approved: agents use it from now on" : "Rejected");
    } catch (error) {
      toast.error(errorMessage(error, "Could not review the memory"));
    }
  };

  return (
    <Panel
      title="Team memories"
      meta="What agents remember about this table"
      actions={<Link to="/ai/memories" className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:text-brand">Manage</Link>}
    >
      <ul className="space-y-2">
        {rows.map((m) => (
          <li key={m.id} className="flex flex-wrap items-start gap-2 rounded-xs border border-ink-500 px-3 py-2">
            <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
            <span className="min-w-0 flex-1 break-words text-[12px] text-paper">{m.content}</span>
            {m.status === "proposed" && (
              <span className="flex items-center gap-1">
                <StatusPill tone="warn">Waiting for review</StatusPill>
                {memories.data?.canManage && (
                  <>
                    <Button variant="ghost" className="h-7 rounded-xs px-2 text-[11px] text-red-400 hover:text-red-300" disabled={review.isPending} onClick={() => void decide(m.id, false)} aria-label="Reject memory"><X className="h-3 w-3" /></Button>
                    <Button variant="ghost" className="h-7 rounded-xs px-2 text-[11px] text-brand" disabled={review.isPending} onClick={() => void decide(m.id, true)} aria-label="Approve memory"><Check className="h-3 w-3" /></Button>
                  </>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
