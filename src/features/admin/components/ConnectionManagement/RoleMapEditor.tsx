/**
 * Which ClickHouse role each CHouse role uses on a role-ceiling connection
 * (ADR 0033). One row per CHouse role; an empty name means "not mapped". Save
 * replaces the whole map. Super admin only: the server refuses everyone else.
 */

import { useCallback, useEffect, useMemo, useState, type MutableRefObject, type ReactElement } from "react";
import { AlertCircle, Check, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CLICKHOUSE_ROLE_NAME,
  getConnectionRoleMap,
  setConnectionRoleMap,
  type RoleMapEntry,
  type RoleMapInput,
} from "@/api/connectionIdentity";
import { rbacRolesApi, type RbacRole } from "@/api/rbac";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";
import { ERROR_CLASS, HELP_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./formStyles";
import { Note } from "./panelParts";

interface RoleMapEditorProps {
  connectionId: string;
  /** The map was saved; the caller's copy of it (and anything built from it) is stale. */
  onSaved?: (entries: RoleMapEntry[]) => void;
  /** The CHouse role names of the person looking: their rows say "You", and the warning names their own role. */
  viewerRoles?: readonly string[];
  /** The typed names differ from the saved map. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Set to this editor's save, so the panel can save it before leaving the tab. Resolves to whether it saved. */
  saveRef?: MutableRefObject<(() => Promise<boolean>) | null>;
}

type RoleNames = Record<string, string>;

const NAME_RULE = "Use letters, digits and underscores, not starting with a digit (128 at most).";

function namesFromEntries(entries: RoleMapEntry[]): RoleNames {
  const names: RoleNames = {};
  for (const entry of entries) names[entry.roleId] = entry.clickhouseRole;
  return names;
}

/** The trimmed name, "" when the role is not mapped. */
function nameOf(names: RoleNames, roleId: string): string {
  return (names[roleId] ?? "").trim();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function RoleMapEditor({ connectionId, onSaved, viewerRoles, onDirtyChange, saveRef }: RoleMapEditorProps): ReactElement {
  const [roles, setRoles] = useState<RbacRole[] | null>(null);
  const [saved, setSaved] = useState<RoleNames>({});
  const [names, setNames] = useState<RoleNames>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRoles(null);
    setLoadError(null);
    Promise.all([rbacRolesApi.list(), getConnectionRoleMap(connectionId)])
      .then(([roleList, entries]) => {
        if (cancelled) return;
        const loaded = namesFromEntries(entries);
        setRoles(roleList);
        setSaved(loaded);
        setNames(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = errorMessage(error, "Couldn't load the role map");
        log.error("[RoleMapEditor] Failed to load the role map", { errorMessage: message });
        setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, attempt]);

  const invalid = useMemo((): Set<string> => {
    const ids = new Set<string>();
    for (const role of roles ?? []) {
      const name = nameOf(names, role.id);
      if (name !== "" && !CLICKHOUSE_ROLE_NAME.test(name)) ids.add(role.id);
    }
    return ids;
  }, [roles, names]);

  const dirty = useMemo(
    (): boolean => (roles ?? []).some((role) => nameOf(names, role.id) !== nameOf(saved, role.id)),
    [roles, names, saved],
  );

  const unmapped = useMemo((): number => (roles ?? []).filter((role) => nameOf(names, role.id) === "").length, [roles, names]);

  /** Who the saved map refuses: the people of unmapped roles, and whether the viewer's own role is one of them. */
  const refused = useMemo((): { people: number; own: boolean } => {
    let people = 0;
    let own = false;
    for (const role of roles ?? []) {
      if (nameOf(saved, role.id) !== "") continue;
      people += role.userCount ?? 0;
      if (viewerRoles?.includes(role.name)) own = true;
    }
    return { people, own };
  }, [roles, saved, viewerRoles]);

  const showPeople = (roles ?? []).some((role) => role.userCount !== undefined);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const setName = useCallback((roleId: string, value: string): void => {
    setSaveError(null);
    setNames((current) => ({ ...current, [roleId]: value }));
  }, []);

  const save = async (): Promise<boolean> => {
    if (!roles) return false;
    if (invalid.size > 0) {
      setSaveError(NAME_RULE);
      return false;
    }
    if (!dirty) return true;
    const entries: RoleMapInput[] = roles
      .map((role) => ({ roleId: role.id, clickhouseRole: nameOf(names, role.id) }))
      .filter((entry) => entry.clickhouseRole !== "");
    setIsSaving(true);
    setSaveError(null);
    try {
      const stored = await setConnectionRoleMap(connectionId, entries);
      const next = namesFromEntries(stored);
      setSaved(next);
      setNames(next);
      toast.success("Role map saved");
      onSaved?.(stored);
      return true;
    } catch (error) {
      const message = errorMessage(error, "Couldn't save the role map");
      log.error("[RoleMapEditor] Failed to save the role map", { errorMessage: message });
      setSaveError(message);
      toast.error("Couldn't save the role map", { description: message });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  // The panel calls the save of the tab being left; the latest one, with the latest names.
  useEffect(() => {
    if (!saveRef) return undefined;
    saveRef.current = save;
    return () => {
      if (saveRef.current === save) saveRef.current = null;
    };
  });

  return (
    <section className="flex flex-col gap-2" aria-label="Role map">
      {roles !== null && refused.people > 0 && (
        <Note tone="warn" title={`${refused.people} ${refused.people === 1 ? "person can't" : "people can't"} query yet`}>
          <p>
            A CHouse role reaches data only once it's mapped to a ClickHouse role. Unmapped roles are refused{refused.own ? ", including your own" : ""}.
          </p>
        </Note>
      )}
      <p className={cn(HELP_CLASS, "leading-[1.5]")}>
        Each CHouse role uses one ClickHouse role on this connection. An account whose role is not mapped is refused on this connection. Once a role is mapped, only a super admin can assign it to an account.
      </p>

      {loadError ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xs border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-500/40 dark:bg-red-950/30">
          <p className="flex items-center gap-2 text-[12px] text-red-800 dark:text-red-200">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {loadError}
          </p>
          <Button type="button" variant="outline" onClick={() => setAttempt((n) => n + 1)} className={cn(SECONDARY_BUTTON_CLASS, "h-7 px-2")}>
            <RefreshCw className="h-3 w-3" aria-hidden />
            Try again
          </Button>
        </div>
      ) : roles === null ? (
        <p className="flex items-center gap-2 text-[12px] text-paper-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading roles
        </p>
      ) : roles.length === 0 ? (
        <p className="text-[12px] text-paper-muted">There are no CHouse roles to map.</p>
      ) : (
        <>
          <div className="divide-y divide-ink-500 rounded-xs border border-ink-500 bg-ink-100">
            <div className={cn("grid gap-3 bg-ink-200 px-3 py-1.5", showPeople ? "grid-cols-[1fr_1fr_3.5rem]" : "grid-cols-2")}>
              <span className={LABEL_CLASS}>CHouse role</span>
              <span className={LABEL_CLASS}>ClickHouse role</span>
              {showPeople && <span className={cn(LABEL_CLASS, "text-right")}>People</span>}
            </div>
            {roles.map((role) => {
              const bad = invalid.has(role.id);
              const errorId = `role-map-error-${role.id}`;
              return (
                <div key={role.id} className={cn("grid items-start gap-3 px-3 py-2", showPeople ? "grid-cols-[1fr_1fr_3.5rem]" : "grid-cols-2")}>
                  <span className="flex min-w-0 flex-col pt-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-paper">{role.displayName || role.name}</span>
                      {viewerRoles?.includes(role.name) && (
                        <span className="shrink-0 rounded-full border border-brand/50 px-1.5 py-px text-[10px] text-brand">You</span>
                      )}
                    </span>
                    <span className="truncate font-mono text-[11px] text-paper-faint">{role.name}</span>
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <Input
                      value={names[role.id] ?? ""}
                      onChange={(event) => setName(role.id, event.target.value)}
                      placeholder="Not mapped"
                      aria-label={`ClickHouse role for ${role.displayName || role.name}`}
                      aria-invalid={bad || undefined}
                      aria-describedby={bad ? errorId : undefined}
                      autoComplete="off"
                      spellCheck={false}
                      className={cn(INPUT_CLASS, "h-8", bad && "border-red-500 dark:border-red-400")}
                    />
                    {bad && <span id={errorId} className={ERROR_CLASS}>{NAME_RULE}</span>}
                  </span>
                  {showPeople && <span className="pt-1.5 text-right font-mono text-[12px] text-paper-muted">{role.userCount ?? 0}</span>}
                </div>
              );
            })}
          </div>

          {saveError && <p role="alert" className={ERROR_CLASS}>{saveError}</p>}

          <div className="flex items-center justify-between gap-3">
            <p className={HELP_CLASS}>
              {unmapped === 0
                ? "Every role is mapped."
                : `${unmapped} ${unmapped === 1 ? "role is" : "roles are"} not mapped; ${unmapped === 1 ? "its" : "their"} accounts are refused on this connection.`}
            </p>
            <Button type="button" onClick={() => void save()} disabled={isSaving || !dirty || invalid.size > 0} className={cn(PRIMARY_BUTTON_CLASS, "shrink-0")}>
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
              Save mappings
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
