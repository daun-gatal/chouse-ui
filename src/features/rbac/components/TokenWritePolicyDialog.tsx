/**
 * A token's write policy (ADR 0025): which toolkits it gets as MCP and CLI
 * write tools, and how each tier is handled. The administrator's ceiling
 * (AI Governance › MCP) bounds it: toolkits or tiers above it are shown but
 * do nothing.
 */

import { useEffect, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { AI_TOOLKITS, AI_TOOLKIT_LABELS, type AiActionTier, type AiToolkit } from "@/api/aiActions";
import { rbacPatApi, type PatToken, type PatWritePolicy, type PatWritePolicyView } from "@/api/rbac";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { log } from "@/lib/log";

const RANK: Record<AiActionTier, number> = { t1: 1, t2: 2, t3: 3 };
const SWITCH_CLASS = "data-[state=checked]:bg-brand data-[state=unchecked]:bg-ink-500";

const LOW_OPTIONS = [
  { value: "auto", label: "Run" },
  { value: "confirm", label: "Ask me in CHouse" },
  { value: "off", label: "Off" },
] as const;

const T3_OPTIONS = [
  { value: "approver", label: "Send to a second approver" },
  { value: "off", label: "Off" },
] as const;

type Low = PatWritePolicy["t1"];

function isLow(value: string): value is Low {
  return value === "auto" || value === "confirm" || value === "off";
}

export function TokenWritePolicyDialog({ token, onClose }: { token: PatToken; onClose: () => void }): ReactElement {
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

  const toggle = (toolkit: AiToolkit, on: boolean): void => setPolicy((current) => current && ({
    ...current,
    toolkits: on ? AI_TOOLKITS.filter((t) => t === toolkit || current.toolkits.includes(t)) : current.toolkits.filter((t) => t !== toolkit),
  }));

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

  const above = (tier: AiActionTier): boolean => Boolean(view && RANK[tier] > RANK[view.ceiling.maxTier]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-xs border-ink-500 bg-ink-100 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-paper">Write tools for “{token.name}”</DialogTitle>
          <DialogDescription className="text-[12px] text-paper-muted">
            What agents using this token (over MCP or the CLI) may change. Every call still runs with the token's own permissions.
          </DialogDescription>
        </DialogHeader>
        {!policy || !view ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-paper-dim" aria-label="Loading" /></div>
        ) : (
          <div className="space-y-4">
            <fieldset>
              <legend className="text-[11px] uppercase tracking-[0.12em] text-paper-dim">Toolkits</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {AI_TOOLKITS.map((toolkit) => {
                  const allowed = view.ceiling.toolkits.includes(toolkit);
                  return (
                    <label key={toolkit} className={`flex items-center gap-2 text-[12px] ${allowed ? "text-paper" : "text-paper-faint"}`} title={allowed ? undefined : "An administrator has not allowed these over MCP"}>
                      <Switch className={SWITCH_CLASS} checked={policy.toolkits.includes(toolkit)} disabled={!allowed || saving} onCheckedChange={(on) => toggle(toolkit, on)} aria-label={AI_TOOLKIT_LABELS[toolkit]} />
                      {AI_TOOLKIT_LABELS[toolkit]}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["t1", "t2"] as const).map((tier) => (
                <div key={tier}>
                  <Label htmlFor={`pat-${tier}`} className="text-[11px]">{tier === "t1" ? "Undoable changes" : "Changes that ask once"}</Label>
                  <Select value={policy[tier]} onValueChange={(value) => isLow(value) && setPolicy({ ...policy, [tier]: value })} disabled={above(tier) || saving}>
                    <SelectTrigger id={`pat-${tier}`} className="mt-1 rounded-xs text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{LOW_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
              <div>
                <Label htmlFor="pat-t3" className="text-[11px]">High-risk changes</Label>
                <Select value={policy.t3} onValueChange={(value) => setPolicy({ ...policy, t3: value === "off" ? "off" : "approver" })} disabled={above("t3") || saving}>
                  <SelectTrigger id="pat-t3" className="mt-1 rounded-xs text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{T3_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                {above("t3") && <p className="mt-1 text-[11px] text-paper-faint">Not allowed over MCP by an administrator.</p>}
              </div>
            </div>
            <p className="text-[11px] text-paper-faint">"Ask me in CHouse" holds the agent's call until you confirm it in Chobi or AI Governance › Approvals. On a production connection every change counts one step higher.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!policy || saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
