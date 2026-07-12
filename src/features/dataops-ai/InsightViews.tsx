import type { DataOpsInvestigation, HealthIncidentCorrelation, HealthPromiseTuning, ScheduledQueryAssessment } from "@/api/dataOpsAi";

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return <section><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint">{title}</p><ul className="mt-2 space-y-1.5">{items.map((item, index) => <li key={`${index}:${item}`} className="text-[11px] leading-5 text-paper-muted">• {item}</li>)}</ul></section>;
}

export function InvestigationView({ result }: { result: DataOpsInvestigation }) {
  return <div className="space-y-5"><div className="rounded-xs border border-brand/25 bg-brand/5 p-4"><p className="text-[13px] font-medium text-paper">{result.likelyCause}</p><p className="mt-2 text-[12px] leading-5 text-paper-muted">{result.summary}</p><p className="mt-2 font-mono text-[9px] uppercase text-paper-faint">{Math.round(result.confidence * 100)}% confidence</p></div><Section title="Observed facts" items={result.observedFacts} /><Section title="Impact" items={result.impact} /><section><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint">Safe next actions</p><div className="mt-2 space-y-2">{result.actions.map((action) => <div key={`${action.kind}:${action.label}`} className="rounded-xs border border-ink-500 p-3"><p className="text-[11px] font-medium text-paper">{action.label}</p><p className="mt-1 text-[10px] text-paper-muted">{action.rationale}</p><p className="mt-1 font-mono text-[9px] uppercase text-paper-faint">{action.kind} · {action.risk} risk</p></div>)}</div></section><details><summary className="cursor-pointer font-mono text-[9px] uppercase text-paper-faint">Evidence</summary><div className="mt-2 space-y-1">{result.evidence.map((item) => <p key={item.id} className="text-[10px] text-paper-muted"><span className="text-paper">{item.label}</span> · {item.detail}</p>)}</div></details></div>;
}

export function AssessmentView({ result }: { result: ScheduledQueryAssessment }) {
  return <div className="space-y-5"><div className="rounded-xs border border-ink-500 p-4"><p className="font-mono text-[10px] uppercase text-paper-faint">{result.readiness}</p><p className="mt-2 text-[12px] text-paper-muted">{result.summary}</p></div><Section title="Blockers" items={result.blockers} /><Section title="Warnings" items={result.warnings} /><Section title="Recommendations" items={result.recommendations} /></div>;
}

export function TuningView({ result }: { result: HealthPromiseTuning }) {
  return <div className="space-y-4"><p className="text-[12px] leading-5 text-paper-muted">{result.summary}</p>{result.recommendations.map((item, index) => <div key={`${item.field}:${item.checkKey ?? index}`} className="rounded-xs border border-ink-500 p-3"><p className="text-[11px] font-medium text-paper">{item.checkKey ?? "Promise policy"} · {item.field}</p><p className="mt-1 font-mono text-[10px] text-paper-muted">{item.currentValue} → {item.proposedValue}</p><p className="mt-2 text-[10px] text-paper-muted">{item.rationale}</p><p className="mt-1 text-[10px] text-paper-faint">Expected: {item.expectedEffect} · {Math.round(item.confidence * 100)}% confidence</p></div>)}</div>;
}

export function CorrelationView({ result }: { result: HealthIncidentCorrelation }) {
  return <div className="space-y-4"><p className="text-[12px] leading-5 text-paper-muted">{result.summary}</p>{result.groups.length === 0 ? <p className="text-[11px] text-paper-faint">No credible related incident group was found.</p> : result.groups.map((group) => <div key={group.title} className="rounded-xs border border-ink-500 p-3"><p className="text-[11px] font-medium text-paper">{group.title}</p><p className="mt-1 text-[10px] text-paper-muted">{group.likelySharedCause}</p><p className="mt-2 font-mono text-[9px] uppercase text-paper-faint">{group.incidentIds.length} incidents · {Math.round(group.confidence * 100)}% confidence</p></div>)}</div>;
}
