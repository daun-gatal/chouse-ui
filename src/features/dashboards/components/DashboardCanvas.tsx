/**
 * The dashboard canvas (ADR 0023 §1): panels on a 24-column grid of 32 px rows
 * with 8 px gaps. While editing, panels drag anywhere by their handle and
 * resize from any edge or corner, never below their kind's minimum; panels
 * move up into gaps. Narrower than 768 px, panels stack in reading order at
 * full width and keep their height.
 */

import React, { useMemo } from "react";
import { GridLayout, useContainerWidth, type Layout as GridItems, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";

import type { PanelInput } from "@/api/dashboards";
import { GRID_COLUMNS, ROW_GAP_PX, ROW_HEIGHT_PX, rowsToPx, sizeLimits, type Layout } from "@/lib/viz/spec";

import { DRAG_HANDLE_CLASS } from "./PanelCard";

/** Below this width the canvas stacks panels instead of placing them. */
export const STACK_BELOW_PX = 768;
const RESIZE_HANDLES = ["s", "e", "w", "n", "se", "sw", "ne", "nw"] as const;

export interface CanvasItem {
  /** Stable key for React and the grid, independent of the stored id. */
  key: string;
  panel: PanelInput;
}

interface Props {
  items: CanvasItem[];
  editing: boolean;
  /** Called with every panel's place after a drag, a resize or compaction (editing only). */
  onLayoutChange: (layouts: Map<string, Layout>) => void;
  /** Draws one panel, given its height in pixels. */
  renderItem: (item: CanvasItem, heightPx: number) => React.ReactNode;
}

/** Panels top to bottom, then left to right — the order a narrow screen stacks them in. */
export function readingOrder<T extends { panel: { layout: Layout } }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.panel.layout.y - b.panel.layout.y || a.panel.layout.x - b.panel.layout.x);
}

function gridItem(item: CanvasItem, editing: boolean): LayoutItem {
  const limits = sizeLimits(item.panel.kind, item.panel.kind === "chart" ? item.panel.viz.type : null);
  const { x, y, w, h } = item.panel.layout;
  return { i: item.key, x, y, w, h, minW: limits.minW, minH: limits.minH, maxH: limits.maxH, static: !editing };
}

export function DashboardCanvas({ items, editing, onLayoutChange, renderItem }: Props): React.ReactElement {
  // Measured before the first render: drawing at a guessed width and then switching to the stacked
  // layout would mount every panel twice, and run its query twice.
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const layout = useMemo<GridItems>(() => items.map((item) => gridItem(item, editing)), [items, editing]);
  const stacked = mounted && width < STACK_BELOW_PX;

  const changed = (next: GridItems): void => {
    if (!editing) return;
    const places = new Map<string, Layout>(next.map((l) => [l.i, { x: l.x, y: l.y, w: l.w, h: l.h }]));
    const moved = items.some((item) => {
      const place = places.get(item.key);
      return place !== undefined && (place.x !== item.panel.layout.x || place.y !== item.panel.layout.y || place.w !== item.panel.layout.w || place.h !== item.panel.layout.h);
    });
    if (moved) onLayoutChange(places);
  };

  return (
    <div ref={containerRef} className="dashboard-canvas min-w-0" data-testid="panel-grid" data-editing={editing ? "true" : "false"}>
      {stacked ? (
        <div className="flex flex-col" style={{ gap: ROW_GAP_PX }}>
          {readingOrder(items).map((item) => (
            <div key={item.key} style={{ height: rowsToPx(item.panel.layout.h) }}>{renderItem(item, rowsToPx(item.panel.layout.h))}</div>
          ))}
        </div>
      ) : mounted ? (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: GRID_COLUMNS, rowHeight: ROW_HEIGHT_PX, margin: [ROW_GAP_PX, ROW_GAP_PX], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing, handle: `.${DRAG_HANDLE_CLASS}`, bounded: false, threshold: 3 }}
          resizeConfig={{ enabled: editing, handles: RESIZE_HANDLES }}
          onLayoutChange={changed}
        >
          {items.map((item) => (
            <div key={item.key} data-panel-key={item.key}>
              {renderItem(item, rowsToPx(item.panel.layout.h))}
            </div>
          ))}
        </GridLayout>
      ) : null}
    </div>
  );
}
