/**
 * Dashboards › Ask AI › preview: the included panels as they will be saved —
 * placed by the server's layout engine, each running its query through the
 * unsaved-panel preview with the dashboard's range and the variables'
 * defaults. A panel runs once it scrolls near the screen, at most three at a
 * time, so a long draft does not fire every query at once.
 */

import React, { useMemo, type RefObject } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Layers, Loader2 } from "lucide-react";

import { PanelMessage, PanelVisual } from "@/components/charts/PanelVisual";
import { getConnectionId } from "@/api/client";
import { arrangePanels, previewPanel, type ArrangeSection, type ChartPanelInput, type ConnectionScope } from "@/api/dashboards";
import { useDebounce, useInView } from "@/hooks";
import { createLimiter } from "@/lib/limiter";
import { cn } from "@/lib/utils";
import type { TimeRange, Variable, VariableValues } from "@/lib/viz/spec";

import type { ReviewPanel } from "../askAi";
import { DashboardCanvas, type CanvasItem } from "./DashboardCanvas";
import { HeadingPanelCard } from "./PanelCard";

const previewLimit = createLimiter(3);
/**
 * Outside the ["dashboards"] prefix on purpose: a save invalidates that prefix,
 * and the review's previews must not run again (and hold the save up) for it.
 */
export const askAiKeys = {
  arrange: (sections: ArrangeSection[]) => ["ask-ai-draft", "arrange", sections] as const,
  preview: (...parts: unknown[]) => ["ask-ai-draft", "preview", ...parts] as const,
};
const noop = (): void => undefined;
/** Card header and padding around the chart (PanelCard's chrome, without the footer). */
const CARD_CHROME_PX = 40 + 24;

export interface PreviewRun {
  /** Why nothing runs (null when panels run): no query permission, or the connection changed. */
  blocked: string | null;
  connectionId: string | null;
  connectionScope: ConnectionScope;
  range: TimeRange;
  variables: Variable[];
  values: VariableValues;
}

interface Props {
  panels: ReviewPanel[];
  sections: ArrangeSection[];
  run: PreviewRun;
  /** Panels already on the dashboard the new ones go below. */
  existingPanels: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The element the preview scrolls in: panels start running a little before they reach it. */
  scrollRoot: RefObject<HTMLElement | null>;
}

export function AskAiPreview({ panels, sections, run, existingPanels, selectedId, onSelect, scrollRoot }: Props): React.ReactElement {
  // Waits for ticking to settle, so quick changes ask the layout engine once.
  const settled = useDebounce(sections, 250);
  const arrange = useQuery({
    queryKey: askAiKeys.arrange(settled),
    queryFn: () => arrangePanels(settled),
    enabled: settled.length > 0,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });

  const byId = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  const items = useMemo<CanvasItem[]>(() => {
    if (sections.length === 0 || !arrange.data) return [];
    const included = new Set(sections.flatMap((s) => s.panels.map((p) => p.key)));
    const out: CanvasItem[] = [];
    arrange.data.placed.forEach((placed, i) => {
      if (placed.key === null) {
        out.push({ key: `heading-${i}-${placed.heading.title}`, panel: { id: null, kind: "heading", title: placed.heading.title, description: placed.heading.description, layout: placed.layout } });
        return;
      }
      // A placement from before the latest change can name a panel that is no longer in.
      const chart = included.has(placed.key) ? byId.get(placed.key)?.draft.panel : null;
      if (chart) out.push({ key: placed.key, panel: { ...chart, layout: placed.layout } });
    });
    return out;
  }, [arrange.data, sections, byId]);

  if (sections.length === 0) {
    return <div className="p-4 sm:p-6"><PanelMessage tone="muted">No panels are selected. Tick the ones you want to see them here.</PanelMessage></div>;
  }

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4" data-testid="draft-preview">
      {existingPanels > 0 && (
        <p className="flex items-center gap-2 rounded-xs border border-dashed border-ink-500 px-3 py-2 text-xs text-paper-dim" data-testid="existing-panels-note">
          <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden /> {existingPanels} existing panel{existingPanels === 1 ? "" : "s"} above — the new ones are added below them.
        </p>
      )}
      {run.blocked && <p className="rounded-xs border border-ink-500 px-3 py-2 text-xs text-paper-dim" data-testid="preview-blocked">{run.blocked}</p>}
      {arrange.isError && <p role="alert" className="text-xs text-red-300">Could not lay the panels out: {arrange.error.message}</p>}
      {!arrange.data && arrange.isFetching && <PanelMessage tone="muted">Laying out the panels…</PanelMessage>}
      {items.length > 0 && (
        <DashboardCanvas
          items={items}
          editing={false}
          onLayoutChange={noop}
          renderItem={(item, height) => {
            const panel = item.panel;
            if (panel.kind === "heading") return <HeadingPanelCard panel={panel} editing={false} onEdit={noop} onRemove={noop} />;
            if (panel.kind !== "chart") return null;
            const review = byId.get(item.key);
            return (
              <DraftPreviewCard
                panel={panel}
                height={height}
                status={review?.draft.status ?? "ok"}
                selected={selectedId === item.key}
                onSelect={() => onSelect(item.key)}
                run={run}
                scrollRoot={scrollRoot}
              />
            );
          }}
        />
      )}
    </div>
  );
}

interface CardProps {
  panel: ChartPanelInput;
  height: number;
  status: ReviewPanel["draft"]["status"];
  selected: boolean;
  onSelect: () => void;
  run: PreviewRun;
  scrollRoot: RefObject<HTMLElement | null>;
}

function DraftPreviewCard({ panel, height, status, selected, onSelect, run, scrollRoot }: CardProps): React.ReactElement {
  const [ref, seen] = useInView<HTMLElement>({ root: scrollRoot });
  const { sql, fleet } = panel;
  const preview = useQuery({
    // The chart settings are not in the key: a fix to the chart redraws the result without running it again.
    queryKey: askAiKeys.preview(run.connectionId, sql, fleet, run.variables, run.values, run.range, run.connectionScope),
    queryFn: ({ signal }) => previewLimit(
      () => {
        // A request goes to the dock's active connection: one that waited for a slot while the user
        // switched must not run there and be kept as this connection's result.
        if (getConnectionId() !== run.connectionId) throw new Error("The connection changed before this panel ran");
        return previewPanel({ sql, viz: panel.viz, fleet, variables: run.variables, values: run.values, range: run.range, connectionScope: run.connectionScope }, signal);
      },
      signal,
    ),
    enabled: seen && run.blocked === null,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const result = preview.data?.result;
  const chartHeight = Math.max(48, height - CARD_CHROME_PX);

  return (
    <section
      ref={ref}
      className={cn("flex h-full min-w-0 flex-col overflow-hidden rounded-md border bg-ink-100", selected ? "border-brand ring-1 ring-brand" : "border-ink-500")}
      aria-label={panel.title}
      data-testid="draft-preview-card"
    >
      <button type="button" onClick={onSelect} className="flex h-10 shrink-0 items-center gap-2 border-b border-ink-500 px-3 text-left hover:bg-ink-200" aria-label={`Show details of ${panel.title}`}>
        {status === "attention" ? <CircleAlert className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-label="Check this" /> : <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-label="Checked" />}
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-paper" title={panel.title}>{panel.title}</h3>
      </button>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-3">
        {run.blocked !== null ? (
          <PanelMessage tone="muted">Not run</PanelMessage>
        ) : preview.isError ? (
          <PanelMessage tone="error">{preview.error.message}</PanelMessage>
        ) : result?.kind === "single" ? (
          <PanelVisual spec={panel.viz} data={result.data} height={chartHeight} title={panel.title} />
        ) : result ? (
          <PanelMessage tone="muted">Runs on every connection once added</PanelMessage>
        ) : (
          <div className="flex h-full items-center justify-center" aria-label="Loading preview"><Loader2 className="h-4 w-4 animate-spin text-paper-faint" aria-hidden /></div>
        )}
      </div>
    </section>
  );
}
