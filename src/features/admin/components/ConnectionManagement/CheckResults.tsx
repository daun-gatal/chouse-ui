/**
 * What a Test, Create or Save of a role-ceiling or personal login found,
 * grouped by who fixes it: the ClickHouse administrator (with statements to
 * copy), the person filling the form, and what passed.
 */

import { useState, type ReactElement } from "react";
import { Check, X } from "lucide-react";

import type { IdentityCheck, IdentityCheckResult } from "@/api/connectionIdentity";
import { cn } from "@/lib/utils";
import { HELP_CLASS } from "./formStyles";
import { groupChecks, resultHeadline, type CheckAction } from "./loginForm";
import { Note, Section } from "./panelParts";
import { CopyButton, PrivilegeReport } from "./PrivilegeReport";

/** Passed checks shown before "+ n more". */
const PASSED_SHOWN = 2;

function CheckLine({ check }: { check: IdentityCheck }): ReactElement {
  return (
    <li className="flex items-start gap-2.5">
      {check.ok ? (
        <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Passed" />
      ) : (
        <X className="mt-[3px] h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-label="Failed" />
      )}
      <span className="min-w-0 text-[12px] leading-[1.5]">
        <span className="font-medium text-paper">{check.label}.</span>{" "}
        <span className="break-words text-paper-muted">{check.detail}</span>
      </span>
    </li>
  );
}

interface CheckResultsProps {
  result: IdentityCheckResult;
  action: CheckAction;
  /** The ClickHouse user the statements are for. */
  username: string;
  /** The save was refused because of this result: the privilege report says so. */
  refused: boolean;
}

export function CheckResults({ result, action, username, refused }: CheckResultsProps): ReactElement {
  const [showAllPassed, setShowAllPassed] = useState(false);
  const grouped = groupChecks(result, username);
  const passed = showAllPassed ? grouped.passed : grouped.passed.slice(0, PASSED_SHOWN);
  const hidden = grouped.passed.length - passed.length;
  const headline = resultHeadline(result, action);

  return (
    <div className="flex min-w-0 flex-col gap-4" aria-label="Check results">
      {result.ok ? (
        <Note tone="ok" title={headline} role="status" />
      ) : (
        <Note tone="bad" title={headline}>
          <p>{action === "recheck" ? "Every query on this connection is refused until it's fixed." : action === "test" ? "Fix what's listed, then Test again." : "Your fields are kept. Fix what's listed, then Test again."}</p>
        </Note>
      )}

      {grouped.forAdmin.length > 0 && (
        <Section title="For your ClickHouse admin">
          <ul className="flex flex-col gap-3">
            {grouped.forAdmin.map(({ check, statements }) => (
              <li key={check.id} className="flex flex-col gap-2">
                <ul><CheckLine check={check} /></ul>
                {statements.length > 0 && (
                  <div className="ml-6 flex items-start justify-between gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
                    <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.6] text-paper">{statements.join("\n")}</pre>
                    <CopyButton text={statements.join("\n")} label="Copy" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {grouped.forYou.length > 0 && (
        <Section title="For you">
          <ul className="flex flex-col gap-2">
            {grouped.forYou.map((check) => <CheckLine key={check.id} check={check} />)}
          </ul>
        </Section>
      )}

      {grouped.passed.length > 0 && (
        <Section title={`Passed · ${grouped.passed.length}`}>
          <ul className="flex flex-col gap-2">
            {passed.map((check) => <CheckLine key={check.id} check={check} />)}
          </ul>
          {hidden > 0 && (
            <button type="button" onClick={() => setShowAllPassed(true)} className={cn(HELP_CLASS, "self-start pl-6 hover:text-paper")}>
              + {hidden} more
            </button>
          )}
        </Section>
      )}

      {result.privileges && !result.privileges.complete && (
        <PrivilegeReport report={result.privileges} blocked={refused && !result.privileges.ok} isEditing={action !== "create"} />
      )}
    </div>
  );
}
