/**
 * Which CHouse account runs as which ClickHouse user on one connection
 * (ADR 0033): the links, the form that adds one, the grants to hand to the
 * ClickHouse administrator and what is still in the way of a personal
 * connection. Super admin only; the server refuses everyone else.
 *
 * A link gives an account the grants of a ClickHouse user, so CHouse never
 * runs the grant that makes one usable: the ClickHouse administrator does.
 */

import { useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, Check, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import ConfirmationDialog from "@/components/common/ConfirmationDialog";
import {
  CLICKHOUSE_USER_NAME,
  bindingStateLabel,
  canRecheckBinding,
  confirmBinding,
  createBinding,
  getConnectionBindings,
  recheckBinding,
  removeBinding,
  type AdminBinding,
  type BindingReadiness,
  type BindingState,
} from "@/api/clickhouseBindings";
import { IDENTITY_MODE_PERSONAL, identityKind } from "@/api/connectionIdentity";
import { rbacUsersApi, type ClickHouseConnection, type RbacUser } from "@/api/rbac";
import { useDebounce } from "@/hooks/useDebounce";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";
import { CopyButton } from "./PrivilegeReport";
import { ERROR_CLASS, HELP_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, SECTION_TITLE_CLASS } from "./formStyles";

interface BindingsPanelProps {
  /** The connection whose links to show; null closes the panel. */
  connection: ClickHouseConnection | null;
  onClose: () => void;
}

/** Every reader of a person's own links (the selector, Preferences) is stale after a change here. */
const OWN_LINKS_KEY = ["my-clickhouse-links"];

const ACCOUNT_RESULTS = 20;

const STATE_CLASS: Record<BindingState, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  pending_grant: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  suspended: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  disabled: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};

const ROW_BUTTON_CLASS = cn(SECONDARY_BUTTON_CLASS, "h-7 gap-1.5 px-2 text-[10px]");

export function connectionBindingsKey(connectionId: string): readonly [string, string] {
  return ["clickhouse-bindings", connectionId];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function accountLabel(binding: AdminBinding): string {
  return binding.accountName ?? binding.accountEmail ?? "An account that was removed";
}

/** The readiness of a connection's links in one line. */
export function readinessLine(readiness: BindingReadiness): string {
  const { counts, jobsWithoutLink } = readiness;
  const jobs = jobsWithoutLink === 1 ? "1 scheduled query whose owner has no active link" : `${jobsWithoutLink} scheduled queries whose owner has no active link`;
  return `${counts.active} active, ${counts.pending_grant} waiting, ${counts.suspended} suspended, ${counts.disabled} disabled · ${jobs}`;
}

/** What stops a ClickHouse user name from being linked, or null. */
export function clickhouseUserProblem(name: string): string | null {
  if (name === "") return "Enter the ClickHouse user.";
  if (!CLICKHOUSE_USER_NAME.test(name)) return "Use letters, digits and underscores, not starting with a digit (128 at most).";
  if (name === "default") return "The ClickHouse user default cannot be linked to an account.";
  return null;
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex min-w-0 flex-col gap-2.5" aria-label={title}>
      <h3 className={SECTION_TITLE_CLASS}>{title}</h3>
      {children}
    </section>
  );
}

function StateBadge({ state }: { state: BindingState }): ReactElement {
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-xs px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]", STATE_CLASS[state])}>
      {bindingStateLabel(state)}
    </span>
  );
}

interface LinkRowProps {
  binding: AdminBinding;
  /** The action running on this row, if any. */
  busy: "recheck" | "confirm" | null;
  disabled: boolean;
  onRecheck: () => void;
  onConfirm: () => void;
  onRemove: () => void;
}

function LinkRow({ binding, busy, disabled, onRecheck, onConfirm, onRemove }: LinkRowProps): ReactElement {
  const account = accountLabel(binding);
  return (
    <tr className="align-top">
      <td className="px-3 py-2.5">
        <span className="flex min-w-0 flex-col">
          <span className="break-words text-[13px] font-medium text-paper">{account}</span>
          {binding.accountName !== null && binding.accountEmail !== null && (
            <span className="break-all text-[11px] text-paper-faint">{binding.accountEmail}</span>
          )}
        </span>
      </td>
      <td className="break-all px-3 py-2.5 font-mono text-[12px] text-paper">{binding.clickhouseUser}</td>
      <td className="px-3 py-2.5">
        <span className="flex min-w-0 flex-col items-start gap-1">
          <StateBadge state={binding.state} />
          {binding.reason && <span className="break-words text-[11px] leading-[1.45] text-paper-muted">{binding.reason}</span>}
        </span>
      </td>
      <td className="px-3 py-2.5 text-[11px] text-paper-faint">
        {binding.checkedAt !== null ? new Date(binding.checkedAt).toLocaleString() : "Never"}
      </td>
      <td className="px-3 py-2.5">
        <span className="flex flex-wrap justify-end gap-1.5">
          {canRecheckBinding(binding.state) && (
            <Button type="button" variant="outline" onClick={onRecheck} disabled={disabled} aria-label={`Check again: ${account}`} className={ROW_BUTTON_CLASS}>
              {busy === "recheck" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
              Check again
            </Button>
          )}
          {binding.state === "suspended" && (
            <Button type="button" variant="outline" onClick={onConfirm} disabled={disabled} aria-label={`Confirm: ${account}`} className={ROW_BUTTON_CLASS}>
              {busy === "confirm" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
              Confirm
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onRemove} disabled={disabled} aria-label={`Remove: ${account}`} className={ROW_BUTTON_CLASS}>
            <Trash2 className="h-3 w-3" aria-hidden />
            Remove
          </Button>
        </span>
      </td>
    </tr>
  );
}

interface AddLinkFormProps {
  connectionId: string;
  /** Accounts that already have a link here: one link per account and connection. */
  linkedUserIds: ReadonlySet<string>;
  onAdded: () => void;
}

function AddLinkForm({ connectionId, linkedUserIds, onAdded }: AddLinkFormProps): ReactElement {
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState<RbacUser | null>(null);
  const [clickhouseUser, setClickhouseUser] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const debouncedSearch = useDebounce(search.trim(), 250);

  const accounts = useQuery({
    queryKey: ["rbac", "users", "for-clickhouse-links", debouncedSearch],
    queryFn: () => rbacUsersApi.list({ limit: ACCOUNT_RESULTS, search: debouncedSearch || undefined }),
    enabled: account === null,
    retry: false,
  });

  const add = useMutation({
    mutationFn: (input: { userId: string; clickhouseUser: string }) => createBinding(connectionId, input),
    onSuccess: (binding) => {
      toast.success(`Linked ${accountLabel(binding)} to ${binding.clickhouseUser}`, {
        description: binding.state === "pending_grant" ? "It is waiting for the grant below." : undefined,
      });
      setAccount(null);
      setSearch("");
      setClickhouseUser("");
      setFormError(null);
      onAdded();
    },
    onError: (error) => {
      const message = errorMessage(error, "Couldn't add the link");
      log.error("[BindingsPanel] Failed to add a link", { errorMessage: message });
      setFormError(message);
      toast.error("Couldn't add the link", { description: message });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const name = clickhouseUser.trim();
    const problem = account === null ? "Choose the account." : clickhouseUserProblem(name);
    setFormError(problem);
    if (problem || account === null) return;
    add.mutate({ userId: account.id, clickhouseUser: name });
  };

  const results = accounts.data?.users ?? [];

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-3 rounded-xs border border-ink-500 bg-ink-100 px-3 py-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="link-account" className={LABEL_CLASS}>Account</Label>
          {account ? (
            <div className="flex h-9 items-center justify-between gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3">
              <span className="min-w-0 truncate text-[12px] text-paper">
                {account.displayName || account.username} <span className="text-paper-faint">{account.email}</span>
              </span>
              <button
                type="button"
                id="link-account"
                onClick={() => { setAccount(null); setFormError(null); }}
                aria-label="Choose another account"
                className="shrink-0 text-paper-faint hover:text-paper"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <>
              <Input
                id="link-account"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setFormError(null); }}
                autoComplete="off"
                spellCheck={false}
                placeholder="Search by name or email"
                className={INPUT_CLASS}
              />
              {accounts.isError ? (
                <p role="alert" className={ERROR_CLASS}>{errorMessage(accounts.error, "Couldn't load the accounts")}</p>
              ) : accounts.isPending ? (
                <p className={HELP_CLASS}>Loading accounts</p>
              ) : results.length === 0 ? (
                <p className={HELP_CLASS}>No account matches.</p>
              ) : (
                <ul aria-label="Accounts" className="max-h-44 divide-y divide-ink-500 overflow-y-auto rounded-xs border border-ink-500 bg-ink-200">
                  {results.map((user) => {
                    const linked = linkedUserIds.has(user.id);
                    return (
                      <li key={user.id}>
                        <button
                          type="button"
                          disabled={linked}
                          onClick={() => { setAccount(user); setFormError(null); }}
                          className="flex w-full min-w-0 flex-col px-3 py-1.5 text-left hover:bg-ink-300 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                        >
                          <span className="truncate text-[12px] text-paper">{user.displayName || user.username}</span>
                          <span className="truncate text-[11px] text-paper-faint">{linked ? `${user.email} · already linked here` : user.email}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="link-clickhouse-user" className={LABEL_CLASS}>ClickHouse user</Label>
          <Input
            id="link-clickhouse-user"
            value={clickhouseUser}
            onChange={(event) => { setClickhouseUser(event.target.value); setFormError(null); }}
            autoComplete="off"
            spellCheck={false}
            maxLength={128}
            placeholder="alice"
            className={INPUT_CLASS}
          />
          <p className={HELP_CLASS}>The user must already exist in ClickHouse. Letters, digits and underscores; not default.</p>
        </div>
      </div>

      {formError && <p role="alert" className={ERROR_CLASS}>{formError}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={add.isPending} className={PRIMARY_BUTTON_CLASS}>
          {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
          Add link
        </Button>
      </div>
    </form>
  );
}

function BindingsPanelBody({ connection }: { connection: ClickHouseConnection }): ReactElement {
  const connectionId = connection.id;
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<AdminBinding | null>(null);

  const listing = useQuery({
    queryKey: connectionBindingsKey(connectionId),
    queryFn: () => getConnectionBindings(connectionId),
    retry: false,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: connectionBindingsKey(connectionId) });
    void queryClient.invalidateQueries({ queryKey: OWN_LINKS_KEY });
  };

  const failed = (what: string) => (error: unknown): void => {
    const message = errorMessage(error, what);
    log.error(`[BindingsPanel] ${what}`, { errorMessage: message });
    toast.error(what, { description: message });
  };

  const recheck = useMutation({
    mutationFn: (id: string) => recheckBinding<AdminBinding>(id),
    onSuccess: (binding) => {
      refresh();
      if (binding.state === "active") toast.success(`${binding.clickhouseUser} is active`);
      else toast.warning(`${binding.clickhouseUser}: ${bindingStateLabel(binding.state).toLowerCase()}`, { description: binding.reason ?? undefined });
    },
    onError: failed("Couldn't check the link"),
  });

  const confirm = useMutation({
    mutationFn: (id: string) => confirmBinding(id),
    onSuccess: (binding) => {
      refresh();
      toast.success(`Confirmed the link to ${binding.clickhouseUser}`);
    },
    onError: failed("Couldn't confirm the link"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeBinding(id),
    onSuccess: () => {
      refresh();
      toast.success("Link removed");
    },
    onError: failed("Couldn't remove the link"),
    onSettled: () => setRemoving(null),
  });

  const bindings = listing.data?.bindings;
  const linkedUserIds = useMemo((): ReadonlySet<string> => new Set((bindings ?? []).map((binding) => binding.userId)), [bindings]);

  if (listing.isError) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-xs border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-500/40 dark:bg-red-950/30">
        <p className="flex items-center gap-2 text-[12px] text-red-800 dark:text-red-200">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {errorMessage(listing.error, "Couldn't load this connection's links")}
        </p>
        <Button type="button" variant="outline" onClick={() => void listing.refetch()} className={cn(SECONDARY_BUTTON_CLASS, "h-7 px-2")}>
          <RefreshCw className="h-3 w-3" aria-hidden />
          Try again
        </Button>
      </div>
    );
  }

  if (!listing.data) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-paper-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Loading
      </p>
    );
  }

  const { grants, unbound, readiness } = listing.data;
  const rows = listing.data.bindings;
  const working = recheck.isPending || confirm.isPending || remove.isPending;
  const grantScript = grants.join("\n");
  const revokeScript = unbound.map((entry) => entry.revoke).join("\n");

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {identityKind(connection.identityMode) !== IDENTITY_MODE_PERSONAL && (
        <p role="note" className="flex items-start gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5 text-[12px] leading-[1.5] text-paper-muted">
          <AlertCircle className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Links are not in use until this connection is switched to Personal.</span>
        </p>
      )}

      <Section title="Links">
        <p className={cn(HELP_CLASS, "leading-[1.5]")}>{readinessLine(readiness)}</p>
        {rows.length === 0 ? (
          <p className="rounded-xs border border-ink-500 bg-ink-100 px-3 py-2.5 text-[12px] text-paper-muted">
            No account is linked to a ClickHouse user on this connection yet.
          </p>
        ) : (
          // The table scrolls inside its own box, so a phone never scrolls the page sideways.
          <div className="overflow-x-auto rounded-xs border border-ink-500 bg-ink-100">
            <table className="w-full min-w-[620px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-500">
                  {["Account", "ClickHouse user", "State", "Last checked"].map((heading) => (
                    <th key={heading} scope="col" className={cn(LABEL_CLASS, "px-3 py-2 font-normal")}>{heading}</th>
                  ))}
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-500">
                {rows.map((binding) => (
                  <LinkRow
                    key={binding.id}
                    binding={binding}
                    busy={recheck.isPending && recheck.variables === binding.id ? "recheck" : confirm.isPending && confirm.variables === binding.id ? "confirm" : null}
                    disabled={working}
                    onRecheck={() => recheck.mutate(binding.id)}
                    onConfirm={() => confirm.mutate(binding.id)}
                    onRemove={() => setRemoving(binding)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Add link">
        <AddLinkForm connectionId={connectionId} linkedUserIds={linkedUserIds} onAdded={refresh} />
      </Section>

      {grants.length > 0 && (
        <Section title="For the ClickHouse administrator">
          <p className={cn(HELP_CLASS, "leading-[1.5]")}>
            Hand this to your ClickHouse administrator. CHouse cannot run it. Once it has run, use Check again on each waiting link.
          </p>
          <div className="flex items-start justify-between gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
            <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.6] text-paper">{grantScript}</pre>
            <CopyButton text={grantScript} label="Copy" />
          </div>
        </Section>
      )}

      {unbound.length > 0 && (
        <Section title="ClickHouse users without a link">
          <div className="rounded-xs border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/40 dark:bg-amber-950/30">
            <p className="flex items-start gap-2 text-[12px] leading-[1.5] text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                This connection may still act as {unbound.length === 1 ? "this ClickHouse user" : "these ClickHouse users"}, although no link uses {unbound.length === 1 ? "it" : "them"}:{" "}
                <span className="break-all font-mono">{unbound.map((entry) => entry.user).join(", ")}</span>. Ask the ClickHouse administrator to revoke what is no longer needed.
              </span>
            </p>
          </div>
          <div className="flex items-start justify-between gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
            <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.6] text-paper">{revokeScript}</pre>
            <CopyButton text={revokeScript} label="Copy" />
          </div>
        </Section>
      )}

      <ConfirmationDialog
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => { if (removing) remove.mutate(removing.id); }}
        title="Remove this link?"
        description={
          removing ? (
            <p className="leading-[1.5]">
              <span className="font-medium text-paper">{accountLabel(removing)}</span> can no longer run statements as{" "}
              <span className="font-mono text-paper">{removing.clickhouseUser}</span> on this connection. The ClickHouse user itself is not changed; ask the ClickHouse administrator to revoke its grant.
            </p>
          ) : ""
        }
        confirmText="Remove"
        variant="danger"
        isLoading={remove.isPending}
      />
    </div>
  );
}

export function BindingsPanel({ connection, onClose }: BindingsPanelProps): ReactElement {
  return (
    <Sheet open={connection !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Linked ClickHouse users{connection ? ` · ${connection.name}` : ""}</SheetTitle>
          <SheetDescription>
            Which account runs as which ClickHouse user on this connection. Only a super admin can add, confirm or remove a link.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {connection && <BindingsPanelBody key={connection.id} connection={connection} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
