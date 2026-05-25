/**
 * FleetInventoryStrip — fleet-wide schema census: total databases, tables,
 * views, and rows summed across every node.
 *
 * Pure fold of the schema_totals metric already in each node's snapshot
 * (polled by the worker), so it costs no extra fetch and scales with the grid.
 * The sum is literal across nodes — replicas share a schema, so the sublabel
 * always names how many nodes reported, never implying a unique-object count.
 */

import { useMemo } from "react";
import { Database, Table2, Eye, Sigma, HardDrive } from "lucide-react";

import { aggregateFleetSchemaTotals } from "@/hooks/useFleetMetrics";
import type { FleetConnectionSnapshot } from "@/api";
import { cn, formatBytes, formatCompactNumber } from "@/lib/utils";

type Accent = "paper" | "brand" | "muted";

interface FleetInventoryStripProps {
  snapshots: FleetConnectionSnapshot[];
  /** Total active nodes in the fleet — to show "N of M reporting" coverage. */
  nodeCount: number;
  /** Snapshots still loading on first paint. */
  isLoading?: boolean;
}

export default function FleetInventoryStrip({
  snapshots,
  nodeCount,
  isLoading = false,
}: FleetInventoryStripProps) {
  const totals = useMemo(() => aggregateFleetSchemaTotals(snapshots), [snapshots]);
  const reporting = totals.nodesReporting;
  // No node has a schema_totals snapshot yet — worker is warming up (or off).
  const collecting = reporting === 0;

  const coverage =
    reporting === 0
      ? "collecting…"
      : reporting === nodeCount
        ? `across ${nodeCount} ${nodeCount === 1 ? "node" : "nodes"}`
        : `${reporting} of ${nodeCount} nodes reporting`;

  const tiles: {
    icon: typeof Database;
    label: string;
    value: number;
    accent: Accent;
    format?: "count" | "compact" | "bytes";
  }[] = [
    // Uniform neutral values — these five are independent metrics, not a
    // tables-vs-views comparison, so one tile in brand just reads as a mistake.
    // Labels + icons carry the distinction.
    { icon: Database, label: "Databases", value: totals.databases, accent: "paper" },
    { icon: Table2, label: "Tables", value: totals.tables, accent: "paper" },
    { icon: Eye, label: "Views", value: totals.views, accent: "paper" },
    { icon: Sigma, label: "Total rows", value: totals.rows, accent: "paper", format: "compact" },
    { icon: HardDrive, label: "Storage consumed", value: totals.bytes, accent: "paper", format: "bytes" },
  ];

  return (
    <section aria-label="Fleet inventory" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {tiles.map((t) => (
        <Tile
          key={t.label}
          icon={t.icon}
          label={t.label}
          value={t.value}
          accent={t.accent}
          format={t.format}
          coverage={coverage}
          loading={isLoading && collecting}
          empty={!isLoading && collecting}
        />
      ))}
    </section>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  accent,
  format = "count",
  coverage,
  loading,
  empty,
}: {
  icon: typeof Database;
  label: string;
  value: number;
  accent: Accent;
  format?: "count" | "compact" | "bytes";
  coverage: string;
  loading: boolean;
  empty: boolean;
}) {
  const valueColor =
    accent === "brand" ? "text-brand" : accent === "muted" ? "text-paper-muted" : "text-paper";

  const display =
    format === "bytes"
      ? formatBytes(value)
      : format === "compact"
        ? formatCompactNumber(value)
        : value.toLocaleString();

  return (
    <div className="rounded-md border border-ink-500 bg-ink-100 px-4 py-3.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          {label}
        </span>
        <Icon className="h-4 w-4 text-paper-dim" aria-hidden />
      </div>
      {loading ? (
        <div className="mt-1.5 h-6 w-16 animate-pulse rounded-xs bg-ink-300" aria-hidden />
      ) : (
        <div
          className={cn(
            "mt-1 font-mono text-[24px] leading-none tabular-nums",
            empty ? "text-paper-faint" : valueColor
          )}
        >
          {empty ? "—" : display}
        </div>
      )}
      <div className="mt-2 font-mono text-[10px] tracking-[0.1em] text-paper-faint">
        {coverage}
      </div>
    </div>
  );
}
