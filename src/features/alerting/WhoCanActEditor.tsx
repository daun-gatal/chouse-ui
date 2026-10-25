/**
 * "Who can act from this channel" editor (ADR 0026 §4): anyone with the
 * permission, or only listed platform users/groups and CHouse users/roles.
 * Applies to every button posted to the channel; each action still needs its
 * own CHouse permission.
 */

import { useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";

import { ChannelType } from "@/api/alerting";
import { rbacRolesApi, rbacUsersApi } from "@/api/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { classifyEntry, ENTRY_HINT, withEntry, withoutEntry, type ChannelActors } from "./actors";

const CHIP = "inline-flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-2 py-0.5 text-[12px] text-paper";

interface Props {
  type: ChannelType;
  value: ChannelActors;
  onChange: (next: ChannelActors) => void;
  disabled?: boolean;
}

export function WhoCanActEditor({ type, value, onChange, disabled }: Props): ReactElement {
  const [entry, setEntry] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const roles = useQuery({ queryKey: ["rbac", "roles", "for-actors"], queryFn: () => rbacRolesApi.list(), retry: false });
  const users = useQuery({ queryKey: ["rbac", "users", "for-actors"], queryFn: () => rbacUsersApi.list({ limit: 100 }), retry: false });
  const roleNames = useMemo(() => new Map((roles.data ?? []).map((r) => [r.name, r.displayName || r.name])), [roles.data]);
  const userNames = useMemo(() => new Map((users.data?.users ?? []).map((u) => [u.id, u.displayName || u.username])), [users.data]);

  const addEntry = (): void => {
    const result = classifyEntry(type, entry);
    if ("error" in result) {
      setEntryError(result.error);
      return;
    }
    onChange(withEntry(value, result.field, result.value));
    setEntry("");
    setEntryError(null);
  };

  const chips: Array<{ field: keyof Omit<ChannelActors, "mode">; value: string; label: string }> = [
    ...value.platformGroups.map((v) => ({ field: "platformGroups" as const, value: v, label: `${v} (group)` })),
    ...value.platformUsers.map((v) => ({ field: "platformUsers" as const, value: v, label: v })),
    ...value.domains.map((v) => ({ field: "domains" as const, value: v, label: `@${v}` })),
    ...value.roles.map((v) => ({ field: "roles" as const, value: v, label: `Role: ${roleNames.get(v) ?? v}` })),
    ...value.users.map((v) => ({ field: "users" as const, value: v, label: userNames.get(v) ?? v })),
  ];

  return (
    <div className="space-y-3" data-testid="who-can-act">
      <div className="flex flex-wrap gap-4 text-[12px] text-paper">
        <label className="flex items-center gap-2">
          <input type="radio" name="who-can-act" checked={value.mode === "any"} disabled={disabled} onChange={() => onChange({ ...value, mode: "any" })} />
          Anyone with the permission
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="who-can-act" checked={value.mode === "only"} disabled={disabled} onChange={() => onChange({ ...value, mode: "only" })} />
          Only these
        </label>
      </div>

      {value.mode === "only" && (
        <>
          <div className="flex flex-wrap gap-1.5" aria-label="People who can act">
            {chips.length === 0 && <span className="text-[12px] text-amber-400">Nobody yet: add someone, or nobody can act from this channel.</span>}
            {chips.map((chip) => (
              <span key={`${chip.field}:${chip.value}`} className={CHIP}>
                {chip.label}
                <button type="button" aria-label={`Remove ${chip.label}`} disabled={disabled} onClick={() => onChange(withoutEntry(value, chip.field, chip.value))} className="text-paper-faint hover:text-paper">
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>

          <div className="space-y-1">
            <div className="flex gap-2">
              <Input
                value={entry}
                disabled={disabled}
                onChange={(e) => {
                  setEntry(e.target.value);
                  setEntryError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addEntry();
                  }
                }}
                placeholder={ENTRY_HINT[type] ?? ""}
                aria-label={ENTRY_HINT[type] ?? "Platform entry"}
                className="h-8"
              />
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1" disabled={disabled} onClick={addEntry}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add
              </Button>
            </div>
            {entryError && <p className="text-[11px] text-red-300">{entryError}</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            {roles.data && (
              <Select value="" onValueChange={(v) => onChange(withEntry(value, "roles", v))} disabled={disabled}>
                <SelectTrigger className="h-8 w-48" aria-label="Add a CHouse role">
                  <SelectValue placeholder="Add a CHouse role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.data.filter((r) => !value.roles.includes(r.name)).map((r) => (
                    <SelectItem key={r.name} value={r.name}>{r.displayName || r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {users.data && (
              <Select value="" onValueChange={(v) => onChange(withEntry(value, "users", v))} disabled={disabled}>
                <SelectTrigger className="h-8 w-48" aria-label="Add a CHouse user">
                  <SelectValue placeholder="Add a CHouse user" />
                </SelectTrigger>
                <SelectContent>
                  {users.data.users.filter((u) => !value.users.includes(u.id)).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.displayName || u.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </>
      )}
      <p className="text-[11px] text-paper-faint">Applies to every button posted here. People also need the CHouse permission for each action.</p>
    </div>
  );
}
