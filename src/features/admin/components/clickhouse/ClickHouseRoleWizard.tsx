/**
 * ClickHouseRoleWizard
 *
 * Multi-step dialog to create or edit a native ClickHouse role:
 *   Details → Privileges → Databases & tables → Review
 *
 * Privileges are picked from the live ClickHouse hierarchy (system.privileges)
 * and applied uniformly to every selected scope. Any column-level grants on an
 * existing role are preserved as-is. Edits are reconciled diff-based on the
 * server.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Shield,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";
import {
  rbacClickHouseRolesApi,
  type CHGrant,
  type CHPrivilegeCatalogEntry,
} from "@/api/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CHScopePicker, type CHScope } from "./CHScopePicker";
import { CHPrivilegeTree } from "./CHPrivilegeTree";
import { ClusterSelect } from "./ClusterSelect";

interface ClickHouseRoleWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  privileges: CHPrivilegeCatalogEntry[];
  /** Role name when editing; null/undefined when creating. */
  editingName?: string | null;
}

const labelCls = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";
const inputCls =
  "rounded-xs border-ink-500 bg-ink-200 text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0";
const sectionLabelCls =
  "inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim";

const STEPS = ["Details", "Privileges", "Databases & tables", "Review"];
type Step = 1 | 2 | 3 | 4;

const scopeKey = (s: CHScope) => `${s.database ?? "*"}.${s.table ?? "*"}`;
const scopeLabel = (s: CHScope) => (s.database ? (s.table ? `${s.database}.${s.table}` : `${s.database}.*`) : "*.*");

export function ClickHouseRoleWizard({ isOpen, onClose, onSaved, privileges, editingName }: ClickHouseRoleWizardProps) {
  const isEditing = !!editingName;

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [cluster, setCluster] = useState("");
  const [selectedPrivileges, setSelectedPrivileges] = useState<string[]>([]);
  const [grantOption, setGrantOption] = useState(false);
  const [scopes, setScopes] = useState<CHScope[]>([]);
  const [preservedGrants, setPreservedGrants] = useState<CHGrant[]>([]); // column-level grants, carried through
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setName(editingName ?? "");
    setCluster("");
    setSelectedPrivileges([]);
    setGrantOption(false);
    setScopes([]);
    setPreservedGrants([]);
    if (editingName) {
      setLoading(true);
      rbacClickHouseRolesApi
        .get(editingName)
        .then((detail) => {
          const withColumns = detail.grants.filter((g) => g.columns?.length);
          const simple = detail.grants.filter((g) => !g.columns?.length);
          setPreservedGrants(withColumns);
          setSelectedPrivileges([...new Set(simple.flatMap((g) => g.privileges))].sort());
          setGrantOption(simple.some((g) => g.grantOption));
          const seen = new Set<string>();
          const uniqueScopes: CHScope[] = [];
          for (const g of simple) {
            const s = { database: g.database, table: g.table };
            if (!seen.has(scopeKey(s))) {
              seen.add(scopeKey(s));
              uniqueScopes.push(s);
            }
          }
          setScopes(uniqueScopes);
        })
        .catch((error) => {
          log.error("Failed to load role grants", error);
          toast.error(error instanceof Error ? error.message : "Failed to load role grants");
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen, editingName]);

  const builtGrants = useMemo<CHGrant[]>(() => {
    const simple =
      selectedPrivileges.length > 0 && scopes.length > 0
        ? scopes.map((s) => ({ privileges: selectedPrivileges, database: s.database, table: s.table, grantOption }))
        : [];
    return [...simple, ...preservedGrants];
  }, [selectedPrivileges, scopes, grantOption, preservedGrants]);

  const nameValid = isEditing || /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name.trim());

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const clusterValue = cluster.trim() || undefined;
      if (isEditing && editingName) {
        await rbacClickHouseRolesApi.update(editingName, { cluster: clusterValue, grants: builtGrants });
        toast.success(`Role "${editingName}" updated`);
      } else {
        await rbacClickHouseRolesApi.create({ name: name.trim(), cluster: clusterValue, grants: builtGrants });
        toast.success(`Role "${name.trim()}" created`);
      }
      onSaved();
      onClose();
    } catch (error) {
      log.error("Failed to save ClickHouse role", error);
      toast.error(error instanceof Error ? error.message : "Failed to save ClickHouse role");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100 p-0">
        <DialogHeader className="flex-shrink-0 border-b border-ink-500 px-6 pb-4 pt-6">
          <DialogTitle asChild>
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                <Shield className="h-4 w-4" aria-hidden />
              </span>
              <div className="flex flex-1 flex-col gap-0.5 text-left">
                <h2 className="text-[16px] font-semibold tracking-tight text-paper">
                  {isEditing ? `Edit role: ${editingName}` : "Create ClickHouse role"}
                </h2>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  Native ClickHouse role privileges
                </p>
              </div>
            </div>
          </DialogTitle>
          <DialogDescription className="mt-1 text-[12px] text-paper-muted">
            {step === 1 && "Step 1 of 4 — name the role and pick an optional cluster."}
            {step === 2 && "Step 2 of 4 — choose the privileges this role grants."}
            {step === 3 && "Step 3 of 4 — choose which databases and tables they apply to."}
            {step === 4 && "Step 4 of 4 — review and apply. Edits issue only changed grants."}
          </DialogDescription>

          {/* Stepper */}
          <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
            {STEPS.map((label, i) => {
              const n = (i + 1) as Step;
              return (
                <div key={label} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded-full font-mono text-[10px]",
                      step === n ? "bg-brand text-ink-50" : step > n ? "bg-emerald-600 text-ink-50" : "bg-ink-300 text-paper-faint",
                    )}
                  >
                    {step > n ? <Check className="h-3 w-3" /> : n}
                  </span>
                  <span className={cn("font-mono text-[10px] uppercase tracking-[0.14em]", step === n ? "text-paper" : "text-paper-faint")}>
                    {label}
                  </span>
                  {n < STEPS.length && <span className="mx-1 h-px w-3 bg-ink-500" />}
                </div>
              );
            })}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
            </div>
          ) : (
            <>
              {/* Step 1 — Details */}
              {step === 1 && (
                <div className="space-y-4">
                  {!isEditing && (
                    <div className="space-y-2">
                      <Label className={labelCls}>
                        Role name <span className="text-red-400">*</span>
                      </Label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., analytics" className={inputCls} />
                      <p className="text-[11px] text-paper-faint">
                        Must start with a letter or underscore; letters, numbers and underscores only.
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label className={labelCls}>Cluster</Label>
                    <ClusterSelect value={cluster} onChange={setCluster} className={inputCls} />
                    <p className="text-[11px] text-paper-faint">Applies the role DDL across the chosen cluster.</p>
                  </div>
                </div>
              )}

              {/* Step 2 — Privileges */}
              {step === 2 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={sectionLabelCls}>
                      <span className="h-px w-6 bg-ink-700" aria-hidden />
                      <span>Privileges</span>
                      {selectedPrivileges.length > 0 && (
                        <span className="rounded-xs border border-brand/40 px-1.5 py-0.5 text-brand">{selectedPrivileges.length} selected</span>
                      )}
                    </span>
                    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-paper-muted">
                      <Switch checked={grantOption} onCheckedChange={setGrantOption} />
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em]">Grant option</span>
                    </label>
                  </div>
                  <CHPrivilegeTree privileges={privileges} value={selectedPrivileges} onChange={setSelectedPrivileges} />
                </div>
              )}

              {/* Step 3 — Databases & tables */}
              {step === 3 && (
                <div className="space-y-3">
                  <span className={sectionLabelCls}>
                    <span className="h-px w-6 bg-ink-700" aria-hidden />
                    <span>Databases &amp; tables</span>
                    {scopes.length > 0 && (
                      <span className="rounded-xs border border-brand/40 px-1.5 py-0.5 text-brand">{scopes.length}</span>
                    )}
                  </span>
                  <p className="text-[11px] text-paper-faint">
                    The selected privileges apply to every database / table chosen here.
                  </p>
                  <CHScopePicker value={scopes} onChange={setScopes} />
                </div>
              )}

              {/* Step 4 — Review */}
              {step === 4 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <span className={sectionLabelCls}>
                      <span className="h-px w-6 bg-ink-700" aria-hidden />
                      <span>Summary</span>
                    </span>
                    <div className="space-y-2 rounded-xs border border-ink-500 bg-ink-200 p-3 text-[12px]">
                      <div className="flex justify-between">
                        <span className={labelCls}>Role</span>
                        <span className="font-mono text-paper">{(isEditing ? editingName : name) || "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={labelCls}>Cluster</span>
                        <span className="font-mono text-paper">{cluster.trim() || "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={labelCls}>Grant option</span>
                        <span className="font-mono text-paper">{grantOption ? "Yes" : "No"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className={sectionLabelCls}>
                      <span className="h-px w-6 bg-ink-700" aria-hidden />
                      <span>Privileges</span>
                    </span>
                    {selectedPrivileges.length === 0 ? (
                      <div className="rounded-xs border border-dashed border-ink-500 bg-ink-100 px-3 py-2 text-[12px] text-paper-faint">None selected.</div>
                    ) : (
                      <div className="flex flex-wrap gap-1 rounded-xs border border-ink-500 bg-ink-200 p-3">
                        {selectedPrivileges.map((p) => (
                          <span key={p} className="rounded-xs border border-ink-500 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">{p}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <span className={sectionLabelCls}>
                      <span className="h-px w-6 bg-ink-700" aria-hidden />
                      <span>Databases &amp; tables</span>
                    </span>
                    {scopes.length === 0 ? (
                      <div className="rounded-xs border border-dashed border-ink-500 bg-ink-100 px-3 py-2 text-[12px] text-paper-faint">None selected.</div>
                    ) : (
                      <div className="flex flex-wrap gap-1 rounded-xs border border-ink-500 bg-ink-200 p-3">
                        {scopes.map((s) => (
                          <span key={scopeKey(s)} className="rounded-xs border border-ink-500 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">{scopeLabel(s)}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {preservedGrants.length > 0 && (
                    <p className="text-[11px] text-amber-300">
                      {preservedGrants.length} column-level grant(s) on this role are preserved as-is.
                    </p>
                  )}
                  {selectedPrivileges.length > 0 && scopes.length === 0 && (
                    <p className="text-[11px] text-amber-300">Pick at least one database or table for the selected privileges to take effect.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-ink-500 px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => (step === 1 ? onClose() : setStep((step - 1) as Step))}
            disabled={saving}
            className="h-9 gap-1 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
          >
            {step === 1 ? "Cancel" : <><ArrowLeft className="h-3.5 w-3.5" /> Back</>}
          </Button>

          {step < 4 ? (
            <Button
              onClick={() => setStep((step + 1) as Step)}
              disabled={step === 1 && !nameValid}
              className="h-9 gap-1 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={saving}
              className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {isEditing ? "Updating" : "Creating"}</>
              ) : (
                <><CheckCircle2 className="h-3.5 w-3.5" /> {isEditing ? "Update role" : "Create role"}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ClickHouseRoleWizard;
