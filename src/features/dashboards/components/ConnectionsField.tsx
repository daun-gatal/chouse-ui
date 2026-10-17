/**
 * The connections a dashboard is assigned to (ADR 0021 §3), shared by
 * Settings, the Connections dialog and the dialogs that create a dashboard.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";

import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { rbacConnectionsApi } from "@/api";
import type { ConnectionScope } from "@/api/dashboards";
import { FIELD_LABEL } from "@/components/charts/controlStyles";
import { useAuthStore } from "@/stores";

/** What keeps a scope from being saved, if anything. */
export function scopeProblem(scope: ConnectionScope): string | null {
  return scope.kind === "only" && scope.connectionIds.length === 0 ? "Connections: pick at least one, or All connections" : null;
}

/**
 * All connections, or the ones ticked. Assigned connections the editor cannot
 * use are not listed but stay assigned: they are someone else's to remove.
 */
export function ConnectionsField({ scope, onChange }: { scope: ConnectionScope; onChange: (scope: ConnectionScope) => void }): React.ReactElement {
  const connections = useQuery({ queryKey: ["rbac", "my-connections"], queryFn: () => rbacConnectionsApi.getMyConnections() });
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  const mine = connections.data ?? [];
  const ids = scope.kind === "only" ? scope.connectionIds : [];
  const kept = ids.filter((id) => !mine.some((c) => c.id === id)).length;
  const toggle = (id: string, on: boolean): void => onChange({ kind: "only", connectionIds: on ? [...ids, id] : ids.filter((x) => x !== id) });
  return (
    <div className="flex flex-col gap-2">
      <span className={FIELD_LABEL}>Connections — the dashboard is listed and runs only on these</span>
      <RadioGroup
        className="flex gap-4"
        value={scope.kind}
        onValueChange={(kind) => onChange(kind === "any" ? { kind: "any" } : { kind: "only", connectionIds: activeConnectionId ? [activeConnectionId] : [] })}
        aria-label="Connections"
      >
        <label className="flex items-center gap-2 text-xs text-paper"><RadioGroupItem value="any" /> All connections</label>
        <label className="flex items-center gap-2 text-xs text-paper"><RadioGroupItem value="only" /> Only these</label>
      </RadioGroup>
      {scope.kind === "only" && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-xs border border-ink-500 p-2">
          {connections.isError && <p role="alert" className="text-xs text-red-300">{connections.error.message}</p>}
          {mine.map((c) => (
            <label key={c.id} className="flex items-center gap-2 font-mono text-xs text-paper">
              <Checkbox checked={ids.includes(c.id)} onCheckedChange={(on) => toggle(c.id, on === true)} aria-label={`Assign to ${c.name}`} /> {c.name}
            </label>
          ))}
          {kept > 0 && <p className="w-full text-[11px] text-paper-faint">Also assigned to {kept} connection{kept === 1 ? "" : "s"} you cannot use; that stays as it is.</p>}
        </div>
      )}
    </div>
  );
}
