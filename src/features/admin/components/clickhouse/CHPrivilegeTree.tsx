/**
 * CHPrivilegeTree
 *
 * Privilege picker that mirrors ClickHouse's own privilege hierarchy
 * (system.privileges): a master ALL, top-level families (SELECT, ALTER,
 * CREATE, …), and their nested children. Selecting a parent grants the whole
 * subtree (just like `GRANT ALTER` covers every `ALTER *`), so descendants are
 * shown as implied/locked. The emitted value is the minimal set of privilege
 * names — exactly what gets granted.
 *
 * Falls back to a flat, grouped layout when the catalog carries no hierarchy
 * (e.g. the static catalog served when system.privileges is unavailable).
 */

import { useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronRight, ChevronsDown, ChevronsUp, Search, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CHPrivilegeCatalogEntry } from "@/api/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface CHPrivilegeTreeProps {
  privileges: CHPrivilegeCatalogEntry[];
  /** Minimal set of selected privilege names. */
  value: string[];
  onChange: (next: string[]) => void;
}

const ALL = "ALL";

export function CHPrivilegeTree({ privileges, value, onChange }: CHPrivilegeTreeProps) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const hierarchical = useMemo(
    () => privileges.some((p) => p.parent != null) || privileges.some((p) => p.name === ALL),
    [privileges],
  );

  const byName = useMemo(() => new Map(privileges.map((p) => [p.name, p])), [privileges]);
  const childrenOf = useMemo(() => {
    const map = new Map<string, CHPrivilegeCatalogEntry[]>();
    for (const p of privileges) {
      if (p.name === ALL) continue;
      const key = p.parent ?? ALL;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [privileges]);

  const valueSet = useMemo(() => new Set(value), [value]);
  const allSelected = valueSet.has(ALL);

  const descendantsOf = (name: string): string[] => {
    const out: string[] = [];
    const stack = [...(childrenOf.get(name) ?? [])];
    while (stack.length) {
      const node = stack.pop()!;
      out.push(node.name);
      stack.push(...(childrenOf.get(node.name) ?? []));
    }
    return out;
  };

  const impliedByAncestor = (name: string): boolean => {
    if (allSelected && name !== ALL) return true;
    let cur = byName.get(name)?.parent ?? null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (valueSet.has(cur)) return true;
      cur = byName.get(cur)?.parent ?? null;
    }
    return false;
  };

  const toggle = (name: string) => {
    if (impliedByAncestor(name)) return; // locked by a selected ancestor
    if (valueSet.has(name)) {
      onChange(value.filter((v) => v !== name));
    } else {
      const redundant = new Set(descendantsOf(name));
      onChange([...value.filter((v) => !redundant.has(v)), name]);
    }
  };

  const q = filter.trim().toLowerCase();
  const matches = (name: string): boolean => name.toLowerCase().includes(q);
  const subtreeMatches = (name: string): boolean =>
    !q || matches(name) || descendantsOf(name).some(matches);

  const topFamilies = useMemo(
    () => (childrenOf.get(ALL) ?? []).filter((f) => subtreeMatches(f.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [childrenOf, q],
  );

  const allExpanded = topFamilies.length > 0 && topFamilies.every((f) => expanded.has(f.name));
  const toggleExpandAll = () =>
    setExpanded(allExpanded ? new Set() : new Set(topFamilies.map((f) => f.name)));
  const toggleExpand = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  // ----- Flat fallback (no hierarchy) -----
  if (!hierarchical) {
    const groups = new Map<string, CHPrivilegeCatalogEntry[]>();
    for (const p of privileges) {
      if (q && !matches(p.name)) continue;
      const list = groups.get(p.group) ?? [];
      list.push(p);
      groups.set(p.group, list);
    }
    return (
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-xs border border-ink-500 bg-ink-200 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...groups.entries()].map(([group, entries]) => (
          <div key={group} className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">{group}</span>
            {entries.map((p) => (
              <label key={p.name} className="flex cursor-pointer items-center gap-2 text-[12px] text-paper-muted">
                <Checkbox
                  checked={valueSet.has(p.name)}
                  onCheckedChange={() => toggle(p.name)}
                  className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
                />
                <span className="font-mono" title={p.description}>{p.name}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    );
  }

  // Recursive descendant rows inside a family card.
  const renderChildren = (parent: string, depth: number): ReactNode => {
    const kids = (childrenOf.get(parent) ?? []).filter((k) => subtreeMatches(k.name));
    if (kids.length === 0) return null;
    return kids.map((node) => {
      const implied = impliedByAncestor(node.name);
      const checked = implied || valueSet.has(node.name);
      const hasKids = (childrenOf.get(node.name) ?? []).length > 0;
      return (
        <div key={node.name}>
          <label
            className={cn(
              "flex items-center gap-2 rounded-xs px-1.5 py-1 text-[12px]",
              implied ? "cursor-default opacity-60" : "cursor-pointer hover:bg-ink-200",
            )}
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
          >
            <Checkbox
              checked={checked}
              disabled={implied}
              onCheckedChange={() => toggle(node.name)}
              className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
            />
            <span className="font-mono text-paper-muted" title={node.description}>{node.name}</span>
          </label>
          {hasKids && renderChildren(node.name, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="space-y-2">
      {/* Controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-paper-faint" aria-hidden />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search privileges"
            className="h-9 rounded-xs border-ink-500 bg-ink-200 pl-9 pr-9 text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
          />
          {q && (
            <button type="button" onClick={() => setFilter("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-paper-faint hover:text-paper" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {topFamilies.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleExpandAll}
            className="h-9 gap-1.5 rounded-xs px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:bg-ink-200 hover:text-paper"
          >
            {allExpanded ? (<><ChevronsUp className="h-3.5 w-3.5" /> Collapse</>) : (<><ChevronsDown className="h-3.5 w-3.5" /> Expand</>)}
          </Button>
        )}
      </div>

      {/* ALL master */}
      {byName.has(ALL) && (
        <label className="flex cursor-pointer items-center gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2 text-[12px] text-paper">
          <Checkbox
            checked={allSelected}
            onCheckedChange={() => toggle(ALL)}
            className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em]">ALL — every privilege</span>
          {allSelected && <Check className="ml-auto h-3.5 w-3.5 text-brand" aria-hidden />}
        </label>
      )}

      {/* Families */}
      {topFamilies.length === 0 ? (
        <div className="rounded-xs border border-ink-500 bg-ink-100 px-3 py-3 text-[12px] text-paper-muted">No privileges match your search.</div>
      ) : (
        <div className={cn("space-y-2", allSelected && "pointer-events-none opacity-50")}>
          {topFamilies.map((family, index) => {
            const isOpen = expanded.has(family.name) || !!q;
            const familyChecked = allSelected || valueSet.has(family.name);
            const familyImplied = impliedByAncestor(family.name);
            const total = descendantsOf(family.name).length;
            const selectedCount = familyChecked
              ? total
              : descendantsOf(family.name).filter((n) => valueSet.has(n) || impliedByAncestor(n)).length;
            return (
              <motion.div key={family.name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }}>
                <Collapsible open={isOpen} onOpenChange={() => toggleExpand(family.name)}>
                  <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100 transition-colors hover:border-ink-700">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <Checkbox
                        checked={familyChecked}
                        disabled={familyImplied}
                        onCheckedChange={() => toggle(family.name)}
                        className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
                      />
                      <span className="font-mono text-[13px] font-semibold text-paper">{family.name}</span>
                      {total > 0 && (
                        <span
                          className={cn(
                            "inline-flex items-center rounded-xs border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
                            familyChecked ? "border-brand/40 text-brand" : selectedCount > 0 ? "border-brand/30 text-brand/80" : "border-ink-500 bg-ink-200 text-paper-muted",
                          )}
                        >
                          {selectedCount}/{total}
                        </span>
                      )}
                      {total > 0 && (
                        <CollapsibleTrigger className="group ml-auto grid h-6 w-6 place-items-center rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper">
                          <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.2 }}>
                            <ChevronRight className="h-4 w-4" />
                          </motion.div>
                        </CollapsibleTrigger>
                      )}
                    </div>
                    {total > 0 && (
                      <CollapsibleContent>
                        <div className="border-t border-ink-500 px-2 py-1.5">{renderChildren(family.name, 0)}</div>
                      </CollapsibleContent>
                    )}
                  </div>
                </Collapsible>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default CHPrivilegeTree;
