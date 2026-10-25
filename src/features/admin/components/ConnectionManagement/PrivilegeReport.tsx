/**
 * What a connection's ClickHouse user is missing for each CHouse UI feature,
 * with the GRANT statements that fix it. Shown after Test connection, and in
 * place of the save when the server refused it (PRIVILEGES_MISSING).
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp, Copy, Lock, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConnectionPrivilegeReport, PrivilegeFeatureReport } from "@/api/rbac";

interface PrivilegeReportProps {
  report: ConnectionPrivilegeReport;
  /** The save was refused: say so, and open every failing feature. */
  blocked: boolean;
  /** "Can't create this connection yet" vs "Can't save these changes yet". */
  isEditing: boolean;
  version?: string;
  latencyMs?: number;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** One sentence on what is wrong, for the banner. */
export function privilegeSummary(report: ConnectionPrivilegeReport): string {
  const failing = report.features.filter((f) => f.status === "missing").length;
  if (report.missingCount === 0) {
    return failing === 0
      ? `${report.username} has every privilege CHouse UI needs.`
      : `Some privileges for ${report.username} couldn't be checked. Check again.`;
  }
  return `${report.username} is missing ${plural(report.missingCount, "privilege", "privileges")} across ${plural(failing, "feature", "features")}.`;
}

function CopyButton({ text, label }: { text: string; label: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to the clipboard", { description: "Select the statements and copy them instead." });
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void copy()}
      className="h-7 shrink-0 gap-1.5 rounded-xs border-ink-500 bg-ink-100 px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-paper hover:border-ink-700 hover:bg-ink-200"
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function FeatureRow({ feature, open, onToggle }: { feature: PrivilegeFeatureReport; open: boolean; onToggle: () => void }): ReactElement {
  const failing = feature.status === "missing";
  const count = feature.missing.length;
  const note = feature.unavailable.length > 0 ? `${feature.unavailable.join(", ")} not available on this server` : feature.description;
  const header = (
    <>
      {failing ? (
        <X className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
      ) : (
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      )}
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-[13px] font-medium text-paper">{feature.name}</span>
        <span className="break-words text-[11px] leading-[1.45] text-paper-faint">{note}</span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-xs px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]",
          failing ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
        )}
      >
        {failing ? (count > 0 ? `${count} missing` : "Not checked") : "Granted"}
      </span>
    </>
  );

  if (!failing) {
    return <div className="flex items-center gap-2.5 px-3 py-2">{header}</div>;
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-ink-200"
      >
        {header}
        {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-paper-dim" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-paper-dim" aria-hidden />}
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-ink-500 bg-ink-200 py-2 pl-9 pr-3">
          {feature.grants.length > 0 && (
            <div className="flex items-start justify-between gap-2">
              <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.6] text-paper">{feature.grants.join("\n")}</pre>
              <CopyButton text={feature.grants.join("\n")} label="Copy" />
            </div>
          )}
          {feature.errors.map((error) => (
            <p key={error} className="font-mono text-[11px] leading-[1.5] text-red-700 dark:text-red-300">Couldn't check {error}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export function PrivilegeReport({ report, blocked, isEditing, version, latencyMs }: PrivilegeReportProps): ReactElement {
  const [open, setOpen] = useState<Set<string>>(() =>
    new Set(blocked ? report.features.filter((f) => f.status === "missing").map((f) => f.id) : []),
  );

  const toggle = (id: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const connected = version ? `Connected to ClickHouse ${version}${latencyMs !== undefined ? ` in ${latencyMs}ms` : ""}` : "Connected";

  return (
    <section className="flex flex-col gap-2" aria-label="ClickHouse privileges">
      {blocked && !report.ok ? (
        <div role="alert" className="rounded-xs border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-500/40 dark:bg-red-950/30">
          <p className="flex items-center gap-2 text-[13px] font-medium text-red-800 dark:text-red-200">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {isEditing ? "Can't save these changes yet" : "Can't create this connection yet"}
          </p>
          <p className="mt-0.5 pl-[22px] text-[12px] leading-[1.5] text-red-700 dark:text-red-300">
            {privilegeSummary(report)}
            {report.missingCount > 0 && " Run the grants below as a ClickHouse admin, then save again."}
          </p>
        </div>
      ) : report.ok ? (
        <p className="flex items-center gap-2 text-[12px] text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          {connected}. Every feature is available.
        </p>
      ) : (
        <p className="flex items-center gap-2 text-[12px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {connected}, but {privilegeSummary(report).replace(/\.$/, "")}. Saving needs every feature granted.
        </p>
      )}

      <div className="divide-y divide-ink-500 rounded-xs border border-ink-500 bg-ink-100">
        {report.features.map((feature) => (
          <FeatureRow key={feature.id} feature={feature} open={open.has(feature.id)} onToggle={() => toggle(feature.id)} />
        ))}
      </div>

      {report.grantScript && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] leading-[1.5] text-paper-faint">
            If {report.username} gets its access through a role, grant these to the role instead.
          </p>
          <CopyButton text={report.grantScript} label="Copy all grants" />
        </div>
      )}
    </section>
  );
}
