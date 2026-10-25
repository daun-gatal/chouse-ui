/**
 * Connection edit › Observability (ADR 0016 §1, §8): the separate
 * remediation credential approved fixes run with, and this connection's
 * collection schedule (issue #380). What the connection's own user can read
 * is part of Test connection (PrivilegeReport).
 */

import { useState, type KeyboardEvent, type ReactElement } from "react";
import { toast } from "sonner";
import { KeyRound, Timer, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { CollectorSchedule } from "./CollectorSchedule";
import { useCollectorSchedule, useRemediationCredential, useSaveRemediationCredential } from "./hooks";
import { formatAgo, formatBytes } from "./lib";
import { scheduleSummary } from "./schedule";

const LABEL = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";
const INPUT = "h-9 rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0";

/** Keeps Enter inside these fields from submitting the surrounding connection form. */
function stopEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") event.preventDefault();
}

/**
 * The connection's collection schedule as one line; the full table opens in
 * a side panel, since this dialog is too narrow for it.
 */
function ScheduleSummaryLine({ connectionId, canEdit }: { connectionId: string; canEdit: boolean }): ReactElement {
  const [open, setOpen] = useState(false);
  const schedule = useCollectorSchedule(connectionId);
  const summary = schedule.data ? scheduleSummary(schedule.data.collectors) : null;
  return (
    <div>
      <p className={LABEL}>Collection schedule</p>
      <p className="mt-1 text-[11px] text-paper-faint">
        {summary === null
          ? "How often each collector reads this server, and what that costs."
          : [
            summary.ownSettings > 0 ? `${summary.ownSettings} collector${summary.ownSettings === 1 ? "" : "s"} with their own setting here` : "Follows the defaults",
            summary.paused > 0 ? `${summary.paused} paused` : null,
            summary.bytesPerDay !== null ? `≈ ${formatBytes(summary.bytesPerDay)} read per day` : null,
          ].filter(Boolean).join(" · ")}
      </p>
      <Button type="button" variant="outline" className="mt-2 h-8 rounded-xs text-[11px]" onClick={() => setOpen(true)}>
        <Timer className="mr-1.5 h-3 w-3" /> {canEdit ? "Open collection schedule" : "View collection schedule"}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-4xl">
          <SheetHeader>
            <SheetTitle>Collection schedule for this connection</SheetTitle>
            <SheetDescription>How often each collector reads this server, and what that costs. Settings here win over the defaults in Collection schedule on the Connections page.</SheetDescription>
          </SheetHeader>
          <div className="mt-4">{open && <CollectorSchedule connectionId={connectionId} canEdit={canEdit} />}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function ConnectionObservability({ connectionId }: { connectionId: string }): ReactElement | null {
  const { hasPermission } = useRbacStore();
  const canView = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_VIEW);
  const canEdit = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_EDIT);
  const credential = useRemediationCredential(connectionId, canView);
  const save = useSaveRemediationCredential();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  if (!canView) return null;

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
      <ScheduleSummaryLine connectionId={connectionId} canEdit={canEdit} />
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
