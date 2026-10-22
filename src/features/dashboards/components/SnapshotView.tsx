/**
 * A snapshot (ADR 0023 §12): the dashboard as it was saved, drawn from the
 * frozen results. Nothing runs. The server has already re-checked each panel
 * against the viewer's own data access; a panel they may not read arrives as
 * "Access denied".
 */

import React, { useMemo } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera } from "lucide-react";

import { getSnapshot } from "@/api/dashboards";
import { formatValue } from "@/lib/viz/units";

import { DashboardCanvas, type CanvasItem } from "./DashboardCanvas";
import { HeadingPanelCard, StaticChartCard, TextPanelCard } from "./PanelCard";

const noop = (): void => undefined;

export function SnapshotView({ dashboardId, snapshotId }: { dashboardId: string; snapshotId: string }): React.ReactElement {
  const snapshot = useQuery({ queryKey: ["dashboards", "snapshot", dashboardId, snapshotId], queryFn: () => getSnapshot(dashboardId, snapshotId), retry: false });
  const items = useMemo<CanvasItem[]>(
    () => (snapshot.data?.document.panels ?? []).map((panel, i) => ({ key: panel.id ?? `p${i}`, panel })),
    [snapshot.data],
  );

  if (snapshot.isPending) return <p className="p-6 text-sm text-paper-faint">Loading snapshot…</p>;
  if (snapshot.isError) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p role="alert" className="text-sm text-red-300">{snapshot.error.message}</p>
        <Link to={`/dashboards/${dashboardId}`} className="text-xs text-paper-muted underline">Open the live dashboard</Link>
      </div>
    );
  }
  const s = snapshot.data;
  const from = new Date(s.range.from * 1000);
  const to = new Date(s.range.to * 1000);
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b border-ink-500 px-4 py-3 sm:px-6">
        <Link to={`/dashboards/${dashboardId}`} aria-label="Back to the live dashboard" className="text-paper-dim hover:text-paper"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-lg font-semibold text-paper"><Camera className="h-4 w-4 shrink-0 text-yellow-300" aria-hidden /> {s.name}</h1>
          <p className="truncate text-xs text-paper-dim">
            Snapshot of {s.document.title} · {from.toLocaleString()} – {to.toLocaleString()}
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint" data-testid="snapshot-meta">
          by {s.createdByName ?? "a removed user"} · {formatValue(s.sizeBytes, "bytes")} · expires {new Date(s.expiresAt).toLocaleDateString()}
        </p>
      </header>
      <div className="p-4 sm:p-6">
        <DashboardCanvas
          items={items}
          editing={false}
          onLayoutChange={noop}
          renderItem={(item, height) => {
            const panel = item.panel;
            if (panel.kind === "text") return <TextPanelCard panel={panel} editing={false} onEdit={noop} onRemove={noop} />;
            if (panel.kind === "heading") return <HeadingPanelCard panel={panel} editing={false} onEdit={noop} onRemove={noop} />;
            return <StaticChartCard panel={panel} result={panel.id === null ? undefined : s.results[panel.id]} height={height} />;
          }}
        />
      </div>
    </div>
  );
}
