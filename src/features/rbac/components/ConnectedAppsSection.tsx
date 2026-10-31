/**
 * Connected apps (ADR 0028 §5): agents you let in by signing in with OAuth,
 * listed under your personal access tokens. Each works on MCP only, with your
 * live permissions and the write tools you picked; revoke one to cut it off.
 */

import React, { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Trash2, Wrench } from "lucide-react";

import ConfirmationDialog from "@/components/common/ConfirmationDialog";
import { listConnectedApps, revokeConnectedApp, type ConnectedApp } from "@/api/oauth";
import { AI_TOOLKIT_LABELS } from "@/api/aiActions";
import { MONO_FAINT, MONO_LABEL } from "@/pages/Preferences";
import { log } from "@/lib/log";
import { TokenWritePolicyDialog, type WritePolicyTarget } from "./TokenWritePolicyDialog";

export const CONNECTED_APPS_QUERY_KEY = ["oauth-connected-apps"];

const DAY_MS = 86_400_000;

function formatDate(ms: number | null): string {
  if (ms === null) return "never";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** "reads only", "Data & Query", or "Data & Query +2". */
export function writeSummary(app: Pick<ConnectedApp, "policy">): string {
  const toolkits = app.policy.toolkits;
  if (toolkits.length === 0) return "reads only";
  const first = AI_TOOLKIT_LABELS[toolkits[0]];
  return toolkits.length === 1 ? first : `${first} +${toolkits.length - 1}`;
}

export const ConnectedAppsSection: React.FC = () => {
  const queryClient = useQueryClient();
  const [policyTarget, setPolicyTarget] = useState<WritePolicyTarget | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ConnectedApp | null>(null);
  const { data: apps = [] } = useQuery({ queryKey: CONNECTED_APPS_QUERY_KEY, queryFn: listConnectedApps });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeConnectedApp(id),
    onSuccess: () => {
      toast.success("Access revoked");
      setRevokeTarget(null);
      void queryClient.invalidateQueries({ queryKey: CONNECTED_APPS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.error("[ConnectedApps] Failed to revoke an app", { message });
      toast.error(`Failed to revoke access: ${message}`);
    },
  });

  const closePolicy = useCallback(() => {
    setPolicyTarget(null);
    void queryClient.invalidateQueries({ queryKey: CONNECTED_APPS_QUERY_KEY });
  }, [queryClient]);

  if (apps.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-testid="connected-apps">
      <div className="flex items-center justify-between">
        <p className={MONO_LABEL}>Connected apps · signed in with OAuth</p>
        <span className={MONO_FAINT}>MCP only</span>
      </div>
      {apps.map((app) => {
        const expiresSoon = app.expiresAt !== null && app.expiresAt - Date.now() < 7 * DAY_MS;
        return (
          <div key={app.id} className="flex items-center justify-between gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
                <Bot className="h-4 w-4" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px] font-medium tracking-tight text-paper">{app.clientName}</span>
                <span className={MONO_FAINT}>
                  {app.returnsTo ? `${app.returnsTo} · ` : ""}{writeSummary(app)} · {expiresSoon ? <span className="text-amber-500">expires {formatDate(app.expiresAt)}</span> : `expires ${formatDate(app.expiresAt)}`} · last used {formatDate(app.lastUsedAt)}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setPolicyTarget({ id: app.id, name: app.clientName })}
                className="rounded-xs p-1.5 text-paper-dim transition-colors hover:bg-ink-100 hover:text-paper"
                title={`What ${app.clientName} may change`}
                aria-label={`Write tools for ${app.clientName}`}
              >
                <Wrench className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setRevokeTarget(app)}
                className="rounded-xs p-1.5 text-paper-dim transition-colors hover:bg-red-950/40 hover:text-red-300"
                title={`Revoke ${app.clientName}`}
                aria-label={`Revoke ${app.clientName}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}

      <ConfirmationDialog
        isOpen={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => { if (revokeTarget) revoke.mutate(revokeTarget.id); }}
        title="Revoke access"
        description={`“${revokeTarget?.clientName}” loses access to CHouse immediately. To use it again, connect it and sign in again.`}
        confirmText={revoke.isPending ? "Revoking..." : "Revoke"}
        cancelText="Cancel"
        variant="danger"
      />

      {policyTarget && (
        <TokenWritePolicyDialog
          token={policyTarget}
          onClose={closePolicy}
          description="What this agent may change over MCP. Every call still runs with your own permissions."
        />
      )}
    </div>
  );
};
