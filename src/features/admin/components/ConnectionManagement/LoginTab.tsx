/**
 * The ClickHouse login tab of the connection panel: one form for the kind and
 * the login of every kind, with Test (saves nothing) and Save or Create.
 * Where each goes is decided by `loginRoute`: a shared login through the
 * connection routes, anything else through the identity routes, which run
 * the identity checks first. A role-ceiling or personal login is changed by a
 * super admin only; everyone else sees it read-only.
 */

import { useEffect, useRef, useState, type MutableRefObject, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, Eye, EyeOff, Loader2, Play, Plus, RefreshCw, Check } from "lucide-react";
import { toast } from "sonner";

import { getConnectionBindings } from "@/api/clickhouseBindings";
import { ApiError } from "@/api/client";
import {
  ACCESS_CONTACT_MAX,
  IDENTITY_MODE_CEILING,
  IDENTITY_MODE_PERSONAL,
  IDENTITY_MODE_SHARED,
  checkConnectionIdentity,
  checkNewConnectionIdentity,
  createIdentityConnection,
  identityCheckFromError,
  identityKindLabel,
  recheckConnectionIdentity,
  setConnectionAccessContact,
  switchConnectionIdentity,
  type ConnectionIdentityDetail,
  type IdentityCheckResult,
  type KnownIdentityMode,
} from "@/api/connectionIdentity";
import {
  privilegeReportFromError,
  rbacConnectionsApi,
  type ClickHouseConnection,
  type ConnectionPrivilegeReport,
  type TestConnectionResult,
} from "@/api/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";
import { CheckResults } from "./CheckResults";
import { ERROR_CLASS, HELP_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./formStyles";
import { KindPicker } from "./KindPicker";
import {
  createSharedInput,
  footerWarning,
  identityChangeFrom,
  isLoginDirty,
  kindHint,
  kindLock,
  loginPatch,
  loginPill,
  loginProblem,
  loginRoute,
  metadataWithEnvironment,
  nameProblem,
  onlyContactChanged,
  peopleNote,
  sharedTestInput,
  type CheckAction,
  type GeneralDraft,
  type LoginDraft,
  type StoredLogin,
} from "./loginForm";
import { askWhom, errorMessage, Fact, KindBadge, Note, StatusPill } from "./panelParts";
import { connectionBindingsKey } from "./PersonLinks";
import { optionalSummary, PrivilegeReport, privilegeSummary } from "./PrivilegeReport";
import { ScriptDialog } from "./ScriptDialog";

type Outcome =
  | { type: "identity"; action: CheckAction; result: IdentityCheckResult; refused: boolean }
  | {
      type: "shared";
      test: TestConnectionResult | null;
      privileges: ConnectionPrivilegeReport | null;
      /** The save was refused because of the privileges. */
      blocked: boolean;
      /** The server asked for the password again rather than failing to connect. */
      passwordNeeded: boolean;
    };

export interface LoginTabProps {
  /** Null while creating. */
  connection: ClickHouseConnection | null;
  stored: StoredLogin | null;
  draft: LoginDraft;
  baseline: LoginDraft;
  onDraftChange: (patch: Partial<LoginDraft>) => void;
  /** The General tab's name and environment, sent with Create. */
  general: GeneralDraft;
  /** Create was pressed without a name: the panel shows General with the problem. */
  onNameMissing: (problem: string) => void;
  superAdmin: boolean;
  /** A super admin's read of the stored login: which kinds the server can run, and the role map. */
  identity: ConnectionIdentityDetail | null;
  saveRef: MutableRefObject<(() => Promise<boolean>) | null>;
  /** The login was saved or re-checked: reload the connection. */
  onSaved: () => Promise<void>;
  onCreated: (connection: ClickHouseConnection) => void;
  /** The kind was switched and saved: the panel goes on to who can query under the new kind. */
  onKindSwitched?: (kind: KnownIdentityMode) => void;
}

const KIND_IN_SENTENCE: Record<string, string> = {
  [IDENTITY_MODE_CEILING]: "a role-ceiling",
  [IDENTITY_MODE_PERSONAL]: "a personal",
};

function formatTime(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toLocaleString();
}

/** A role-ceiling or personal login, for someone who cannot change it. */
function ReadOnlyLogin({ connection }: { connection: ClickHouseConnection }): ReactElement {
  const pill = loginPill(connection);
  const checked = formatTime(connection.identityCheckedAt);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className={LABEL_CLASS}>ClickHouse login</span>
        <KindBadge label={identityKindLabel(connection.identityMode)} />
      </div>
      <dl className="divide-y divide-ink-500 rounded-xs border border-ink-500 bg-ink-100">
        <Fact label="Server">{`${connection.host}:${connection.port}${connection.sslEnabled ? " · TLS" : ""}`}</Fact>
        <Fact label="ClickHouse user">{connection.username}</Fact>
        <Fact label="Default database">{connection.database || <span className="text-paper-faint">Server default</span>}</Fact>
        {connection.systemRole && <Fact label="System role">{connection.systemRole}</Fact>}
      </dl>
      {pill && (
        <p className="flex flex-wrap items-center gap-2 text-[12px] text-paper-muted">
          <StatusPill pill={pill} dot />
          {checked && <span>checked {checked}</span>}
          {connection.identityHealth === "failing" && connection.identityHealthReason && <span className="text-red-700 dark:text-red-300">{connection.identityHealthReason}</span>}
        </p>
      )}
      <Note tone="lock" title={`Only a super admin can change the login of ${KIND_IN_SENTENCE[connection.identityMode] ?? "this"} connection. Ask ${askWhom(connection.accessContact)}.`} />
    </div>
  );
}

export function LoginTab(props: LoginTabProps): ReactElement {
  const { connection, superAdmin } = props;
  // On a kind other than a shared login the login is part of the kind: a super admin changes it.
  if (connection !== null && !superAdmin && props.stored?.kind !== IDENTITY_MODE_SHARED) {
    return <ReadOnlyLogin connection={connection} />;
  }
  return <LoginForm {...props} />;
}

function LoginForm({
  connection,
  stored,
  draft,
  baseline,
  onDraftChange,
  general,
  onNameMissing,
  superAdmin,
  identity,
  saveRef,
  onSaved,
  onCreated,
  onKindSwitched,
}: LoginTabProps): ReactElement {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /** Remounts the results (and their open rows) on every new outcome. */
  const [outcomeRun, setOutcomeRun] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState<"test" | "save" | "recheck" | null>(null);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const outcomeRef = useRef<HTMLDivElement | null>(null);

  const creating = connection === null;
  const route = loginRoute(stored, draft.kind);
  const nonShared = draft.kind !== IDENTITY_MODE_SHARED;
  const hint = kindHint(stored, draft.kind);
  const userChanged = stored !== null && draft.username.trim() !== stored.username;
  const storedNonShared = stored !== null && stored.kind !== IDENTITY_MODE_SHARED;
  const failing = connection !== null && storedNonShared && (connection.identityHealth === "failing" || stored?.kind === "unknown");
  const working = busy !== null;
  const dirty = isLoginDirty(draft, baseline);

  // "What changes for people" on a switch to personal counts the links prepared on the connection.
  const wantsLinks = superAdmin && connection !== null && draft.kind === IDENTITY_MODE_PERSONAL && stored?.kind !== IDENTITY_MODE_PERSONAL;
  const prepared = useQuery({
    queryKey: connectionBindingsKey(connection?.id ?? ""),
    queryFn: () => getConnectionBindings(connection?.id ?? ""),
    enabled: wantsLinks,
    retry: false,
  });
  const storedLinks = connection?.readiness?.links;
  const links = stored?.kind === IDENTITY_MODE_PERSONAL && storedLinks
    ? { total: storedLinks.active + storedLinks.pending + storedLinks.other, active: storedLinks.active }
    : prepared.data
      ? { total: prepared.data.bindings.length, active: prepared.data.readiness.counts.active }
      : null;
  const note = peopleNote(stored, draft.kind, { policies: connection?.readiness?.policies ?? null, links });

  const lockOf = (kind: KnownIdentityMode): string | null => kindLock(kind, { superAdmin, storedKind: stored?.kind ?? null, support: identity?.support });

  const showOutcome = (next: Outcome): void => {
    setOutcome(next);
    setOutcomeRun((run) => run + 1);
  };

  useEffect(() => {
    if (outcome && outcome.type === "identity" && !outcome.result.ok) outcomeRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [outcome]);

  /** A result for other values than the ones in the form would mislead. */
  const edit = (patch: Partial<LoginDraft>): void => {
    onDraftChange(patch);
    setFormError(null);
    setOutcome(null);
  };

  const problemBeforeSending = (): string | null => lockOf(draft.kind) ?? loginProblem(draft, stored);

  const showSharedTest = (result: TestConnectionResult, blockedBefore: boolean): void => {
    if (result.success && result.privileges) {
      showOutcome({ type: "shared", test: null, privileges: result.privileges, blocked: blockedBefore && !result.privileges.ok, passwordNeeded: false });
      const optional = optionalSummary(result.privileges);
      if (result.privileges.ok && !optional) toast.success("Connection successful", { description: "Every feature is available." });
      else if (result.privileges.ok) toast.warning("Connected; some optional features are missing", { description: `${optional} You can still save it.` });
      else toast.warning("Connected, but privileges are missing", { description: privilegeSummary(result.privileges) });
      return;
    }
    showOutcome({ type: "shared", test: result, privileges: null, blocked: false, passwordNeeded: false });
    if (result.success) toast.success("Connection successful", { description: `Version: ${result.version}` });
    else toast.error("Connection failed", { description: result.error });
  };

  const runTest = async (): Promise<void> => {
    const problem = problemBeforeSending();
    setFormError(problem);
    if (problem) return;
    setBusy("test");
    // Checking again after a refused save keeps the "can't save yet" banner until everything passes.
    const blockedBefore = outcome?.type === "shared" && outcome.blocked;
    try {
      if (route === "create_shared" || route === "patch") {
        showSharedTest(await rbacConnectionsApi.test(sharedTestInput(draft, connection?.id ?? null)), blockedBefore);
        return;
      }
      const change = identityChangeFrom(draft);
      const result = route === "create_identity" ? await checkNewConnectionIdentity(change) : await checkConnectionIdentity(connection?.id ?? "", change);
      showOutcome({ type: "identity", action: "test", result, refused: false });
      if (result.ok) toast.success("Every check passed", { description: "Nothing was saved." });
      else toast.warning("The login did not pass the checks", { description: result.reason ?? undefined });
    } catch (error) {
      const message = errorMessage(error, "Test failed");
      log.error("[ConnectionPanel] Login test failed", { errorMessage: message });
      if (route === "create_shared" || route === "patch") {
        showOutcome({ type: "shared", test: { success: false, error: message }, privileges: null, blocked: false, passwordNeeded: error instanceof ApiError && error.code === "PASSWORD_REQUIRED" });
      } else {
        setFormError(message);
      }
      toast.error("Couldn't test the login", { description: message });
    } finally {
      setBusy(null);
    }
  };

  /** Saved; still say so when an optional feature (ClickHouse access admin) isn't granted. */
  const notifySaved = (title: string, report: ConnectionPrivilegeReport | undefined): void => {
    const optional = report ? optionalSummary(report) : null;
    if (optional) toast.warning(title, { description: `${optional} Test the login to see the grants.` });
    else toast.success(title);
  };

  const failSave = (error: unknown): void => {
    const message = errorMessage(error, "Save failed");
    const action: CheckAction = creating ? "create" : "save";
    const title = creating ? "Couldn't create the connection" : "Couldn't save the login";
    if (error instanceof ApiError && error.code === "CONNECTION_CHANGED") {
      setChanged(true);
      toast.error(title, { description: message });
      return;
    }
    const refusal = identityCheckFromError(error);
    if (refusal) {
      showOutcome({ type: "identity", action, result: refusal, refused: true });
      toast.error(creating ? "Can't create this connection yet" : "Can't save this login yet", { description: message });
      return;
    }
    const report = privilegeReportFromError(error);
    if (report) {
      showOutcome({ type: "shared", test: null, privileges: report, blocked: true, passwordNeeded: false });
      toast.error(creating ? "Can't create this connection yet" : "Can't save these changes yet", { description: privilegeSummary(report) });
      return;
    }
    if (error instanceof ApiError && (error.code === "CONNECTION_TEST_FAILED" || error.code === "PASSWORD_REQUIRED")) {
      showOutcome({ type: "shared", test: { success: false, error: message }, privileges: null, blocked: false, passwordNeeded: error.code === "PASSWORD_REQUIRED" });
    } else {
      setFormError(message);
    }
    log.error("[ConnectionPanel] Login save failed", { errorMessage: message });
    toast.error(title, { description: message });
  };

  const save = async (): Promise<boolean> => {
    if (creating) {
      const missingName = nameProblem(general.name);
      if (missingName) {
        onNameMissing(missingName);
        return false;
      }
    }
    const problem = problemBeforeSending();
    setFormError(problem);
    if (problem) return false;
    if (!creating && !dirty) return true;
    setBusy("save");
    try {
      if (route === "create_shared") {
        const saved = await rbacConnectionsApi.create(createSharedInput(draft, general));
        notifySaved("Connection created", saved.privileges);
        onCreated(saved);
        return true;
      }
      if (route === "create_identity") {
        const created = await createIdentityConnection({
          ...identityChangeFrom(draft),
          name: general.name.trim(),
          host: draft.host.trim(),
          port: Number(draft.port),
          sslEnabled: draft.sslEnabled,
          password: draft.password,
          metadata: metadataWithEnvironment(null, general.environment),
        });
        toast.success("Connection created", { description: "Every check passed." });
        onCreated(created.connection);
        return true;
      }
      const id = connection?.id ?? "";
      if (route === "patch" && stored) {
        const saved = await rbacConnectionsApi.update(id, loginPatch(draft, stored));
        notifySaved("Login saved", saved.privileges);
        await onSaved();
        return true;
      }
      // The access contact is not part of the login: it alone is saved without the checks.
      if (stored && stored.kind === draft.kind && onlyContactChanged(draft, baseline)) {
        await setConnectionAccessContact(id, draft.accessContact.trim() || null);
        toast.success("Access contact saved");
        await onSaved();
        return true;
      }
      const switchedKind = stored?.kind !== draft.kind;
      const result = await switchConnectionIdentity(id, identityChangeFrom(draft));
      showOutcome({ type: "identity", action: "save", result: result.check, refused: false });
      toast.success(switchedKind ? `Now ${identityKindLabel(draft.kind).toLowerCase()}` : "Login saved", { description: "Every check passed." });
      await onSaved();
      if (switchedKind) onKindSwitched?.(draft.kind);
      return true;
    } catch (error) {
      failSave(error);
      return false;
    } finally {
      setBusy(null);
    }
  };

  // The panel saves the tab being left with "Save and go".
  useEffect(() => {
    saveRef.current = save;
    return () => {
      if (saveRef.current === save) saveRef.current = null;
    };
  });

  const recheck = async (): Promise<void> => {
    if (!connection) return;
    setBusy("recheck");
    try {
      const result = await recheckConnectionIdentity(connection.id);
      if (result.verdict) {
        showOutcome({ type: "identity", action: "recheck", result: { ok: result.verdict.ok, verdict: result.verdict, reason: result.verdict.reason }, refused: false });
      }
      if (result.identity.health === "failing") toast.error("The stored login is failing its checks", { description: result.identity.healthReason ?? undefined });
      else toast.success("Checked the stored login");
      await onSaved();
    } catch (error) {
      const message = errorMessage(error, "Check failed");
      log.error("[ConnectionPanel] Re-running the login checks failed", { errorMessage: message });
      toast.error("Couldn't check the stored login", { description: message });
    } finally {
      setBusy(null);
    }
  };

  const reload = async (): Promise<void> => {
    setChanged(false);
    setOutcome(null);
    await onSaved();
  };

  const warning = footerWarning(stored, draft);
  const footerText = warning
    ?? (creating
      ? route === "create_identity"
        ? "Create checks the login first. Nothing is created if a check fails."
        : "Create tests the login first. Nothing is created while a required privilege is missing."
      : failing && stored?.kind === draft.kind
        ? "Saving a working login ends the refusal at once."
        : "Test runs the checks and saves nothing. Save runs them too.");
  const pill = connection ? loginPill(connection) : null;
  const checkedAt = connection ? formatTime(connection.identityCheckedAt) : null;
  const sharedOutcome = outcome?.type === "shared" ? outcome : null;
  const privilegesFailing = sharedOutcome?.privileges ? !sharedOutcome.privileges.ok : false;

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {changed && (
        <Note tone="bad" title="This connection was changed by someone else while the checks ran">
          <p>Nothing was saved. Reload it, then make your change again.</p>
          <Button type="button" variant="outline" onClick={() => void reload()} className={cn(SECONDARY_BUTTON_CLASS, "h-7 self-start px-2")}>
            <RefreshCw className="h-3 w-3" aria-hidden />
            Reload
          </Button>
        </Note>
      )}

      {stored?.kind === "unknown" && connection && (
        <Note tone="bad" title={`This build does not know the kind "${connection.identityMode}"`}>
          <p>The connection refuses every request until it is switched to a kind below.</p>
        </Note>
      )}

      {failing && stored?.kind !== "unknown" && connection && (
        <Note tone="bad" title="The login is failing its checks">
          {connection.identityHealthReason && <p className="break-words">{connection.identityHealthReason}</p>}
          <p>Every query on this connection is refused until it's fixed.</p>
        </Note>
      )}

      <div className="flex flex-col gap-1.5">
        <span className={LABEL_CLASS} id="login-kind-label">Kind</span>
        <KindPicker
          value={draft.kind}
          storedLabel={stored ? identityKindLabel(stored.kind === "unknown" ? connection?.identityMode : stored.kind) : null}
          lockOf={lockOf}
          onChange={(kind) => edit({ kind })}
        />
      </div>

      {hint && (
        <Note tone="warn" title={hint.title}>
          <p>{hint.body}</p>
          {hint.userWithGrants && (
            <>
              <p>
                <span className="font-semibold">Use a new empty user</span> (recommended). {hint.userWithGrants} keeps working until you save.
              </p>
              <p>
                <span className="font-semibold">Or empty {hint.userWithGrants}.</span> Queries fail from the moment your admin removes its grants until you save.
              </p>
            </>
          )}
          {hint.script && (
            <button type="button" onClick={() => setScriptOpen(true)} className="self-start font-medium text-brand underline-offset-2 hover:underline">
              Show the script for the admin
            </button>
          )}
        </Note>
      )}

      {!hint && nonShared && (
        <button type="button" onClick={() => setScriptOpen(true)} className="-mt-3 self-start text-[12px] font-medium text-brand underline-offset-2 hover:underline">
          Show the script for the admin
        </button>
      )}

      {note && (
        <div role="note" aria-label="What changes for people" className="rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
          <p className="text-[13px] font-medium text-paper">What changes for people</p>
          <ul className="mt-1 flex flex-col gap-1 text-[12px] leading-[1.5] text-paper-muted">
            {note.map((line) => <li key={line}>· {line}</li>)}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="login-host" className={LABEL_CLASS}>Host</Label>
          <Input id="login-host" value={draft.host} onChange={(event) => edit({ host: event.target.value })} maxLength={255} autoComplete="off" spellCheck={false} placeholder="localhost" className={INPUT_CLASS} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="login-port" className={LABEL_CLASS}>Port</Label>
          <Input id="login-port" type="number" inputMode="numeric" value={draft.port} onChange={(event) => edit({ port: event.target.value })} placeholder="8123" className={INPUT_CLASS} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="login-username" className={LABEL_CLASS}>ClickHouse user</Label>
          <Input
            id="login-username"
            value={draft.username}
            onChange={(event) => edit({ username: event.target.value })}
            maxLength={255}
            autoComplete="off"
            spellCheck={false}
            placeholder={nonShared ? (draft.kind === IDENTITY_MODE_PERSONAL ? "chouse_personal" : "chouse_ceiling") : "default"}
            aria-invalid={privilegesFailing || undefined}
            className={cn(INPUT_CLASS, userChanged && "border-brand", privilegesFailing && "border-red-500 dark:border-red-400")}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="login-password" className={cn(LABEL_CLASS, "flex items-center gap-1.5")}>
            Password
            {!creating && !userChanged && <span className="normal-case tracking-normal text-paper-faint">(leave empty to keep)</span>}
          </Label>
          <div className="relative">
            <Input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={draft.password}
              onChange={(event) => edit({ password: event.target.value })}
              maxLength={1000}
              autoComplete="new-password"
              placeholder="••••••••"
              className={cn(INPUT_CLASS, "pr-9")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-paper-dim hover:text-paper"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="login-database" className={LABEL_CLASS}>Default database (optional)</Label>
          <Input id="login-database" value={draft.database} onChange={(event) => edit({ database: event.target.value })} maxLength={255} autoComplete="off" spellCheck={false} placeholder="default" className={INPUT_CLASS} />
          <p className={HELP_CLASS}>
            {draft.kind === IDENTITY_MODE_PERSONAL ? "Used only when a person's own ClickHouse user has no default database." : "Leave empty to use the server's default database."}
          </p>
        </div>
        {nonShared && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="login-system-role" className={LABEL_CLASS}>System role</Label>
            <Input id="login-system-role" value={draft.systemRole} onChange={(event) => edit({ systemRole: event.target.value })} maxLength={128} autoComplete="off" spellCheck={false} placeholder="chouse_system" className={INPUT_CLASS} />
            <p className={HELP_CLASS}>The ClickHouse role CHouse names for its own background work.</p>
          </div>
        )}
      </div>

      {draft.kind === IDENTITY_MODE_PERSONAL && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="login-impersonation-role" className={LABEL_CLASS}>Impersonation role</Label>
          <Input id="login-impersonation-role" value={draft.impersonationRole} onChange={(event) => edit({ impersonationRole: event.target.value })} maxLength={128} autoComplete="off" spellCheck={false} placeholder="chouse_impersonate" className={INPUT_CLASS} />
          <p className={HELP_CLASS}>The ClickHouse role that lets the login run a statement as a linked ClickHouse user. It must not be the system role.</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="login-ssl" className={LABEL_CLASS}>SSL / TLS</Label>
        <Switch id="login-ssl" checked={draft.sslEnabled} onCheckedChange={(checked) => edit({ sslEnabled: checked })} />
      </div>

      {nonShared && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-contact" className={LABEL_CLASS}>Access contact (optional)</Label>
          <Textarea
            id="login-contact"
            value={draft.accessContact}
            onChange={(event) => edit({ accessContact: event.target.value })}
            maxLength={ACCESS_CONTACT_MAX}
            rows={2}
            placeholder="Ask the data platform team in #data-access"
            className="min-h-[56px] rounded-xs border-ink-500 bg-ink-200 text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <p className={HELP_CLASS}>
            Shown to people when ClickHouse refuses them. {draft.accessContact.length}/{ACCESS_CONTACT_MAX}
          </p>
        </div>
      )}

      {connection && storedNonShared && stored?.kind !== "unknown" && pill && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-paper-muted">
            <StatusPill pill={pill.tone === "ok" ? { label: "Login passes every check", tone: "ok" } : pill} dot />
            {checkedAt && <span>checked {checkedAt}</span>}
          </p>
          <Button type="button" variant="outline" onClick={() => void recheck()} disabled={working} className={SECONDARY_BUTTON_CLASS}>
            {busy === "recheck" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            Re-run checks
          </Button>
        </div>
      )}

      {formError && <p role="alert" className={ERROR_CLASS}>{formError}</p>}

      <div ref={outcomeRef} className="flex min-w-0 flex-col gap-4">
        {outcome?.type === "identity" && (
          <CheckResults key={outcomeRun} result={outcome.result} action={outcome.action} username={draft.username.trim() || stored?.username || ""} refused={outcome.refused} />
        )}
        {sharedOutcome?.privileges && (
          <PrivilegeReport key={outcomeRun} report={sharedOutcome.privileges} blocked={sharedOutcome.blocked} isEditing={!creating} />
        )}
        {sharedOutcome?.test && (
          <div
            role={sharedOutcome.test.success ? "status" : "alert"}
            className={cn(
              "flex flex-col gap-1.5 rounded-xs border px-3 py-2.5",
              sharedOutcome.test.success
                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-950/30"
                : "border-red-200 bg-red-50 dark:border-red-500/40 dark:bg-red-950/30",
            )}
          >
            <p className={cn("flex items-center gap-2 text-[13px] font-medium", sharedOutcome.test.success ? "text-emerald-800 dark:text-emerald-200" : "text-red-800 dark:text-red-200")}>
              {sharedOutcome.test.success ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <AlertCircle className="h-4 w-4" aria-hidden />}
              {sharedOutcome.test.success ? "Connection successful" : sharedOutcome.passwordNeeded ? "Password needed" : "Connection failed"}
            </p>
            {sharedOutcome.test.success && sharedOutcome.test.version && (
              <p className="flex items-center gap-3 pl-6 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                <span>v{sharedOutcome.test.version}</span>
                {sharedOutcome.test.latencyMs !== undefined && (
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden />{sharedOutcome.test.latencyMs}ms</span>
                )}
              </p>
            )}
            {!sharedOutcome.test.success && sharedOutcome.test.error && (
              <p className="pl-6 font-mono text-[11px] leading-[1.5] text-red-700 dark:text-red-300">{sharedOutcome.test.error}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-500 pt-4">
        <p role={warning ? "note" : undefined} className={cn("min-w-0 flex-1 text-[12px] leading-[1.5]", warning ? "text-amber-800 dark:text-amber-200" : "text-paper-faint")}>
          {footerText}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" onClick={() => void runTest()} disabled={working} className={SECONDARY_BUTTON_CLASS}>
            {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            Test
          </Button>
          <Button type="submit" disabled={working || (!creating && !dirty)} className={PRIMARY_BUTTON_CLASS}>
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : creating ? <Plus className="h-3.5 w-3.5" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
            {creating ? "Create" : "Save"}
          </Button>
        </div>
      </div>

      {draft.kind !== IDENTITY_MODE_SHARED && (
        <ScriptDialog
          open={scriptOpen}
          onClose={() => setScriptOpen(false)}
          offerEmptyCurrent={Boolean(hint?.userWithGrants)}
          script={{
            kind: draft.kind,
            username: draft.username,
            currentUser: stored?.username ?? null,
            systemRole: draft.systemRole,
            impersonationRole: draft.impersonationRole,
            mappedRoles: identity?.roleMap.map((entry) => entry.clickhouseRole) ?? [],
          }}
        />
      )}
    </form>
  );
}
