/**
 * Remediation (ADR 0016 §8): proposed fixes from the closed catalog, with the
 * exact statements an approver reads, approval class, verification and
 * rollback. Approval rules (two approvers for class 2, never the proposer)
 * are enforced server-side; the UI only offers what the user's permissions
 * allow.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, Loader2, Play, Plus, RotateCcw, ShieldAlert, Wrench, XCircle } from "lucide-react";

import { ACTION_TYPES, isTerminal, previewAction, type ActionStatus, type ActionType, type BuiltAction, type RemediationAction } from "@/api/remediation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";
import { useDecideAction, useProposeAction, useRemediationActions, useRemediationCatalog, useRollbackAction, useRunAction } from "./hooks";
import { formatAgo, humanize, type Tone } from "./lib";
import { ACTION_META, buildParams, valuesFromParams, type FormValues } from "./remediationForm";
import { EmptyState, OBS_LABEL, Panel, StatusPill } from "./ui";

const STATUS_TONE: Record<ActionStatus, Tone> = {
  proposed: "info",
  approved: "brand",
  executing: "warn",
  executed: "ok",
  verified: "ok",
  failed_verification: "bad",
  failed: "bad",
  rolled_back: "muted",
  rejected: "muted",
};

const SOURCE_LABEL: Record<RemediationAction["proposedSource"], string> = {
  user: "a person",
  ai: "Chouse AI",
  mcp: "an agent (MCP)",
  doctor: "Doctor",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export interface ProposeDraft {
  type: ActionType;
  params: Record<string, unknown>;
  rationale?: string;
}

interface ProposeContext {
  incidentSource?: "data_health" | "observe";
  incidentId?: string;
  notebookId?: string;
}

/** Pick a catalog action, fill its parameters, preview the statements, then propose. */
export function ProposeActionDialog({ open, onOpenChange, draft, context }: { open: boolean; onOpenChange: (open: boolean) => void; draft?: ProposeDraft; context: ProposeContext }): ReactElement {
  const connectionId = useAuthStore((s) => s.activeConnectionId);
  const catalog = useRemediationCatalog(open);
  const propose = useProposeAction();
  const [type, setType] = useState<ActionType>(draft?.type ?? "kill_query");
  const [values, setValues] = useState<FormValues>(() => valuesFromParams(draft?.type ?? "kill_query", draft?.params ?? {}));
  const [rationale, setRationale] = useState(draft?.rationale ?? "");
  const [preview, setPreview] = useState<BuiltAction>();
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = draft?.type ?? "kill_query";
    setType(t);
    setValues(valuesFromParams(t, draft?.params ?? {}));
    setRationale(draft?.rationale ?? "");
    setPreview(undefined);
  }, [open, draft]);

  const built = useMemo(() => buildParams(type, values), [type, values]);
  const fields = ACTION_META[type].fields;

  const runPreview = async (): Promise<void> => {
    if ("error" in built) return;
    setPreviewing(true);
    try {
      setPreview(await previewAction(built.params));
    } catch (error) {
      toast.error(errorMessage(error, "Preview failed"));
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async (): Promise<void> => {
    if ("error" in built || !connectionId) return;
    try {
      await propose.mutateAsync({
        connectionId,
        params: built.params,
        title: ACTION_META[type].label,
        rationale: rationale.trim() || null,
        incidentSource: context.incidentSource ?? null,
        incidentId: context.incidentId ?? null,
        notebookId: context.notebookId ?? null,
      });
      toast.success("Fix proposed — it runs only after approval");
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Could not propose the fix"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100 p-0 text-paper">
        <DialogHeader className="border-b border-ink-500 px-6 py-5">
          <DialogTitle>Propose a fix</DialogTitle>
          <DialogDescription>Only actions from the remediation catalog can be proposed. Nothing runs until it is approved.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <Label>Action</Label>
            <Select value={type} onValueChange={(value) => { const next = ACTION_TYPES.find((t) => t === value); if (next) { setType(next); setValues(valuesFromParams(next, {})); setPreview(undefined); } }}>
              <SelectTrigger className="mt-1 rounded-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{ACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{ACTION_META[t].label}</SelectItem>)}</SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-paper-muted">{ACTION_META[type].summary}</p>
            {catalog.data && <p className="mt-1 font-mono text-[10px] text-paper-faint">Needs on the remediation credential: {catalog.data.types.find((t) => t.type === type)?.requiredGrants.join(", ") || "nothing on ClickHouse"} · maintenance window {catalog.data.window} UTC</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.key}>
                {field.kind === "boolean" ? (
                  <label className="mt-6 flex items-center gap-2 text-[12px] text-paper-muted">
                    <Checkbox checked={values[field.key] === true} onCheckedChange={(checked) => { setValues({ ...values, [field.key]: checked === true }); setPreview(undefined); }} />
                    {field.label}
                  </label>
                ) : field.kind === "select" ? (
                  <>
                    <Label>{field.label}</Label>
                    <Select value={String(values[field.key] || "")} onValueChange={(value) => { setValues({ ...values, [field.key]: value }); setPreview(undefined); }}>
                      <SelectTrigger className="mt-1 rounded-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{(field.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                  </>
                ) : (
                  <>
                    <Label htmlFor={`fix-${field.key}`}>{field.label}{field.optional ? " (optional)" : ""}</Label>
                    <Input
                      id={`fix-${field.key}`}
                      type={field.kind === "datetime" ? "datetime-local" : field.kind === "number" ? "number" : "text"}
                      value={String(values[field.key] ?? "")}
                      placeholder={field.placeholder}
                      onChange={(event) => { setValues({ ...values, [field.key]: event.target.value }); setPreview(undefined); }}
                      className="mt-1 rounded-xs font-mono"
                    />
                  </>
                )}
              </div>
            ))}
          </div>
          <div>
            <Label htmlFor="fix-rationale">Why this fix</Label>
            <Textarea id="fix-rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="The evidence it addresses…" className="mt-1 rounded-xs" />
          </div>
          {"error" in built && <p className="text-[11px] text-amber-500">{built.error}</p>}
          {preview && (
            <div className="rounded-xs border border-ink-500 bg-ink-200/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={preview.approvalClass === 2 ? "warn" : "info"} dot={false}>{preview.approvalClass === 2 ? "High impact · two approvers" : "One approver"}</StatusPill>
                {preview.windowOnly && <StatusPill tone="muted" dot={false}>Maintenance window only</StatusPill>}
              </div>
              <p className={`${OBS_LABEL} mt-3`}>Runs</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper">{preview.statements.join(";\n") || preview.preview}</pre>
              {preview.rollback && preview.rollback.length > 0 && (
                <>
                  <p className={`${OBS_LABEL} mt-3`}>Rollback</p>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper-muted">{preview.rollback.join(";\n")}</pre>
                </>
              )}
              <p className="mt-3 text-[11px] text-paper-muted">Verified after: {preview.verification.description}</p>
            </div>
          )}
        </div>
        <DialogFooter className="border-t border-ink-500 px-6 py-4">
          <Button variant="outline" className="rounded-xs" disabled={"error" in built || previewing} onClick={() => void runPreview()}>
            {previewing && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}Preview statements
          </Button>
          <Button className={DH_PRIMARY} disabled={"error" in built || !connectionId || propose.isPending} onClick={() => void submit()}>Propose fix</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecisionDialog({ action, decision, onClose }: { action: RemediationAction | null; decision: "approve" | "reject"; onClose: () => void }): ReactElement {
  const decide = useDecideAction();
  const [comment, setComment] = useState("");
  useEffect(() => setComment(""), [action]);
  const submit = async (): Promise<void> => {
    if (!action) return;
    try {
      await decide.mutateAsync({ id: action.id, decision, comment: comment.trim() || null });
      toast.success(decision === "approve" ? "Approved" : "Rejected");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Decision failed"));
    }
  };
  return (
    <Dialog open={Boolean(action)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl rounded-xs border-ink-500 bg-ink-100 text-paper">
        <DialogHeader>
          <DialogTitle>{decision === "approve" ? "Approve fix" : "Reject fix"}</DialogTitle>
          <DialogDescription>{action?.title}</DialogDescription>
        </DialogHeader>
        {action && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper">{action.previewSql}</pre>}
        {decision === "approve" && action?.approvalClass === 2 && <p className="text-[11px] text-amber-500">High-impact action: it needs a second approver before it runs.</p>}
        <div>
          <Label htmlFor="decision-comment">Comment</Label>
          <Textarea id="decision-comment" value={comment} onChange={(event) => setComment(event.target.value)} className="mt-1 rounded-xs" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button className={decision === "approve" ? DH_PRIMARY : "rounded-xs"} variant={decision === "approve" ? "default" : "destructive"} disabled={decide.isPending} onClick={() => void submit()}>
            {decision === "approve" ? "Approve" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionCard({ action, onDecide }: { action: RemediationAction; onDecide: (decision: "approve" | "reject") => void }): ReactElement {
  const { hasPermission } = useRbacStore();
  const run = useRunAction();
  const rollback = useRollbackAction();
  const [open, setOpen] = useState(action.status === "proposed");
  const canApprove = hasPermission(action.approvalClass === 2 ? RBAC_PERMISSIONS.REMEDIATION_APPROVE_HIGH : RBAC_PERMISSIONS.REMEDIATION_APPROVE) || hasPermission(RBAC_PERMISSIONS.REMEDIATION_APPROVE_HIGH);
  const canReject = canApprove || hasPermission(RBAC_PERMISSIONS.REMEDIATION_PROPOSE);
  const isApprover = hasPermission(RBAC_PERMISSIONS.REMEDIATION_APPROVE) || hasPermission(RBAC_PERMISSIONS.REMEDIATION_APPROVE_HIGH);

  const act = async (fn: () => Promise<unknown>, done: string): Promise<void> => {
    try {
      await fn();
      toast.success(done);
    } catch (error) {
      toast.error(errorMessage(error, "Action failed"));
    }
  };

  return (
    <li className="rounded-xs border border-ink-500 bg-ink-200/20">
      <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-paper">{action.title}</p>
          <p className="text-[11px] text-paper-muted">Proposed by {SOURCE_LABEL[action.proposedSource]} · {formatAgo(action.createdAt)}{action.windowOnly ? " · maintenance window" : ""}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action.approvalClass === 2 && <StatusPill tone="warn" dot={false}>High impact</StatusPill>}
          <StatusPill tone={STATUS_TONE[action.status]}>{humanize(action.status)}</StatusPill>
          <ChevronDown className={`h-3.5 w-3.5 text-paper-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-ink-500 p-3">
          {action.rationale && <p className="text-[12px] text-paper">{action.rationale}</p>}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper">{action.previewSql}</pre>
          <p className="text-[11px] text-paper-muted">Verified after: {action.verification.description}</p>
          {action.rollbackSql && <p className="font-mono text-[10px] text-paper-faint">Rollback: {action.rollbackSql}</p>}
          <div className="flex flex-wrap gap-2">
            {action.status === "proposed" && canApprove && <Button className={DH_PRIMARY} onClick={() => onDecide("approve")}><CheckCircle2 className="h-3.5 w-3.5" /> Approve</Button>}
            {action.status === "proposed" && canReject && <Button variant="outline" className="h-9 rounded-xs" onClick={() => onDecide("reject")}><XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject</Button>}
            {action.status === "approved" && isApprover && !action.windowOnly && (
              <Button variant="outline" className="h-9 rounded-xs" disabled={run.isPending} onClick={() => void act(() => run.mutateAsync(action.id), "Fix executed — verification running")}><Play className="mr-1.5 h-3.5 w-3.5" /> Run now</Button>
            )}
            {["executed", "verified", "failed_verification"].includes(action.status) && action.rollbackSql && isApprover && (
              <Button variant="outline" className="h-9 rounded-xs" disabled={rollback.isPending} onClick={() => void act(() => rollback.mutateAsync(action.id), "Rolled back")}><RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Roll back</Button>
            )}
            {action.status === "proposed" && !canApprove && <p className="text-[11px] text-paper-faint">Waiting for an approver ({action.approvalClass === 2 ? "remediation:approve_high, two people" : "remediation:approve"}).</p>}
          </div>
        </div>
      )}
    </li>
  );
}

/** Fixes attached to an incident or a notebook, plus the propose entry point. */
export function RemediationPanel({ context, drafts = [], title = "Fixes" }: { context: ProposeContext; drafts?: ProposeDraft[]; title?: string }): ReactElement {
  const { hasPermission, hasAnyPermission } = useRbacStore();
  const canPropose = hasPermission(RBAC_PERMISSIONS.REMEDIATION_PROPOSE);
  const canSee = hasAnyPermission([RBAC_PERMISSIONS.REMEDIATION_PROPOSE, RBAC_PERMISSIONS.REMEDIATION_APPROVE, RBAC_PERMISSIONS.REMEDIATION_APPROVE_HIGH]);
  const actions = useRemediationActions({ incidentId: context.incidentId, notebookId: context.incidentId ? undefined : context.notebookId }, canSee);
  const [proposeDraft, setProposeDraft] = useState<ProposeDraft | undefined>();
  const [proposeOpen, setProposeOpen] = useState(false);
  const [decision, setDecision] = useState<{ action: RemediationAction; decision: "approve" | "reject" } | null>(null);

  if (!canSee) {
    return (
      <Panel title={title}>
        <EmptyState icon={ShieldAlert} title="Fixes need a remediation permission" body="remediation:propose to suggest fixes, remediation:approve to approve them." />
      </Panel>
    );
  }

  const list = actions.data ?? [];
  const open = list.filter((a) => !isTerminal(a.status));
  const done = list.filter((a) => isTerminal(a.status));

  return (
    <Panel
      title={title}
      meta="Approve here, in Slack or with the CLI"
      actions={canPropose ? <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => { setProposeDraft(undefined); setProposeOpen(true); }}><Plus className="mr-1 h-3 w-3" /> Propose fix</Button> : undefined}
    >
      {drafts.length > 0 && canPropose && (
        <div className="mb-3 space-y-2">
          <p className={OBS_LABEL}>Drafted by Chouse AI</p>
          {drafts.map((d, i) => (
            <div key={`${d.type}:${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xs border border-brand/30 bg-brand/[0.04] p-2.5">
              <div className="min-w-0">
                <p className="text-[12px] text-paper">{ACTION_META[d.type].label}</p>
                {d.rationale && <p className="text-[11px] text-paper-muted">{d.rationale}</p>}
              </div>
              <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => { setProposeDraft(d); setProposeOpen(true); }}>Review &amp; propose</Button>
            </div>
          ))}
        </div>
      )}
      {actions.isLoading ? (
        <p className="text-[11px] text-paper-muted">Loading fixes…</p>
      ) : list.length === 0 ? (
        <EmptyState icon={Wrench} title="No fixes proposed" body={canPropose ? "Propose one from the catalog, or ask Chouse AI to draft fixes." : undefined} />
      ) : (
        <div className="space-y-3">
          {open.length > 0 && <ul className="space-y-2">{open.map((a) => <ActionCard key={a.id} action={a} onDecide={(d) => setDecision({ action: a, decision: d })} />)}</ul>}
          {done.length > 0 && (
            <details>
              <summary className={`${OBS_LABEL} cursor-pointer`}>History · {done.length}</summary>
              <ul className="mt-2 space-y-2">{done.map((a) => <ActionCard key={a.id} action={a} onDecide={(d) => setDecision({ action: a, decision: d })} />)}</ul>
            </details>
          )}
        </div>
      )}
      <ProposeActionDialog open={proposeOpen} onOpenChange={setProposeOpen} draft={proposeDraft} context={context} />
      <DecisionDialog action={decision?.action ?? null} decision={decision?.decision ?? "approve"} onClose={() => setDecision(null)} />
    </Panel>
  );
}
