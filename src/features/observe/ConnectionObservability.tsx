/**
 * Connection edit › Observability (ADR 0016 §1, §8): which system tables the
 * connection's user cannot read (collectors degrade, they never fail the
 * connection — missing grants only warn) and the separate remediation
 * credential approved fixes run with.
 */

import { useState, type KeyboardEvent, type ReactElement } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";

import { checkPrivileges } from "@/api/observe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { useRemediationCredential, useSaveRemediationCredential } from "./hooks";
import { formatAgo } from "./lib";

const LABEL = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";
const INPUT = "h-9 rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0";

/** Keeps Enter inside these fields from submitting the surrounding connection form. */
function stopEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") event.preventDefault();
}

export function ConnectionObservability({ connectionId }: { connectionId: string }): ReactElement | null {
  const { hasPermission } = useRbacStore();
  const canView = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_VIEW);
  const canEdit = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_EDIT);
  const credential = useRemediationCredential(connectionId, canView);
  const save = useSaveRemediationCredential();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<{ serverVersion: string | null; missing: string[]; grants: string[] } | null>(null);

  if (!canView) return null;

  const runCheck = async (): Promise<void> => {
    setChecking(true);
    try {
      setReport(await checkPrivileges(connectionId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Privilege check failed");
    } finally {
      setChecking(false);
    }
  };

  const store = async (): Promise<void> => {
    try {
      await save.mutateAsync({ connectionId, username: username.trim(), password });
      setPassword("");
      toast.success("Remediation credential saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the credential");
    }
  };

  return (
    <section className="space-y-3 rounded-xs border border-ink-500 p-3" aria-label="Observability">
      <div>
        <p className={LABEL}>Observability grants</p>
        <p className="mt-1 text-[11px] text-paper-faint">Collectors read system tables with this connection's user. Missing grants only switch the affected collector off.</p>
        {canEdit && (
          <Button type="button" variant="outline" className="mt-2 h-8 rounded-xs text-[11px]" disabled={checking} onClick={() => void runCheck()}>
            {checking ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3 w-3" />}Check privileges
          </Button>
        )}
        {report && (
          report.missing.length === 0 ? (
            <p className="mt-2 text-[11px] text-emerald-500">Every observed system table is readable{report.serverVersion ? ` on ${report.serverVersion}` : ""}.</p>
          ) : (
            <div className="mt-2 rounded-xs border border-amber-500/40 bg-amber-500/10 p-2">
              <p className="text-[11px] text-amber-500">Missing: {report.missing.join(", ")}. Grant these for full coverage:</p>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-paper">{report.grants.join(";\n")}</pre>
            </div>
          )
        )}
      </div>
      <div>
        <p className={LABEL}>Remediation credential</p>
        <p className="mt-1 text-[11px] text-paper-faint">
          Approved fixes run as this separate user, never as the connection's own.{" "}
          {credential.data?.configured ? `Configured for ${credential.data.username}, updated ${formatAgo(credential.data.updatedAt)}.` : "Not configured — fixes cannot run on this connection."}
        </p>
        {canEdit && (
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input aria-label="Remediation username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={stopEnter} placeholder={credential.data?.username ?? "chouse_fixer"} className={INPUT} autoComplete="off" />
            <Input aria-label="Remediation password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={stopEnter} placeholder="Password" className={INPUT} autoComplete="new-password" />
            <div className="flex gap-1">
              <Button type="button" variant="outline" className="h-9 rounded-xs text-[11px]" disabled={!username.trim() || save.isPending} onClick={() => void store()}><KeyRound className="mr-1 h-3 w-3" /> Save</Button>
              {credential.data?.configured && (
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label="Remove remediation credential" disabled={save.isPending} onClick={() => void save.mutateAsync({ connectionId, remove: true }).then(() => toast.success("Remediation credential removed"), (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not remove"))}>
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
