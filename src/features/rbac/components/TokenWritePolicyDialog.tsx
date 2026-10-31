/**
 * A token's write policy (ADR 0025): which toolkits it gets as MCP and CLI
 * write tools, and how each tier is handled. The administrator's ceiling
 * (AI Governance › MCP) bounds it: toolkits or tiers above it are shown but
 * do nothing.
 */

import { useEffect, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { rbacPatApi, type PatWritePolicy, type PatWritePolicyView } from "@/api/rbac";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { log } from "@/lib/log";
import { WritePolicyFields } from "./WritePolicyFields";

/** A personal access token or an agent's OAuth grant (ADR 0028): both carry a write policy. */
export interface WritePolicyTarget {
  id: string;
  name: string;
}

export function TokenWritePolicyDialog({ token, onClose, description }: { token: WritePolicyTarget; onClose: () => void; description?: string }): ReactElement {
  const [view, setView] = useState<PatWritePolicyView | null>(null);
  const [policy, setPolicy] = useState<PatWritePolicy | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    rbacPatApi.getWritePolicy(token.id)
      .then((loaded) => {
        if (!live) return;
        setView(loaded);
        setPolicy(loaded.policy);
      })
      .catch((error: unknown) => {
        log.error("[PersonalAccessTokens] Failed to load the write policy", error);
        toast.error(error instanceof Error ? error.message : "Could not load the token's write tools");
        onClose();
      });
    return () => { live = false; };
  }, [token.id, onClose]);

  const save = async (): Promise<void> => {
    if (!policy) return;
    setSaving(true);
    try {
      await rbacPatApi.setWritePolicy(token.id, policy);
      toast.success(`Write tools saved for ${token.name}`);
      onClose();
    } catch (error) {
      log.error("[PersonalAccessTokens] Failed to save the write policy", error);
      toast.error(error instanceof Error ? error.message : "Could not save the write tools");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-xs border-ink-500 bg-ink-100 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-paper">Write tools for “{token.name}”</DialogTitle>
          <DialogDescription className="text-[12px] text-paper-muted">
            {description ?? "What agents using this token (over MCP or the CLI) may change. Every call still runs with the token's own permissions."}
          </DialogDescription>
        </DialogHeader>
        {!policy || !view ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-paper-dim" aria-label="Loading" /></div>
        ) : (
          <WritePolicyFields policy={policy} ceiling={view.ceiling} onChange={setPolicy} disabled={saving} />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!policy || saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
