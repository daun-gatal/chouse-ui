/**
 * The controls of a token's write policy (ADR 0025): which toolkits it gets as
 * write tools and how each tier is handled. The administrator's ceiling bounds
 * it: toolkits or tiers above it are shown but do nothing. Shared by a token's
 * write-tools dialog and the agent sign-in page (ADR 0028).
 */

import type { ReactElement } from "react";

import { AI_TOOLKITS, AI_TOOLKIT_LABELS, type AiActionTier, type AiToolkit } from "@/api/aiActions";
import type { PatWritePolicy } from "@/api/rbac";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

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

export interface WritePolicyCeiling {
  toolkits: AiToolkit[];
  maxTier: AiActionTier;
}

interface WritePolicyFieldsProps {
  /** Show the "Toolkits" label; off where the page already heads the section. */
  showLegend?: boolean;
  policy: PatWritePolicy;
  ceiling: WritePolicyCeiling;
  onChange: (policy: PatWritePolicy) => void;
  disabled?: boolean;
  /** Prefix for control ids, so two copies on one page don't collide. */
  idPrefix?: string;
}

export function WritePolicyFields({ policy, ceiling, onChange, disabled = false, idPrefix = "pat", showLegend = true }: WritePolicyFieldsProps): ReactElement {
  const toggle = (toolkit: AiToolkit, on: boolean): void => onChange({
    ...policy,
    toolkits: on ? AI_TOOLKITS.filter((t) => t === toolkit || policy.toolkits.includes(t)) : policy.toolkits.filter((t) => t !== toolkit),
  });
  const above = (tier: AiActionTier): boolean => RANK[tier] > RANK[ceiling.maxTier];

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className={showLegend ? "text-[11px] uppercase tracking-[0.12em] text-paper-dim" : "sr-only"}>Toolkits</legend>
        <div className={showLegend ? "mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" : "grid grid-cols-1 gap-2 sm:grid-cols-2"}>
          {AI_TOOLKITS.map((toolkit) => {
            const allowed = ceiling.toolkits.includes(toolkit);
            return (
              <label key={toolkit} className={`flex items-center gap-2 text-[12px] ${allowed ? "text-paper" : "text-paper-faint"}`} title={allowed ? undefined : "An administrator has not allowed these over MCP"}>
                <Switch className={SWITCH_CLASS} checked={allowed && policy.toolkits.includes(toolkit)} disabled={!allowed || disabled} onCheckedChange={(on) => toggle(toolkit, on)} aria-label={AI_TOOLKIT_LABELS[toolkit]} />
                {AI_TOOLKIT_LABELS[toolkit]}
                {!allowed && <span className="text-[11px] text-paper-faint">· off by your admin</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["t1", "t2"] as const).map((tier) => (
          <div key={tier}>
            <Label htmlFor={`${idPrefix}-${tier}`} className="text-[11px]">{tier === "t1" ? "Undoable changes" : "Changes that ask once"}</Label>
            <Select value={policy[tier]} onValueChange={(value) => isLow(value) && onChange({ ...policy, [tier]: value })} disabled={above(tier) || disabled}>
              <SelectTrigger id={`${idPrefix}-${tier}`} className="mt-1 rounded-xs text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>{LOW_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ))}
        <div>
          <Label htmlFor={`${idPrefix}-t3`} className="text-[11px]">High-risk changes</Label>
          <Select value={policy.t3} onValueChange={(value) => onChange({ ...policy, t3: value === "off" ? "off" : "approver" })} disabled={above("t3") || disabled}>
            <SelectTrigger id={`${idPrefix}-t3`} className="mt-1 rounded-xs text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>{T3_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
          {above("t3") && <p className="mt-1 text-[11px] text-paper-faint">Not allowed over MCP by an administrator.</p>}
        </div>
      </div>
      <p className="text-[11px] text-paper-faint">"Ask me in CHouse" holds the agent's call until you confirm it in Chobi or AI Governance › Approvals. On a production connection every change counts one step higher.</p>
    </div>
  );
}
