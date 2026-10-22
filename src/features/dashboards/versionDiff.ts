/**
 * What restoring a kept version would change (ADR 0023 §11), described from the
 * current dashboard's side: "restoring brings back X, removes Y, changes Z".
 * Panels are matched by id; a panel without an id cannot be in a saved version.
 */

import type { DashboardInput, PanelInput } from "@/api/dashboards";

export interface PanelChange {
  id: string;
  title: string;
  /** What differs on a panel both versions have. */
  parts: Array<"title" | "query" | "chart" | "text" | "position">;
}

export interface VersionDiff {
  /** Dashboard-level settings that differ. */
  settings: Array<"title" | "description" | "time range" | "refresh" | "connections" | "variables" | "annotations">;
  /** Panels the old version has and the current one does not. */
  added: Array<{ id: string; title: string }>;
  /** Panels the current version has and the old one does not. */
  removed: Array<{ id: string; title: string }>;
  changed: PanelChange[];
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function panelLabel(panel: PanelInput): string {
  if (panel.title.trim() !== "") return panel.title;
  return panel.kind === "text" ? "Untitled text" : panel.kind === "heading" ? "Untitled heading" : "Untitled chart";
}

function panelParts(current: PanelInput, old: PanelInput): PanelChange["parts"] {
  const parts: PanelChange["parts"] = [];
  if (current.title !== old.title) parts.push("title");
  if (current.kind !== old.kind) return [...parts, current.kind === "chart" || old.kind === "chart" ? "chart" : "text"];
  if (current.kind === "chart" && old.kind === "chart") {
    if (current.sql !== old.sql) parts.push("query");
    if (!same(current.viz, old.viz) || current.fleet !== old.fleet) parts.push("chart");
  }
  if (current.kind === "text" && old.kind === "text" && current.markdown !== old.markdown) parts.push("text");
  if (current.kind === "heading" && old.kind === "heading" && current.description !== old.description) parts.push("text");
  if (!same(current.layout, old.layout)) parts.push("position");
  return parts;
}

export function diffVersions(current: DashboardInput, old: DashboardInput): VersionDiff {
  const settings: VersionDiff["settings"] = [];
  if (current.title !== old.title) settings.push("title");
  if (current.description !== old.description) settings.push("description");
  if (!same(current.timeRange, old.timeRange)) settings.push("time range");
  if (current.refreshSeconds !== old.refreshSeconds) settings.push("refresh");
  if (!same(current.connectionScope, old.connectionScope)) settings.push("connections");
  if (!same(current.variables, old.variables)) settings.push("variables");
  if (!same([...current.annotations].sort(), [...old.annotations].sort())) settings.push("annotations");

  const byId = (panels: PanelInput[]): Map<string, PanelInput> => new Map(panels.flatMap((p) => (p.id === null ? [] : [[p.id, p] as const])));
  const now = byId(current.panels);
  const then = byId(old.panels);
  const added = [...then.values()].filter((p) => p.id !== null && !now.has(p.id)).map((p) => ({ id: p.id ?? "", title: panelLabel(p) }));
  const removed = [...now.values()].filter((p) => p.id !== null && !then.has(p.id)).map((p) => ({ id: p.id ?? "", title: panelLabel(p) }));
  const changed: PanelChange[] = [];
  for (const [id, panel] of now) {
    const before = then.get(id);
    if (!before) continue;
    const parts = panelParts(panel, before);
    if (parts.length > 0) changed.push({ id, title: panelLabel(panel), parts });
  }
  return { settings, added, removed, changed };
}

export function isEmptyDiff(diff: VersionDiff): boolean {
  return diff.settings.length === 0 && diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}
