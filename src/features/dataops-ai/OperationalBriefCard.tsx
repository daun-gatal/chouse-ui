import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, HelpCircle, RefreshCw, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";

import { submitDataOpsAiFeedback, summarizeDataHealth, summarizeScheduledQuery } from "@/api/dataOpsAi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";

interface OperationalBriefCardProps {
  kind: "scheduled-query" | "data-health";
  id: string;
}

function HealthIcon({ health }: { health: "healthy" | "attention" | "unknown" }) {
  if (health === "healthy") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (health === "attention") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <HelpCircle className="h-4 w-4 text-paper-faint" />;
}

export function OperationalBriefCard({ kind, id }: OperationalBriefCardProps) {
  const canUseAi = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE));
  const query = useQuery({
    queryKey: ["dataops-ai", "brief", kind, id],
    queryFn: () => kind === "scheduled-query" ? summarizeScheduledQuery(id) : summarizeDataHealth(id),
    enabled: canUseAi && Boolean(id),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const [feedback, setFeedback] = useState<"useful" | "not_useful">();

  const recordFeedback = async (rating: "useful" | "not_useful") => {
    setFeedback(rating);
    try {
      await submitDataOpsAiFeedback({ capability: kind === "scheduled-query" ? "summarize-scheduled-query" : "summarize-data-health", objectType: kind === "scheduled-query" ? "scheduled_query" : "data_health_promise", objectId: id, rating });
    } catch {
      setFeedback(undefined);
    }
  };

  if (!canUseAi) return null;
  return (
    <Card className="rounded-xs border-brand/25 bg-brand/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand" />
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-brand">AI operational brief</p>
            <p className="mt-0.5 text-[10px] text-paper-faint">Grounded in the current definition and retained operational evidence.</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="Refresh AI brief">
          <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {query.isLoading && <p className="mt-4 text-[12px] text-paper-muted">Preparing operational brief…</p>}
      {query.isError && (
        <div className="mt-4 flex items-center gap-2 text-[11px] text-paper-muted">
          <HelpCircle className="h-3.5 w-3.5" /> AI brief is unavailable. Core job and health data remain unaffected.
        </div>
      )}
      {query.data && (
        <div className="mt-4 space-y-3">
          <div className="flex items-start gap-2">
            <HealthIcon health={query.data.health} />
            <div><p className="text-[13px] font-medium text-paper">{query.data.headline}</p><p className="mt-1 text-[12px] leading-5 text-paper-muted">{query.data.summary}</p></div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {query.data.facts.slice(0, 4).map((fact) => <div key={`${fact.label}:${fact.value}`} className="rounded-xs border border-ink-500 bg-ink-100/60 p-2"><p className="font-mono text-[9px] uppercase text-paper-faint">{fact.label}</p><p className="mt-1 text-[11px] text-paper">{fact.value}</p></div>)}
          </div>
          {query.data.suggestedAction && query.data.suggestedAction.kind !== "none" && <div className="rounded-xs border border-amber-500/20 bg-amber-500/5 p-3"><p className="text-[11px] font-medium text-paper">Suggested: {query.data.suggestedAction.label}</p><p className="mt-1 text-[10px] text-paper-muted">{query.data.suggestedAction.rationale} · {query.data.suggestedAction.risk} risk</p></div>}
          <details><summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">Evidence and freshness</summary><div className="mt-2 space-y-1">{query.data.evidence.slice(0, 8).map((item) => <p key={item.id} className="text-[10px] text-paper-muted"><span className="text-paper">{item.label}</span> · {item.detail}</p>)}</div></details>
          <div className="flex items-center justify-between gap-3"><p className="font-mono text-[9px] text-paper-faint">Generated {new Date(query.data.generatedAt).toLocaleString()} · {Math.round(query.data.confidence * 100)}% confidence · {query.data.model}</p><div className="flex items-center gap-1"><span className="font-mono text-[9px] text-paper-faint">Useful?</span><Button variant="ghost" size="icon" className={`h-6 w-6 ${feedback === "useful" ? "text-emerald-500" : ""}`} onClick={() => void recordFeedback("useful")} aria-label="Mark AI brief useful"><ThumbsUp className="h-3 w-3" /></Button><Button variant="ghost" size="icon" className={`h-6 w-6 ${feedback === "not_useful" ? "text-red-500" : ""}`} onClick={() => void recordFeedback("not_useful")} aria-label="Mark AI brief not useful"><ThumbsDown className="h-3 w-3" /></Button></div></div>
        </div>
      )}
    </Card>
  );
}
