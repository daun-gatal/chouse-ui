/**
 * How one connection reaches ClickHouse (ADR 0033): its kind (shared login,
 * role ceiling or personal), the stored login, the role names and the health
 * of its checks, with the form that switches them. Super admin only; the
 * server refuses everyone else.
 *
 * A switch never rewrites the login in place: a ClickHouse administrator
 * prepares a different user, the super admin enters it here, CHouse checks it,
 * and one save stores kind, login and role names together.
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp, CircleHelp, Loader2, Play, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import ConfirmationDialog from "@/components/common/ConfirmationDialog";
import {
  ACCESS_CONTACT_MAX,
  CLICKHOUSE_ROLE_NAME,
  IDENTITY_MODE_CEILING,
  IDENTITY_MODE_PERSONAL,
  IDENTITY_MODE_SHARED,
  checkConnectionIdentity,
  getConnectionIdentity,
  identityCheckFromError,
  identityKind,
  identityKindLabel,
  recheckConnectionIdentity,
  setConnectionAccessContact,
  switchConnectionIdentity,
  type ConnectionIdentity,
  type ConnectionIdentityDetail,
  type IdentityChange,
  type IdentityCheck,
  type IdentityCheckResult,
  type KnownIdentityMode,
} from "@/api/connectionIdentity";
import type { ClickHouseConnection } from "@/api/rbac";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";
import { CopyButton, PrivilegeReport } from "./PrivilegeReport";
import { RoleMapEditor } from "./RoleMapEditor";
import { ERROR_CLASS, HELP_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, SECTION_TITLE_CLASS } from "./formStyles";

interface IdentityPanelProps {
  /** The connection to show; null closes the panel. */
  connection: ClickHouseConnection | null;
  onClose: () => void;
  /** Something stored changed (kind, login, contact, health): the connection list is stale. */
  onChanged: () => void;
}

const KIND_OPTIONS: ReadonlyArray<{ value: KnownIdentityMode; label: string; explanation: string }> = [
  {
    value: IDENTITY_MODE_SHARED,
    label: "Shared login",
    explanation: "One ClickHouse user holds every grant, and everyone's statements run as it.",
  },
  {
    value: IDENTITY_MODE_CEILING,
    label: "Role ceiling",
    explanation:
      "The ClickHouse user holds no grants; each statement names the ClickHouse role mapped to the person's CHouse role, so ClickHouse itself limits them (needs ClickHouse 24.4 or newer).",
  },
  {
    value: IDENTITY_MODE_PERSONAL,
    label: "Personal",
    explanation: "Each person's statements run as their own ClickHouse user. The login itself holds no grants.",
  },
];

const DEFAULT_SYSTEM_ROLE = "chouse_system";
const DEFAULT_IMPERSONATION_ROLE = "chouse_impersonate";

const ROLE_NAME_RULE = "use letters, digits and underscores, not starting with a digit (128 at most).";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isKnownMode(value: string): value is KnownIdentityMode {
  return value === IDENTITY_MODE_SHARED || value === IDENTITY_MODE_CEILING || value === IDENTITY_MODE_PERSONAL;
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-2.5" aria-label={title}>
      <h3 className={SECTION_TITLE_CLASS}>{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <dt className={LABEL_CLASS}>{label}</dt>
      <dd className="min-w-0 break-all text-right font-mono text-[12px] text-paper">{children}</dd>
    </div>
  );
}

function HealthLine({ identity }: { identity: ConnectionIdentity }): ReactElement {
  if (identity.health === "ok") {
    return (
      <p className="flex items-center gap-2 text-[12px] text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Ready
      </p>
    );
  }
  if (identity.health === "failing") {
    return (
      <p role="alert" className="flex items-start gap-2 text-[12px] leading-[1.5] text-red-700 dark:text-red-300">
        <AlertCircle className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Failing{identity.healthReason ? `: ${identity.healthReason}` : ""}</span>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-[12px] text-paper-muted">
      <CircleHelp className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Not checked yet
    </p>
  );
}

function CheckRow({ check }: { check: IdentityCheck }): ReactElement {
  return (
    <li className="flex items-start gap-2.5 px-3 py-2">
      {check.ok ? (
        <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : (
        <X className="mt-[3px] h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium text-paper">{check.label}</span>
        <span className="break-words text-[11px] leading-[1.45] text-paper-faint">{check.detail}</span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-xs px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]",
          check.ok
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
        )}
      >
        {check.ok ? "Passed" : "Failed"}
      </span>
    </li>
  );
}

/** What the last Check, Save or Check now found. */
interface Outcome {
  title: string;
  /** One line above the rows: what happened, and that nothing was saved when nothing was. */
  summary: string;
  ok: boolean;
  checks: IdentityCheck[];
  privileges?: IdentityCheckResult["privileges"];
  /** The save was refused because of these checks. */
  refused: boolean;
  /** Remounts the privilege report (and its open rows) on every new outcome. */
  run: number;
}

function OutcomeView({ outcome }: { outcome: Outcome }): ReactElement {
  return (
    <Section title={outcome.title}>
      <p
        role={outcome.ok ? "status" : "alert"}
        className={cn(
          "flex items-start gap-2 text-[12px] leading-[1.5]",
          outcome.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300",
        )}
      >
        {outcome.ok ? <CheckCircle2 className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden /> : <AlertCircle className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden />}
        <span>{outcome.summary}</span>
      </p>
      {outcome.checks.length > 0 && (
        <ul className="divide-y divide-ink-500 rounded-xs border border-ink-500 bg-ink-100">
          {outcome.checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      )}
      {outcome.privileges && <PrivilegeReport key={outcome.run} report={outcome.privileges} blocked={outcome.refused} isEditing />}
    </Section>
  );
}

interface FormState {
  mode: KnownIdentityMode;
  username: string;
  password: string;
  systemRole: string;
  impersonationRole: string;
  accessContact: string;
  changeServer: boolean;
  host: string;
  port: string;
  sslEnabled: boolean;
}

function formFrom(identity: ConnectionIdentity, connection: ClickHouseConnection): FormState {
  return {
    mode: isKnownMode(identity.identityMode) ? identity.identityMode : IDENTITY_MODE_SHARED,
    username: identity.username,
    password: "",
    systemRole: identity.systemRole ?? DEFAULT_SYSTEM_ROLE,
    impersonationRole: identity.impersonationRole ?? DEFAULT_IMPERSONATION_ROLE,
    accessContact: identity.accessContact ?? "",
    changeServer: false,
    host: connection.host,
    port: String(connection.port),
    sslEnabled: connection.sslEnabled,
  };
}

/** What stops the form from being sent, or null. */
function formProblem(form: FormState, identity: ConnectionIdentity): string | null {
  const username = form.username.trim();
  if (username === "") return "Enter the ClickHouse user.";
  if (username !== identity.username && form.password === "") return "Enter the password of the new ClickHouse user.";
  if (form.mode !== IDENTITY_MODE_SHARED && form.systemRole.trim() === "") return "Enter the system role.";
  if (form.mode === IDENTITY_MODE_PERSONAL) {
    const impersonationRole = form.impersonationRole.trim();
    if (impersonationRole === "") return "Enter the impersonation role.";
    if (!CLICKHOUSE_ROLE_NAME.test(impersonationRole)) return `For the impersonation role, ${ROLE_NAME_RULE}`;
    if (impersonationRole === form.systemRole.trim()) return "The impersonation role and the system role must be two roles.";
  }
  if (form.changeServer) {
    if (form.host.trim() === "") return "Enter the host.";
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "Enter a port between 1 and 65535.";
  }
  return null;
}

function changeFrom(form: FormState): IdentityChange {
  return {
    identityMode: form.mode,
    username: form.username.trim(),
    ...(form.password !== "" ? { password: form.password } : {}),
    systemRole: form.mode === IDENTITY_MODE_SHARED ? null : form.systemRole.trim(),
    // Only a personal login has one; the server stores none for the other kinds.
    ...(form.mode === IDENTITY_MODE_PERSONAL ? { impersonationRole: form.impersonationRole.trim() } : {}),
    accessContact: form.accessContact.trim() || null,
    ...(form.changeServer ? { host: form.host.trim(), port: Number(form.port), sslEnabled: form.sslEnabled } : {}),
  };
}

function IdentityPanelBody({ connection, onChanged }: { connection: ClickHouseConnection; onChanged: () => void }): ReactElement {
  const [identity, setIdentity] = useState<ConnectionIdentityDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<"check" | "save" | "recheck" | "contact" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const connectionId = connection.id;

  const load = useCallback(async (): Promise<void> => {
    try {
      const detail = await getConnectionIdentity(connectionId);
      setIdentity(detail);
      setLoadError(null);
    } catch (error) {
      const message = errorMessage(error, "Couldn't load this connection's login");
      log.error("[IdentityPanel] Failed to load the identity", { errorMessage: message });
      setLoadError(message);
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Filled once, from the first identity read: a later reload must not overwrite what is being typed.
  useEffect(() => {
    if (identity && !form) setForm(formFrom(identity, connection));
  }, [identity, form, connection]);

  const showOutcome = (next: Omit<Outcome, "run">): void => {
    setOutcome((previous) => ({ ...next, run: (previous?.run ?? 0) + 1 }));
  };

  /** A result for other values than the ones in the form would mislead. */
  const edit = (patch: Partial<FormState>): void => {
    setForm((current) => (current ? { ...current, ...patch } : current));
    setFormError(null);
    setOutcome(null);
  };

  if (loadError && !identity) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-xs border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-500/40 dark:bg-red-950/30">
        <p className="flex items-center gap-2 text-[12px] text-red-800 dark:text-red-200">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {loadError}
        </p>
        <Button type="button" variant="outline" onClick={() => void load()} className={cn(SECONDARY_BUTTON_CLASS, "h-7 px-2")}>
          <RefreshCw className="h-3 w-3" aria-hidden />
          Try again
        </Button>
      </div>
    );
  }

  if (!identity || !form) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-paper-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Loading
      </p>
    );
  }

  const currentKind = identityKind(identity.identityMode);
  const username = form.username.trim();
  const userChanges = username !== identity.username;
  const kindChanges = form.mode !== identity.identityMode;
  const isSwitch = userChanges || kindChanges;
  // The selected kind decides what to prepare; while the form says shared login, the stored kind does.
  const setupKind = form.mode !== IDENTITY_MODE_SHARED ? form.mode : currentKind;
  const showCeilingSetup = setupKind === IDENTITY_MODE_CEILING;
  const showPersonalSetup = setupKind === IDENTITY_MODE_PERSONAL;
  const contactChanged = (form.accessContact.trim() || null) !== identity.accessContact;
  const working = busy !== null;

  const runCheck = async (): Promise<void> => {
    const problem = formProblem(form, identity);
    setFormError(problem);
    if (problem) return;
    setBusy("check");
    try {
      const result = await checkConnectionIdentity(connectionId, changeFrom(form));
      showOutcome({
        title: "Checks on the entered login",
        summary: result.ok
          ? "Every check passed. Nothing was saved."
          : `${result.reason ?? "The login did not pass the checks."} Nothing was saved.`,
        ok: result.ok,
        checks: result.verdict.checks,
        privileges: result.privileges,
        refused: false,
      });
      if (result.ok) toast.success("Every check passed", { description: "Nothing was saved." });
      else toast.warning("The login did not pass the checks", { description: result.reason ?? undefined });
    } catch (error) {
      const message = errorMessage(error, "Check failed");
      log.error("[IdentityPanel] Identity check failed", { errorMessage: message });
      setFormError(message);
      toast.error("Couldn't check the login", { description: message });
    } finally {
      setBusy(null);
    }
  };

  const runSave = async (): Promise<void> => {
    setConfirmOpen(false);
    setBusy("save");
    try {
      const result = await switchConnectionIdentity(connectionId, changeFrom(form));
      showOutcome({
        title: "Checks on the saved login",
        summary: "Saved. Every check passed.",
        ok: true,
        checks: result.check.verdict.checks,
        privileges: result.check.privileges,
        refused: false,
      });
      // The password is not kept in the form once it is stored.
      setForm({ ...formFrom(result.identity, connection), changeServer: false, host: form.host, port: form.port, sslEnabled: form.sslEnabled });
      setIdentity({ ...identity, ...result.identity });
      toast.success(isSwitch ? "Login switched" : "Login saved");
      onChanged();
      // The setup statements follow the stored role names.
      void load();
    } catch (error) {
      const message = errorMessage(error, "Save failed");
      const refusal = identityCheckFromError(error);
      if (refusal) {
        showOutcome({
          title: "Checks on the entered login",
          summary: `${message} Nothing was saved.`,
          ok: false,
          checks: refusal.verdict.checks,
          privileges: refusal.privileges,
          refused: true,
        });
        toast.error("Can't save this login yet", { description: message });
        return;
      }
      log.error("[IdentityPanel] Identity switch failed", { errorMessage: message });
      setFormError(message);
      toast.error("Couldn't save the login", { description: message });
    } finally {
      setBusy(null);
    }
  };

  const requestSave = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const problem = formProblem(form, identity);
    setFormError(problem);
    if (problem) return;
    if (isSwitch) setConfirmOpen(true);
    else void runSave();
  };

  const runRecheck = async (): Promise<void> => {
    setBusy("recheck");
    try {
      const result = await recheckConnectionIdentity(connectionId);
      setIdentity({ ...identity, ...result.identity });
      if (result.verdict) {
        showOutcome({
          title: "Checks on the stored login",
          summary: result.verdict.ok ? "Every check passed." : result.verdict.reason ?? "The stored login did not pass the checks.",
          ok: result.verdict.ok,
          checks: result.verdict.checks,
          refused: false,
        });
      } else {
        setOutcome(null);
      }
      if (result.identity.health === "failing") toast.error("The stored login is failing its checks", { description: result.identity.healthReason ?? undefined });
      else toast.success("Checked the stored login");
      onChanged();
    } catch (error) {
      const message = errorMessage(error, "Check failed");
      log.error("[IdentityPanel] Identity recheck failed", { errorMessage: message });
      toast.error("Couldn't check the stored login", { description: message });
    } finally {
      setBusy(null);
    }
  };

  const saveContact = async (): Promise<void> => {
    setBusy("contact");
    try {
      const saved = await setConnectionAccessContact(connectionId, form.accessContact.trim() || null);
      setIdentity({ ...identity, ...saved });
      toast.success("Access contact saved");
      onChanged();
    } catch (error) {
      const message = errorMessage(error, "Save failed");
      log.error("[IdentityPanel] Saving the access contact failed", { errorMessage: message });
      toast.error("Couldn't save the access contact", { description: message });
    } finally {
      setBusy(null);
    }
  };

  const setupStatements = showPersonalSetup ? identity.personalSetupStatements : identity.setupStatements;
  const statements = setupStatements.join("\n");

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {currentKind === "unknown" && (
        <div role="alert" className="rounded-xs border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-500/40 dark:bg-red-950/30">
          <p className="flex items-center gap-2 text-[13px] font-medium text-red-800 dark:text-red-200">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            This build does not know the kind "{identity.identityMode}"
          </p>
          <p className="mt-0.5 pl-[22px] text-[12px] leading-[1.5] text-red-700 dark:text-red-300">
            The connection refuses every request until it is switched to a kind below.
          </p>
        </div>
      )}

      <Section title="Now">
        <dl className="divide-y divide-ink-500 rounded-xs border border-ink-500 bg-ink-100">
          <Fact label="Kind">
            <span className="font-sans text-[13px] font-medium">{identityKindLabel(identity.identityMode)}</span>
          </Fact>
          <Fact label="ClickHouse user">{identity.username}</Fact>
          <Fact label="System role">{identity.systemRole ?? <span className="text-paper-faint">None</span>}</Fact>
          {(currentKind === IDENTITY_MODE_PERSONAL || identity.impersonationRole !== null) && (
            <Fact label="Impersonation role">{identity.impersonationRole ?? <span className="text-paper-faint">None</span>}</Fact>
          )}
          <Fact label="Access contact">{identity.accessContact ?? <span className="text-paper-faint">None</span>}</Fact>
        </dl>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <HealthLine identity={identity} />
            <p className={cn(HELP_CLASS, "pl-[22px]")}>
              {identity.checkedAt !== null ? `Last checked ${new Date(identity.checkedAt).toLocaleString()}` : "No check has run"}
              {identity.serverVersion ? ` · ClickHouse ${identity.serverVersion}` : ""}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void runRecheck()} disabled={working} className={cn(SECONDARY_BUTTON_CLASS, "shrink-0")}>
            {busy === "recheck" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            Check now
          </Button>
        </div>
      </Section>

      <Section title="Switch">
        <form onSubmit={requestSave} className="flex min-w-0 flex-col gap-4" noValidate>
          <RadioGroup
            value={form.mode}
            onValueChange={(value) => {
              if (isKnownMode(value)) edit({ mode: value });
            }}
            aria-label="Kind"
            className="gap-2"
          >
            {KIND_OPTIONS.map((option) => (
              <label
                key={option.value}
                htmlFor={`identity-kind-${option.value}`}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-xs border bg-ink-200 px-3 py-2.5",
                  form.mode === option.value ? "border-brand" : "border-ink-500",
                )}
              >
                <RadioGroupItem id={`identity-kind-${option.value}`} value={option.value} className="mt-0.5 border-ink-700 text-brand" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-paper">{option.label}</span>
                  <span className={cn(HELP_CLASS, "leading-[1.5]")}>{option.explanation}</span>
                </span>
              </label>
            ))}
          </RadioGroup>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="identity-username" className={LABEL_CLASS}>ClickHouse user</Label>
              <Input
                id="identity-username"
                value={form.username}
                onChange={(event) => edit({ username: event.target.value })}
                autoComplete="off"
                spellCheck={false}
                maxLength={255}
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="identity-password" className={cn(LABEL_CLASS, "flex items-center gap-1.5")}>
                Password
                {!userChanges && <span className="normal-case tracking-normal text-paper-faint">(leave empty to keep)</span>}
              </Label>
              <Input
                id="identity-password"
                type="password"
                value={form.password}
                onChange={(event) => edit({ password: event.target.value })}
                autoComplete="new-password"
                placeholder="••••••••"
                maxLength={1000}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          {form.mode === IDENTITY_MODE_PERSONAL && (
            <p className={cn(HELP_CLASS, "leading-[1.5]")}>
              A personal connection needs a ClickHouse build that passes the checks. Of the builds tested, only 26.3.63 does; on another build the check list says which check fails and why.
            </p>
          )}

          {form.mode !== IDENTITY_MODE_SHARED && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="identity-system-role" className={LABEL_CLASS}>System role</Label>
              <Input
                id="identity-system-role"
                value={form.systemRole}
                onChange={(event) => edit({ systemRole: event.target.value })}
                autoComplete="off"
                spellCheck={false}
                maxLength={128}
                placeholder={DEFAULT_SYSTEM_ROLE}
                className={INPUT_CLASS}
              />
              <p className={HELP_CLASS}>The ClickHouse role CHouse names for its own background work.</p>
            </div>
          )}

          {form.mode === IDENTITY_MODE_PERSONAL && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="identity-impersonation-role" className={LABEL_CLASS}>Impersonation role</Label>
              <Input
                id="identity-impersonation-role"
                value={form.impersonationRole}
                onChange={(event) => edit({ impersonationRole: event.target.value })}
                autoComplete="off"
                spellCheck={false}
                maxLength={128}
                placeholder={DEFAULT_IMPERSONATION_ROLE}
                className={INPUT_CLASS}
              />
              <p className={HELP_CLASS}>
                The ClickHouse role that lets the login run a statement as a linked ClickHouse user. It must not be the system role.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
            <button
              type="button"
              onClick={() => edit({ changeServer: !form.changeServer })}
              aria-expanded={form.changeServer}
              className="flex items-center justify-between gap-3 text-left"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-paper">Change server</span>
                <span className={HELP_CLASS}>
                  {form.changeServer ? "Host, port and TLS are saved with the login." : `Stays ${connection.host}:${connection.port}${connection.sslEnabled ? " over TLS" : ""}.`}
                </span>
              </span>
              {form.changeServer ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-paper-dim" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-paper-dim" aria-hidden />}
            </button>
            {form.changeServer && (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label htmlFor="identity-host" className={LABEL_CLASS}>Host</Label>
                  <Input id="identity-host" value={form.host} onChange={(event) => edit({ host: event.target.value })} maxLength={255} className={cn(INPUT_CLASS, "bg-ink-100")} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="identity-port" className={LABEL_CLASS}>Port</Label>
                  <Input id="identity-port" type="number" value={form.port} onChange={(event) => edit({ port: event.target.value })} className={cn(INPUT_CLASS, "bg-ink-100")} />
                </div>
                <div className="col-span-3 flex items-center justify-between gap-3">
                  <Label htmlFor="identity-ssl" className="text-[13px] font-medium text-paper">SSL / TLS</Label>
                  <Switch id="identity-ssl" checked={form.sslEnabled} onCheckedChange={(checked) => edit({ sslEnabled: checked })} />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="identity-contact" className={LABEL_CLASS}>Access contact (optional)</Label>
            <Textarea
              id="identity-contact"
              value={form.accessContact}
              onChange={(event) => edit({ accessContact: event.target.value })}
              maxLength={ACCESS_CONTACT_MAX}
              rows={2}
              placeholder="Ask the data platform team in #data-access"
              className="min-h-[56px] rounded-xs border-ink-500 bg-ink-200 text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="flex items-center justify-between gap-3">
              <p className={HELP_CLASS}>
                Shown to people when ClickHouse refuses them. {form.accessContact.length}/{ACCESS_CONTACT_MAX}
              </p>
              <Button type="button" variant="outline" onClick={() => void saveContact()} disabled={working || !contactChanged} className={cn(SECONDARY_BUTTON_CLASS, "h-7 shrink-0 px-2")}>
                {busy === "contact" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                Save contact only
              </Button>
            </div>
          </div>

          {isSwitch && (
            <div role="note" className="rounded-xs border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/40 dark:bg-amber-950/30">
              <p className="flex items-center gap-2 text-[13px] font-medium text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {userChanges ? "Saving replaces the ClickHouse user at once" : "Saving changes the kind at once"}
              </p>
              <p className="mt-0.5 pl-[22px] text-[12px] leading-[1.5] text-amber-700 dark:text-amber-300">
                {userChanges
                  ? `${username || "The new user"} replaces ${identity.username} for this connection as soon as you save. ${identity.username} keeps working until then; ask the ClickHouse administrator to drop it afterwards.`
                  : `This connection becomes ${identityKindLabel(form.mode).toLowerCase()} as soon as you save. A new kind normally needs its own ClickHouse user: the old user keeps working until the save and should be dropped by the ClickHouse administrator afterwards.`}
              </p>
            </div>
          )}

          {formError && <p role="alert" className={ERROR_CLASS}>{formError}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => void runCheck()} disabled={working} className={SECONDARY_BUTTON_CLASS}>
              {busy === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
              Check
            </Button>
            <Button type="submit" disabled={working} className={PRIMARY_BUTTON_CLASS}>
              {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
              Save
            </Button>
          </div>
        </form>
      </Section>

      {outcome && <OutcomeView outcome={outcome} />}

      {showCeilingSetup && (
        <Section title="Role map">
          <RoleMapEditor connectionId={connectionId} onSaved={() => void load()} />
        </Section>
      )}

      {(showCeilingSetup || showPersonalSetup) && setupStatements.length > 0 && (
        <Section title="For the ClickHouse administrator">
          <p className={cn(HELP_CLASS, "leading-[1.5]")}>
            {showPersonalSetup
              ? "A ClickHouse administrator runs these in ClickHouse to prepare the user and roles of a personal connection. CHouse never runs them. Each linked ClickHouse user needs one more grant, listed with this connection's links."
              : "A ClickHouse administrator runs these in ClickHouse to prepare the user and roles. CHouse never runs them."}
          </p>
          <div className="flex items-start justify-between gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
            <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.6] text-paper">{statements}</pre>
            <CopyButton text={statements} label="Copy" />
          </div>
        </Section>
      )}

      <ConfirmationDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void runSave()}
        title={userChanges ? "Replace the ClickHouse user?" : "Change the kind?"}
        description={
          userChanges ? (
            <p className="leading-[1.5]">
              <span className="font-mono text-paper">{username}</span> replaces <span className="font-mono text-paper">{identity.username}</span> for this connection at once, as {identityKindLabel(form.mode).toLowerCase()}. The old user keeps working until then and should be dropped by the ClickHouse administrator afterwards.
            </p>
          ) : (
            <p className="leading-[1.5]">
              This connection becomes {identityKindLabel(form.mode).toLowerCase()} at once, still as <span className="font-mono text-paper">{identity.username}</span>.
            </p>
          )
        }
        confirmText={userChanges ? "Save and replace" : "Save and change"}
        variant="warning"
      />
    </div>
  );
}

export function IdentityPanel({ connection, onClose, onChanged }: IdentityPanelProps): ReactElement {
  return (
    <Sheet open={connection !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>ClickHouse login{connection ? ` · ${connection.name}` : ""}</SheetTitle>
          <SheetDescription>
            How this connection reaches ClickHouse: its kind, the stored ClickHouse user and the roles its statements name. Only a super admin can change it.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {connection && <IdentityPanelBody key={connection.id} connection={connection} onChanged={onChanged} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
