/**
 * Shared pieces of Admin › Alerting (ADR 0026 §7): the panel frame, a pager,
 * the filter bar controls, and filters kept in the URL so a view can be shared
 * and Back works.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const PANEL_TITLE = "font-mono text-[11px] uppercase tracking-[0.14em] text-paper";
export const ADD_BTN =
  "h-8 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft";
export const ROW = "flex items-center gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5";
export const META = "font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint";
export const BADGE = "inline-flex shrink-0 items-center whitespace-nowrap rounded-xs border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]";
export const PAGE_SIZE = 20;

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

export function Panel({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="rounded-xs border border-ink-500 bg-ink-100">
      <div className="flex items-center gap-2 border-b border-ink-500 px-4 py-3">
        <h3 className={PANEL_TITLE}>{title}</h3>
        {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Page through a list held in the browser; renders once there is more than a page. */
export function Pager({ page, total, onPage, pageSize = PAGE_SIZE }: { page: number; total: number; onPage: (p: number) => void; pageSize?: number }): React.ReactElement | null {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between">
      <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)} className="h-7 gap-1 px-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-40">
        <ChevronLeft className="h-3.5 w-3.5" /> Prev
      </Button>
      <span className={META}>Page {page + 1} of {pages} · {total} total</span>
      <Button variant="ghost" size="sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className="h-7 gap-1 px-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-40">
        Next <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/**
 * Filters in the URL. An unknown value (a stale link, a typo) falls back to
 * the default; changing a filter goes back to the first page.
 */
export function useUrlFilters<K extends string>(keys: readonly K[], allowed: Partial<Record<K, readonly string[]>> = {}): {
  values: Record<K, string>;
  page: number;
  set: (key: K, value: string) => void;
  setPage: (page: number) => void;
  clear: () => void;
  active: boolean;
} {
  const [params, setParams] = useSearchParams();
  const values = {} as Record<K, string>;
  for (const key of keys) {
    const raw = params.get(key) ?? "";
    const options = allowed[key];
    values[key] = options && raw && !options.includes(raw) ? "" : raw;
  }
  const page = Math.max(0, Number.parseInt(params.get("page") ?? "0", 10) || 0);
  const set = useCallback((key: K, value: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page");
      return next;
    }, { replace: true });
  }, [setParams]);
  const setPage = useCallback((p: number) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p > 0) next.set("page", String(p));
      else next.delete("page");
      return next;
    }, { replace: true });
  }, [setParams]);
  const clear = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams();
      const view = prev.get("view");
      if (view) next.set("view", view);
      return next;
    }, { replace: true });
  }, [setParams]);
  return { values, page, set, setPage, clear, active: keys.some((k) => values[k] !== "") };
}

/** A page index kept in range as a filtered list shrinks. */
export function clampPage(page: number, total: number, pageSize = PAGE_SIZE): number {
  return Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }): React.ReactElement {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  // Typing settles for a moment before the URL (and any server search) follows.
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft), 250);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-faint" aria-hidden />
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-8 pl-8" />
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }): React.ReactElement {
  return (
    <Select value={value || "__all"} onValueChange={(v) => onChange(v === "__all" ? "" : v)}>
      <SelectTrigger className={cn("h-8 w-auto min-w-[8rem] gap-2 text-[12px]", value && "border-brand")} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">{label}: all</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** What an empty list says: what to change, not just "nothing here". */
export function EmptyFiltered({ message }: { message: string }): React.ReactElement {
  return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim">{message}</p>;
}

/** Shown in the filter bar while any filter is set. */
export function ClearFilters({ active, onClear }: { active: boolean; onClear: () => void }): React.ReactElement | null {
  if (!active) return null;
  return (
    <Button variant="ghost" size="sm" className="h-8 gap-1 text-[12px]" onClick={onClear}>
      <X className="h-3.5 w-3.5" aria-hidden /> Clear filters
    </Button>
  );
}
