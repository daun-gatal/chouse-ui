/**
 * The dashboards list's tab, search, sort and page, kept in the URL so a
 * filtered list survives a reload and Back from a dashboard.
 */

import type { DashboardSummary } from "@/api/dashboards";

export const LIST_TABS = ["all", "mine", "shared", "pinned", "templates"] as const;
export type ListTab = (typeof LIST_TABS)[number];

export const LIST_SORTS = ["updated", "title", "panels"] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export const PAGE_SIZE = 25;

export interface ListParams {
  tab: ListTab;
  q: string;
  sort: ListSort;
  /** 1-based. */
  page: number;
}

function oneOf<T extends string>(values: readonly T[], value: string | null, fallback: T): T {
  return values.find((v) => v === value) ?? fallback;
}

export function parseListParams(params: URLSearchParams): ListParams {
  const page = Number(params.get("page") ?? "1");
  return {
    tab: oneOf(LIST_TABS, params.get("tab"), "all"),
    q: (params.get("q") ?? "").slice(0, 200),
    sort: oneOf(LIST_SORTS, params.get("sort"), "updated"),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Writes only what differs from the defaults, so the plain list stays /dashboards. */
export function writeListParams(next: ListParams): URLSearchParams {
  const params = new URLSearchParams();
  if (next.tab !== "all") params.set("tab", next.tab);
  if (next.q.trim() !== "") params.set("q", next.q);
  if (next.sort !== "updated") params.set("sort", next.sort);
  if (next.page > 1) params.set("page", String(next.page));
  return params;
}

export function inTab(d: DashboardSummary, tab: ListTab): boolean {
  switch (tab) {
    case "mine": return d.access.owner;
    case "shared": return !d.access.owner;
    case "pinned": return d.pinned;
    default: return true;
  }
}

/** Every word must appear in the title, description or owner's name. */
export function matchesSearch(d: DashboardSummary, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return true;
  const haystack = `${d.title}\n${d.description}\n${d.access.owner ? "" : d.ownerName ?? ""}`.toLowerCase();
  return words.every((w) => haystack.includes(w));
}

const COMPARE: Record<ListSort, (a: DashboardSummary, b: DashboardSummary) => number> = {
  updated: (a, b) => b.updatedAt - a.updatedAt,
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  panels: (a, b) => b.panelCount - a.panelCount,
};

export interface ListPage {
  rows: DashboardSummary[];
  /** Matches across every page. */
  total: number;
  page: number;
  pages: number;
}

/** Pinned dashboards come first within any sort, then ties break by title so the order is stable. */
export function listPage(all: DashboardSummary[], params: ListParams): ListPage {
  const matched = all
    .filter((d) => inTab(d, params.tab) && matchesSearch(d, params.q))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || COMPARE[params.sort](a, b) || COMPARE.title(a, b) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const page = Math.min(params.page, pages);
  return { rows: matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: matched.length, page, pages };
}

export function tabCounts(all: DashboardSummary[]): Record<Exclude<ListTab, "templates">, number> {
  return {
    all: all.length,
    mine: all.filter((d) => inTab(d, "mine")).length,
    shared: all.filter((d) => inTab(d, "shared")).length,
    pinned: all.filter((d) => inTab(d, "pinned")).length,
  };
}
