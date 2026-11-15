/**
 * StatementLogsNotice — stands in for one part of a page that reads the
 * ClickHouse statement logs (system.query_log, system.processes,
 * system.crash_log and the rest of that family) when the signed-in person may
 * not read them. The rest of the page keeps working.
 *
 * It is the small sibling of `NoPermission`, which covers a whole page or tab.
 * Pair it with `useCanReadStatementLogs`.
 */

import type { ReactElement } from "react";
import { ShieldOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { RBAC_PERMISSIONS } from "@/stores";

/** One-line form for a place too small for the notice, e.g. a chip or a legend row. */
export const STATEMENT_LOGS_PERMISSION_HINT = `Needs ${RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL}`;

interface StatementLogsNoticeProps {
  /** What is hidden, as the start of a sentence, e.g. "The query timeline". */
  subject: string;
  className?: string;
}

export function StatementLogsNotice({ subject, className }: StatementLogsNoticeProps): ReactElement {
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center justify-center gap-2 px-4 py-8 text-center", className)}
    >
      <span className="grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
        <ShieldOff className="h-5 w-5" aria-hidden />
      </span>
      <span className="text-[13px] text-paper">{subject} needs a permission</span>
      <span className="max-w-md text-[12px] leading-relaxed text-paper-muted">
        It reads ClickHouse tables that show other people's statements. Ask an administrator to grant{" "}
        <strong className="font-mono font-medium text-paper">{RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL}</strong>{" "}
        <span className="whitespace-nowrap text-paper-faint">(Admin → Roles)</span>.
      </span>
    </div>
  );
}
