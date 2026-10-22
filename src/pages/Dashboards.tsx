/**
 * Dashboards (ADR 0021): /dashboards lists them, /dashboards/:id shows one,
 * /dashboards/:id/snapshots/:snapshotId shows one of its snapshots (ADR 0023 §12).
 */

import React from "react";
import { useParams } from "react-router";

import { DashboardList, DashboardView, SnapshotView } from "@/features/dashboards";

export default function DashboardsPage(): React.ReactElement {
  const { id, snapshotId } = useParams();
  return (
    <div className="h-full w-full overflow-hidden bg-ink-50">
      {id && snapshotId ? <SnapshotView key={snapshotId} dashboardId={id} snapshotId={snapshotId} /> : id ? <DashboardView key={id} id={id} /> : <DashboardList />}
    </div>
  );
}
