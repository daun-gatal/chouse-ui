import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Play, Plus, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import type { DataHealthPromise } from "@/api/dataHealth";
import { useDataHealthPromises, useDeleteDataHealthPromise, useRunDataHealthPromise } from "./hooks";
import { DH_LABEL, DH_PRIMARY, HealthBadge, formatHealthTime } from "./lib";
import { PromiseDetail } from "./PromiseDetail";
import { PromiseWizard } from "./PromiseWizard";

export function DatasetsTab({ selectedPromiseId, onSelectedPromiseChange }: { selectedPromiseId?: string; onSelectedPromiseChange: (id?: string) => void }) {
  const { data: promises = [], isLoading } = useDataHealthPromises();
  const canEdit = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_EDIT));
  const canRun = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_RUN));
  const canDelete = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_DELETE));
  const runMutation = useRunDataHealthPromise();
  const deleteMutation = useDeleteDataHealthPromise();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<DataHealthPromise>();
  const [deleting, setDeleting] = useState<DataHealthPromise>();
  const selected = promises.find((promise) => promise.id === selectedPromiseId);
  const filtered = useMemo(() => promises.filter((promise) => (status === "all" || promise.status === status) && (!search.trim() || `${promise.name} ${promise.databaseName ?? ""} ${promise.tableName ?? ""}`.toLowerCase().includes(search.toLowerCase()))), [promises, search, status]);

  const openNewPromise = (): void => {
    setEditing(undefined);
    setWizardOpen(true);
  };
  const closeWizard = (open: boolean): void => {
    setWizardOpen(open);
    if (!open) setEditing(undefined);
  };

  if (selected) {
    return (
      <div className="space-y-4">
        {canEdit && (
          <div className="flex justify-end">
            <Button
              data-onboarding-id="dataops-health-create"
              className={DH_PRIMARY}
              onClick={openNewPromise}
            >
              <Plus className="h-3.5 w-3.5" /> New promise
            </Button>
          </div>
        )}
        <PromiseDetail
          id={selected.id}
          onBack={() => onSelectedPromiseChange(undefined)}
          onEdit={() => {
            setEditing(selected);
            setWizardOpen(true);
          }}
        />
        <PromiseWizard open={wizardOpen} onOpenChange={closeWizard} promise={editing} />
      </div>
    );
  }
  const run = async (promise: DataHealthPromise) => { try { const result = await runMutation.mutateAsync(promise.id); toast[result?.status === "success" ? "success" : "error"](result?.status === "success" ? "Evaluation completed" : result?.message ?? "Evaluation failed"); } catch (error) { toast.error(error instanceof Error ? error.message : "Evaluation failed"); } };
  const remove = async () => { if (!deleting) return; try { await deleteMutation.mutateAsync(deleting.id); toast.success("Data Health promise deleted"); } catch (error) { toast.error(error instanceof Error ? error.message : "Delete failed"); } finally { setDeleting(undefined); } };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2"><div className="relative min-w-56 flex-1"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-faint" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search datasets…" className="h-9 rounded-xs pl-8" /></div><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 w-40 rounded-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All health states</SelectItem><SelectItem value="healthy">Healthy</SelectItem><SelectItem value="degraded">Degraded</SelectItem><SelectItem value="unhealthy">Unhealthy</SelectItem><SelectItem value="unknown">Unknown</SelectItem><SelectItem value="paused">Paused</SelectItem></SelectContent></Select>{canEdit && <Button data-onboarding-id="dataops-health-create" className={DH_PRIMARY} onClick={openNewPromise}><Plus className="h-3.5 w-3.5" /> New promise</Button>}</div>
      <p className={DH_LABEL}>{filtered.length} of {promises.length} dataset(s)</p>
      {isLoading ? <p className="text-[12px] text-paper-muted">Loading datasets…</p> : filtered.length === 0 ? <Card className="rounded-xs border-ink-500 bg-ink-100 p-10 text-center"><p className="text-[13px] text-paper-muted">{promises.length === 0 ? "No datasets are protected yet." : "No datasets match these filters."}</p>{canEdit && promises.length === 0 && <Button className={`${DH_PRIMARY} mt-4`} onClick={() => setWizardOpen(true)}><Plus className="h-3.5 w-3.5" /> Protect a dataset</Button>}</Card> : <div className="space-y-2">{filtered.map((promise) => <Card key={promise.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xs border-ink-500 bg-ink-100 p-4"><button type="button" onClick={() => onSelectedPromiseChange(promise.id)} className="min-w-0 flex-1 text-left"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-[13px] font-medium text-paper">{promise.name}</span><HealthBadge state={promise.status} /><span className="font-mono text-[9px] uppercase text-paper-faint">{promise.criticality}</span></div><p className="mt-1 truncate font-mono text-[10px] text-paper-muted">{promise.databaseName && promise.tableName ? `${promise.databaseName}.${promise.tableName}` : "Custom query"} · {promise.checks.length} checks · last healthy {formatHealthTime(promise.lastHealthyAt)}</p></button><div className="flex gap-1">{canRun && <Button variant="ghost" size="icon" title="Evaluate now" onClick={() => void run(promise)}><Play className="h-3.5 w-3.5" /></Button>}{canEdit && <Button variant="ghost" size="icon" title="Edit" onClick={() => { setEditing(promise); setWizardOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>}{canDelete && <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleting(promise)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>}</div></Card>)}</div>}
      <PromiseWizard open={wizardOpen} onOpenChange={closeWizard} promise={editing} />
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(undefined)}><AlertDialogContent className="rounded-xs border-ink-500 bg-ink-100"><AlertDialogHeader><AlertDialogTitle>Delete Data Health promise?</AlertDialogTitle><AlertDialogDescription>This removes the generated monitor, metric history, and incident history for {deleting?.name}. This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={() => void remove()}>Delete promise</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}
