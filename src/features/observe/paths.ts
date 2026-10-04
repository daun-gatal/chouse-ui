/**
 * URL scheme of the Data page (ADR 0016 §14) and the static map from the old
 * `/dataops/*` URLs, so bookmarks keep working after the cut-over.
 */

import type { IncidentSource } from "@/api/observe";

export const DATA_TABS = ["overview", "incidents", "lineage", "pipelines", "datasets", "coverage", "context", "scheduled-queries"] as const;
export type DataTab = (typeof DATA_TABS)[number];

export function isDataTab(value: string | undefined): value is DataTab {
  return DATA_TABS.some((tab) => tab === value);
}

export const dataPaths = {
  tab: (tab: DataTab): string => `/data/${tab}`,
  incident: (source: IncidentSource, id: string): string => `/data/incidents/${source}/${encodeURIComponent(id)}`,
  dataset: (database: string, table: string): string => `/data/datasets/${encodeURIComponent(database)}/${encodeURIComponent(table)}`,
  promises: (): string => "/data/datasets?view=promises",
  lineage: (node: string): string => `/data/lineage?node=${encodeURIComponent(node)}`,
  pipelines: (status?: string): string => (status ? `/data/pipelines?status=${encodeURIComponent(status)}` : "/data/pipelines"),
  context: (database: string, table: string): string => `/data/context?table=${encodeURIComponent(`${database}.${table}`)}`,
  scheduled: (sub: "overview" | "jobs"): string => `/data/scheduled-queries/${sub}`,
};

/** Where an old `/dataops/:feature/:sub` URL lives now. */
export function legacyDataOpsPath(feature: string | undefined, sub: string | undefined): string {
  if (feature === "scheduled-queries") {
    return dataPaths.scheduled(sub === "jobs" || sub === "runs" || sub === "lineage" ? "jobs" : "overview");
  }
  if (feature === "data-health") {
    if (sub === "incidents") return dataPaths.tab("incidents");
    if (sub === "overview") return "/data/datasets?view=health";
    return dataPaths.promises();
  }
  return "/data";
}
