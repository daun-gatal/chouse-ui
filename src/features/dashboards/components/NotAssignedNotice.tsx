/**
 * Shown instead of a dashboard's panels when it is not assigned to the active
 * connection (ADR 0021 §3): a link from an alert, a chat or a colleague can
 * land here from any connection. It says which connections the dashboard is
 * for and switches to one; panels never run against a cluster it is not for.
 */

import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BTN_OUTLINE } from "@/components/charts/controlStyles";
import type { ScopeView } from "@/api/dashboards";
import { activateConnection } from "@/lib/activateConnection";
import { log } from "@/lib/log";

interface Props {
  scope: Extract<ScopeView, { kind: "only" }>;
  activeConnectionName: string | null;
}

export function NotAssignedNotice({ scope, activeConnectionName }: Props): React.ReactElement {
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState<string | null>(null);

  const switchTo = async (connection: { id: string; name: string }): Promise<void> => {
    setSwitching(connection.id);
    try {
      await activateConnection({ connectionId: connection.id, connectionName: connection.name, queryClient });
      // A full load, as Fleet does: the dock and every page re-initialise on the new connection.
      window.location.assign(`${window.location.pathname}${window.location.search}`);
    } catch (error) {
      log.error("[Dashboards] Failed to switch connection", { connectionId: connection.id, err: error instanceof Error ? error.message : String(error) });
      toast.error(`Could not switch to ${connection.name}`);
      setSwitching(null);
    }
  };

  const others = scope.hidden > 0 ? `${scope.hidden} connection${scope.hidden === 1 ? "" : "s"} you cannot use` : null;
  return (
    <div role="status" className="mx-auto mt-16 flex max-w-lg flex-col items-center gap-3 px-4 text-center" data-testid="not-assigned">
      <Database className="h-6 w-6 text-paper-faint" aria-hidden />
      <p className="text-sm text-paper">
        This dashboard is not assigned to {activeConnectionName ? <span className="font-mono">{activeConnectionName}</span> : "the connection you are on"}.
      </p>
      <p className="text-xs text-paper-dim">
        {scope.connections.length > 0
          ? `It is made for ${[...scope.connections.map((c) => c.name), ...(others ? [others] : [])].join(", ")}. Switch to one to see it.`
          : "It is made only for connections you cannot use."}
      </p>
      {scope.connections.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {scope.connections.map((c) => (
            <Button key={c.id} variant="outline" className={BTN_OUTLINE} disabled={switching !== null} onClick={() => void switchTo(c)}>
              {switching === c.id ? "Switching…" : `Switch to ${c.name}`}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
