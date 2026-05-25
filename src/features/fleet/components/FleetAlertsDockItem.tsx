/**
 * FleetAlertsDockItem — hosts the fleet alert engine in the global dock so
 * alerts evaluate (and the bell badges) on every page, not just /fleet.
 *
 * Self-contained: it fetches the connection list + snapshot cache itself (the
 * same React Query keys the Fleet page uses, so they dedupe to one poll) and
 * runs the evaluator. Mount it once in the dock; it must NOT also run on the
 * Fleet page or alerts would fire twice.
 */

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { FleetConnectionSnapshot } from "@/api/fleet";
import { activateConnection } from "@/lib/activateConnection";
import { useFleetConnections, useFleetSnapshots } from "@/hooks/useFleetMetrics";
import { useFleetAlerts } from "@/hooks/useFleetAlerts";
import { useRbacStore } from "@/stores";
import FleetAlertsBell from "./FleetAlertsBell";
import FleetAlertDeliveryDialog from "./FleetAlertDeliveryDialog";

export default function FleetAlertsDockItem({
  side = "right",
}: {
  side?: "top" | "right" | "bottom" | "left";
}) {
  const connectionsQuery = useFleetConnections();
  const connections = useMemo(
    () =>
      (connectionsQuery.data ?? [])
        .filter((c) => c.isActive)
        .map((c) => ({ id: c.id, name: c.name })),
    [connectionsQuery.data],
  );

  // Keep polling even when this tab is backgrounded (operator switched to
  // another tab/app) so alerts still fire + raise a desktop notification.
  // Browsers throttle hidden-tab timers, so the cadence may stretch toward ~1
  // min while hidden — fine for alerting, and it resumes full speed on focus.
  const snapshotsQuery = useFleetSnapshots(10_000, { refetchIntervalInBackground: true });
  const snapshotsByConnection = useMemo(() => {
    const m = new Map<string, FleetConnectionSnapshot | undefined>();
    for (const s of snapshotsQuery.data?.connections ?? []) m.set(s.connectionId, s);
    return m;
  }, [snapshotsQuery.data]);

  const queryClient = useQueryClient();

  const investigateNode = useCallback(
    async (connectionId: string) => {
      try {
        await activateConnection({
          connectionId,
          connectionName: connections.find((c) => c.id === connectionId)?.name,
          queryClient,
        });
        // Full navigation so the app re-initialises on the new connection.
        window.location.assign("/monitoring/live-queries");
      } catch {
        toast.error("Could not connect to this node");
      }
    },
    [connections, queryClient],
  );

  const alerts = useFleetAlerts(connections, snapshotsByConnection, investigateNode);

  // Always-on delivery (Slack/email) is a global, secret-bearing config — expose
  // its editor only to super admins (the backend enforces this too).
  const isSuperAdmin = useRbacStore((s) => s.isSuperAdmin());
  const [deliveryOpen, setDeliveryOpen] = useState(false);

  return (
    <>
      <FleetAlertsBell
        alerts={alerts}
        onInvestigate={investigateNode}
        onConfigureDelivery={isSuperAdmin ? () => setDeliveryOpen(true) : undefined}
        side={side}
      />
      {isSuperAdmin && (
        <FleetAlertDeliveryDialog open={deliveryOpen} onOpenChange={setDeliveryOpen} />
      )}
    </>
  );
}
