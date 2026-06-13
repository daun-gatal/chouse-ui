/**
 * CHScopePicker
 *
 * Picks the databases / tables a set of privileges applies to, reading the live
 * schema from ClickHouse (the active session) the same way Data Access browses
 * databases and tables. Supports:
 *  - "All databases (*.*)"
 *  - a database (db.*) or specific tables (db.table)
 *  - prefix filtering + "select all matching" for bulk selection
 *
 * Native ClickHouse grants have no name-prefix wildcard, so a prefix is expanded
 * into concrete db.* / db.table scopes from the live schema.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Database, Table2, Loader2, Globe, X } from "lucide-react";
import { toast } from "sonner";
import { log } from "@/lib/log";
import { getDatabases, type DatabaseInfo } from "@/api/explorer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export interface CHScope {
  database: string | null; // null = all databases (*)
  table: string | null; // null = all tables in the database (*)
}

interface CHScopePickerProps {
  value: CHScope[];
  onChange: (scopes: CHScope[]) => void;
}

const scopeKey = (s: CHScope) => `${s.database ?? "*"}.${s.table ?? "*"}`;

export function CHScopePicker({ value, onChange }: CHScopePickerProps) {
  const [databases, setDatabases] = useState<DatabaseInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    getDatabases()
      .then((dbs) => {
        if (active) setDatabases(dbs);
      })
      .catch((error) => {
        log.error("Failed to load databases", error);
        toast.error(`Failed to load databases: ${(error as Error).message}`);
        if (active) setDatabases([]);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const selected = useMemo(() => new Set(value.map(scopeKey)), [value]);
  const has = (s: CHScope) => selected.has(scopeKey(s));

  const toggle = (s: CHScope) => {
    onChange(has(s) ? value.filter((v) => scopeKey(v) !== scopeKey(s)) : [...value, s]);
  };

  const allDatabases = has({ database: null, table: null });

  const q = filter.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!databases) return [];
    if (!q) return databases;
    return databases
      .map((db) => {
        const dbMatch = db.name.toLowerCase().startsWith(q);
        const tables = dbMatch ? db.children : db.children.filter((t) => t.name.toLowerCase().startsWith(q));
        return dbMatch || tables.length > 0 ? { ...db, children: tables } : null;
      })
      .filter((db): db is DatabaseInfo => db !== null);
  }, [databases, q]);

  // Scopes in `value` that aren't browsable in the live schema (e.g. dropped DBs
  // or ones the session can't see) — surfaced so they aren't silently dropped.
  const liveKeys = useMemo(() => {
    const keys = new Set<string>(["*.*"]);
    for (const db of databases ?? []) {
      keys.add(scopeKey({ database: db.name, table: null }));
      for (const t of db.children) keys.add(scopeKey({ database: db.name, table: t.name }));
    }
    return keys;
  }, [databases]);
  const customScopes = value.filter((v) => !liveKeys.has(scopeKey(v)));

  const selectAllMatching = () => {
    const additions = filtered
      .map((db) => ({ database: db.name, table: null }) as CHScope)
      .filter((s) => !has(s));
    onChange([...value, ...additions]);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* All databases */}
      <label className="flex cursor-pointer items-center gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2 text-[12px] text-paper">
        <Checkbox
          checked={allDatabases}
          onCheckedChange={() => toggle({ database: null, table: null })}
          className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
        />
        <Globe className="h-3.5 w-3.5 text-paper-faint" aria-hidden />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em]">All databases (*.*)</span>
      </label>

      {/* Filter / prefix */}
      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or prefix…"
          className="h-8 rounded-xs border-ink-500 bg-ink-200 text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
        />
        {q && filtered.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={selectAllMatching}
            className="h-8 shrink-0 rounded-xs border-ink-500 bg-ink-100 px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
          >
            Select {filtered.length} match{filtered.length === 1 ? "" : "es"}
          </Button>
        )}
      </div>

      {/* Tree */}
      <div className={`max-h-72 overflow-y-auto rounded-xs border border-ink-500 bg-ink-100 p-2 ${allDatabases ? "pointer-events-none opacity-50" : ""}`}>
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-[11px] text-paper-faint">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading databases…
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-2 text-[11px] text-paper-faint">No databases match.</p>
        ) : (
          filtered.map((db) => {
            const dbScope: CHScope = { database: db.name, table: null };
            const isOpen = expanded[db.name] ?? !!q;
            return (
              <div key={db.name} className="py-0.5">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [db.name]: !isOpen }))}
                    className="grid h-5 w-5 place-items-center rounded-xs text-paper-faint hover:bg-ink-200 hover:text-paper"
                    aria-label={isOpen ? "Collapse" : "Expand"}
                  >
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-xs px-1 py-0.5 text-[12px] text-paper hover:bg-ink-200">
                    <Checkbox
                      checked={has(dbScope)}
                      onCheckedChange={() => toggle(dbScope)}
                      className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
                    />
                    <Database className="h-3.5 w-3.5 text-paper-faint" aria-hidden />
                    <span className="font-mono">{db.name}</span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">(all tables)</span>
                  </label>
                </div>

                {isOpen && (
                  <div className="ml-7 mt-0.5 flex flex-col gap-0.5 border-l border-ink-500 pl-2">
                    {db.children.length === 0 ? (
                      <span className="py-0.5 text-[11px] text-paper-faint">No tables.</span>
                    ) : (
                      db.children.map((t) => {
                        const tScope: CHScope = { database: db.name, table: t.name };
                        return (
                          <label key={t.name} className="flex cursor-pointer items-center gap-2 rounded-xs px-1 py-0.5 text-[12px] text-paper-muted hover:bg-ink-200">
                            <Checkbox
                              checked={has(tScope)}
                              onCheckedChange={() => toggle(tScope)}
                              className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
                            />
                            <Table2 className="h-3.5 w-3.5 text-paper-faint" aria-hidden />
                            <span className="font-mono">{t.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Custom / non-browsable scopes already on the role */}
      {customScopes.length > 0 && (
        <div className="space-y-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Other scopes</span>
          <div className="flex flex-wrap gap-1.5">
            {customScopes.map((s) => (
              <span key={scopeKey(s)} className="inline-flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">
                {s.database ? (s.table ? `${s.database}.${s.table}` : `${s.database}.*`) : "*.*"}
                <button type="button" onClick={() => toggle(s)} className="text-paper-faint hover:text-rose-400" aria-label="Remove scope">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default CHScopePicker;
