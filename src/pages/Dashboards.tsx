/**
 * Dashboards (ADR 0021): /dashboards lists them, /dashboards/:id shows one.
 */

import React from "react";
import { useParams } from "react-router";

import { DashboardList, DashboardView } from "@/features/dashboards";

export default function DashboardsPage(): React.ReactElement {
  const { id } = useParams();
  return (
    <div className="h-full w-full overflow-hidden bg-ink-50">
      {id ? <DashboardView key={id} id={id} /> : <DashboardList />}
    </div>
  );
}
