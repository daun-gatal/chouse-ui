/**
 * "AI investigated" (ADR 0024 §Phase 4): shown on a subject auto-triage
 * looked at, with the finding as a tooltip and a link to the investigation.
 * Renders nothing when there was no completed investigation.
 */

import type { ReactElement } from "react";
import { Link } from "react-router";
import { Sparkles } from "lucide-react";

import type { TriageTrigger } from "@/api/aiTriage";
import { useTriageRunForSubject } from "./hooks";

export function AiInvestigatedBadge({ trigger, subjectId }: { trigger: TriageTrigger; subjectId: string }): ReactElement | null {
  const run = useTriageRunForSubject(trigger, subjectId);
  const data = run.data;
  if (!data || data.status !== "completed") return null;
  const detail = [data.summary, data.result ? `Likely cause: ${data.result.likelyCause}` : null].filter(Boolean).join("\n");
  return (
    <Link
      to="/ai/triage"
      title={detail}
      className="inline-flex items-center gap-1 rounded-xs border border-brand/40 bg-brand/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-brand transition-colors hover:bg-brand/10"
    >
      <Sparkles className="h-3 w-3" aria-hidden /> AI investigated{data.actionIds.length > 0 ? ` · ${data.actionIds.length} proposed` : ""}
    </Link>
  );
}
