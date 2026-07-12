import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BellOff, Check, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { useAcknowledgeIncident, useDataHealthIncidents, useDataHealthPromises, useSnoozeIncident } from "./hooks";
import { DH_LABEL, formatHealthTime } from "./lib";

export function IncidentsTab({ onSelectPromise }: { onSelectPromise: (id: string) => void }) {
  const { data: incidents = [], isLoading } = useDataHealthIncidents();
  const { data: promises = [] } = useDataHealthPromises();
  const canEdit = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_EDIT));
  const acknowledge = useAcknowledgeIncident();
  const snooze = useSnoozeIncident();
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const promiseNames = useMemo(() => new Map(promises.map((promise) => [promise.id, promise.name])), [promises]);
  const filtered = incidents.filter((incident) => {
    const active = incident.status !== "recovered";
    if (status === "active" && !active) return false;
    if (status === "recovered" && active) return false;
    const term = search.trim().toLowerCase();
    return !term || incident.summary.toLowerCase().includes(term) || (promiseNames.get(incident.promiseId) ?? "").toLowerCase().includes(term);
  });

  const handleAcknowledge = async (id: string) => {
    try { await acknowledge.mutateAsync(id); toast.success("Incident acknowledged"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not acknowledge incident"); }
  };
  const handleSnooze = async (id: string) => {
    try { await snooze.mutateAsync({ id, until: Date.now() + 60 * 60 * 1000 }); toast.success("Incident snoozed for one hour"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not snooze incident"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-faint" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search incidents…" className="h-9 rounded-xs pl-8" /></div>
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 w-40 rounded-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="recovered">Recovered</SelectItem><SelectItem value="all">All incidents</SelectItem></SelectContent></Select>
      </div>
      <p className={DH_LABEL}>{filtered.length} incident(s)</p>
      {isLoading ? <p className="text-[12px] text-paper-muted">Loading incidents…</p> : filtered.length === 0 ? (
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-10 text-center text-[13px] text-paper-muted">No incidents match this view.</Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((incident) => (
            <Card key={incident.id} className="rounded-xs border-ink-500 bg-ink-100 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button type="button" onClick={() => onSelectPromise(incident.promiseId)} className="min-w-0 text-left">
                  <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${incident.severity === "critical" ? "bg-red-500" : "bg-amber-500"}`} /><p className="truncate text-[13px] font-medium text-paper">{promiseNames.get(incident.promiseId) ?? "Dataset promise"}</p><span className="font-mono text-[9px] uppercase text-paper-faint">{incident.status}</span></div>
                  <p className="mt-2 text-[12px] text-paper-muted">{incident.summary}</p>
                  <p className="mt-1 font-mono text-[10px] text-paper-faint">Opened {formatHealthTime(incident.openedAt)} · last event {formatHealthTime(incident.lastEventAt)}</p>
                </button>
                {canEdit && incident.status !== "recovered" && <div className="flex gap-1"><Button variant="outline" size="sm" className="h-8 rounded-xs" onClick={() => void handleAcknowledge(incident.id)} disabled={acknowledge.isPending}><Check className="mr-1 h-3.5 w-3.5" /> Acknowledge</Button><Button variant="ghost" size="sm" className="h-8 rounded-xs" onClick={() => void handleSnooze(incident.id)} disabled={snooze.isPending}><BellOff className="mr-1 h-3.5 w-3.5" /> Snooze 1h</Button></div>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

