/**
 * DoctorReportView — renders one ChouseD fleet health report.
 *
 * Verdict hero (status-coloured) → fleet status-count strip → per-node cards
 * (real metric chips + memory bar from the captured vitals, plus the AI's
 * finding bullets) → prioritised recommendations → collapsible evidence trail →
 * footer meta. Falls back to markdown if the model didn't return structured JSON.
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronRight, ArrowRight, Cpu, Database, Clock, Server, Zap, Copy, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  FleetDoctorReport,
  FleetDoctorNodeVitals,
  FleetDoctorHeavyQuery,
  DoctorStatus,
} from "@/api/fleet";
import {
  DOCTOR_STATUS,
  STATUS_RANK,
  timeAgo,
  formatDuration,
  formatBytes,
  formatTimestamp,
} from "./doctorShared";

type Tone = "ok" | "warn" | "crit" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  crit: "border-red-500/40 text-red-700 dark:text-red-400",
  muted: "border-ink-500 text-paper-muted",
};

const BAR_CLASS: Record<Tone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  crit: "bg-red-500",
  muted: "bg-ink-600",
};

function memTone(pct: number): Tone {
  return pct >= 90 ? "crit" : pct >= 75 ? "warn" : "ok";
}
function cpuTone(pct: number): Tone {
  return pct >= 90 ? "crit" : pct >= 75 ? "warn" : "ok";
}

function Chip({
  label,
  value,
  tone = "muted",
  title,
}: {
  label: string;
  value: string;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-xs border bg-ink-200/50 px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
        TONE_CLASS[tone],
      )}
    >
      <span className="uppercase tracking-[0.08em] text-paper-faint">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

interface ChipDescriptor {
  label: string;
  value: string;
  tone: Tone;
  title?: string;
}

function buildChips(v: FleetDoctorNodeVitals): ChipDescriptor[] {
  const chips: ChipDescriptor[] = [];
  if (!v.reachable) {
    chips.push({ label: "node", value: "unreachable", tone: "crit" });
    return chips;
  }
  if (v.memPct != null)
    chips.push({
      label: "mem",
      value: `${v.memPct}%`,
      tone: memTone(v.memPct),
      title: `${formatBytes(v.memUsedBytes)} / ${formatBytes(v.memTotalBytes)}`,
    });
  if (v.cpuPct != null)
    chips.push({ label: "cpu", value: `${Math.round(v.cpuPct)}%`, tone: cpuTone(v.cpuPct) });
  if (v.activeQueries != null)
    chips.push({ label: "queries", value: String(v.activeQueries), tone: "muted" });
  if (v.longRunningQueries) chips.push({ label: "long", value: String(v.longRunningQueries), tone: "warn" });
  if (v.longRunningMerges) chips.push({ label: "merges", value: String(v.longRunningMerges), tone: "warn" });
  if (v.openMutations) chips.push({ label: "mutations", value: String(v.openMutations), tone: "warn" });
  if (v.sickReplicas) chips.push({ label: "sick replicas", value: String(v.sickReplicas), tone: "crit" });
  if (v.replicaLagSeconds != null && v.replicaLagSeconds > 0)
    chips.push({
      label: "lag",
      value: `${Math.round(v.replicaLagSeconds)}s`,
      tone: v.replicaLagSeconds > 30 ? "crit" : "warn",
    });
  return chips;
}

function NodeCard({
  name,
  status,
  details,
  vitals,
}: {
  name: string;
  status: DoctorStatus;
  details: string[];
  vitals?: FleetDoctorNodeVitals;
}) {
  const s = DOCTOR_STATUS[status] ?? DOCTOR_STATUS.warning;
  const chips = vitals ? buildChips(vitals) : [];
  const memPct = vitals?.memPct ?? null;
  const memBarTone: Tone = memPct != null ? memTone(memPct) : "muted";

  return (
    <div className="rounded-xs border border-ink-500 bg-ink-200/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", s.dot)} aria-hidden />
        <span className="text-[13px] font-semibold text-paper">{name}</span>
        <span
          className={cn(
            "rounded-xs border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]",
            s.text,
            s.border,
          )}
        >
          {s.label}
        </span>
        {vitals?.version && (
          <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-paper-faint">
            <Server className="h-3 w-3" aria-hidden /> {vitals.version}
          </span>
        )}
      </div>

      {/* Real metric chips */}
      {chips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {chips.map((chip, i) => (
            <Chip key={i} label={chip.label} value={chip.value} tone={chip.tone} title={chip.title} />
          ))}
        </div>
      )}

      {/* Memory bar — the headline CH pressure signal */}
      {memPct != null && (
        <div className="mb-2.5 h-1 w-full overflow-hidden rounded-full bg-ink-300">
          <div
            className={cn("h-full rounded-full transition-all", BAR_CLASS[memBarTone])}
            style={{ width: `${Math.min(100, Math.max(2, memPct))}%` }}
          />
        </div>
      )}

      {/* AI findings */}
      {details.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 marker:text-paper-faint">
          {details.map((d, j) => (
            <li key={j} className="text-[12px] leading-relaxed text-paper-muted">
              {d}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VerdictHero({ report }: { report: FleetDoctorReport }) {
  const status: DoctorStatus = report.analysis?.verdict.status ?? "warning";
  const v = DOCTOR_STATUS[status] ?? DOCTOR_STATUS.warning;
  const summary = report.analysis?.verdict.summary ?? "Report generated without a structured verdict.";

  // Fleet status counts from the per-node analysis.
  const counts: Record<DoctorStatus, number> = { healthy: 0, warning: 0, critical: 0 };
  for (const n of report.analysis?.nodes ?? []) counts[n.status] = (counts[n.status] ?? 0) + 1;

  return (
    <div className={cn("rounded-xs border border-l-2 p-4", v.bg, v.border)}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-1.5 h-3 w-3 shrink-0 rounded-full", v.dot)} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className={cn("font-mono text-[10px] uppercase tracking-[0.18em]", v.text)}>{v.label}</div>
          <div className="mt-1 text-[16px] font-medium leading-snug text-paper">{summary}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-paper-faint">
            {report.trigger === "auto" && (
              <span className="inline-flex items-center gap-1 rounded-xs border border-brand/40 px-1.5 py-0.5 uppercase tracking-[0.12em] text-brand">
                <Zap className="h-3 w-3" aria-hidden /> Auto-RCA
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden /> {timeAgo(report.scannedAt)}
            </span>
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" aria-hidden /> {report.model}
            </span>
            <span>{formatDuration(report.durationMs)}</span>
            <span>
              {report.nodes} {report.nodes === 1 ? "node" : "nodes"}
            </span>
            {report.hours ? <span>{report.hours}h window</span> : null}
          </div>
        </div>
      </div>

      {/* Status-count strip */}
      {(counts.critical > 0 || counts.warning > 0 || counts.healthy > 0) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-500/40 pt-3">
          {(["critical", "warning", "healthy"] as DoctorStatus[]).map((st) =>
            counts[st] > 0 ? (
              <span
                key={st}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]",
                  DOCTOR_STATUS[st].text,
                  DOCTOR_STATUS[st].border,
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", DOCTOR_STATUS[st].dot)} aria-hidden />
                {counts[st]} {DOCTOR_STATUS[st].label}
              </span>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-xs border border-ink-500 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint transition-colors hover:bg-ink-200 hover:text-paper"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function compactNum(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function EstimateBlock({ estimate }: { estimate: NonNullable<FleetDoctorHeavyQuery["estimate"]> }) {
  const b = estimate.before;
  const a = estimate.after;
  const rowsCut = b && a && b.rows > 0 ? Math.round((1 - a.rows / b.rows) * 100) : null;
  const afterCls = (av: number, bv?: number) =>
    bv != null && av < bv ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-paper-muted";

  return (
    <div className="mt-2.5 rounded-xs border border-ink-500 bg-ink-100 p-2.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-dim">
          Estimated data scanned
        </span>
        {rowsCut != null && rowsCut > 0 && (
          <span className="rounded-xs border border-emerald-500/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
            ↓ {rowsCut}% fewer rows read
          </span>
        )}
        {rowsCut != null && rowsCut < 0 && (
          <span className="rounded-xs border border-amber-500/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-700 dark:text-amber-400">
            ↑ {Math.abs(rowsCut)}% more rows — optimized query not lighter
          </span>
        )}
      </div>

      {b && a ? (
        <div className="grid grid-cols-[3rem_1fr_auto_1fr] items-center gap-x-2 gap-y-1 font-mono text-[12px] tabular-nums">
          <span />
          <span className="text-right text-[9px] uppercase tracking-[0.1em] text-paper-faint">Original</span>
          <span />
          <span className="text-right text-[9px] uppercase tracking-[0.1em] text-paper-faint">Optimized</span>

          <span className="text-paper-faint">rows</span>
          <span className="text-right text-paper-muted">{compactNum(b.rows)}</span>
          <span className="text-center text-paper-dim">→</span>
          <span className={cn("text-right", afterCls(a.rows, b.rows))}>{compactNum(a.rows)}</span>

          <span className="text-paper-faint">parts</span>
          <span className="text-right text-paper-muted">{compactNum(b.parts)}</span>
          <span className="text-center text-paper-dim">→</span>
          <span className={cn("text-right", afterCls(a.parts, b.parts))}>{compactNum(a.parts)}</span>
        </div>
      ) : (
        <p className="text-[12px] leading-relaxed text-paper-muted">
          {b ? (
            <>
              The original query reads about <strong className="font-mono text-paper">{compactNum(b.rows)} rows</strong>{" "}
              ({compactNum(b.parts)} parts) off disk. The optimized query couldn't be estimated — EXPLAIN needs it
              to be complete, runnable SQL (no <code>…</code> placeholders).
            </>
          ) : (
            <>
              The optimized query would read about <strong className="font-mono text-paper">{compactNum(a!.rows)} rows</strong>{" "}
              ({compactNum(a!.parts)} parts). The original couldn't be estimated (it may be truncated).
            </>
          )}
        </p>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-paper-faint">
        How much data ClickHouse must read to answer the query — fewer rows/parts means less memory and a faster
        query. From EXPLAIN ESTIMATE (a plan estimate; the query isn't run).
      </p>
    </div>
  );
}

/**
 * The analysis sections of a heavy-query optimization — cause, per-table
 * findings, suggestions, and the before→after EXPLAIN estimate. Shared by
 * HeavyQueryCard (fleet doctor report) and OptimizeQueryDialog (Query Logs),
 * so both render identical analysis. The query/optimized code blocks are NOT
 * included here — callers render those themselves (the dialog uses a diff).
 */
export interface OptimizationAnalysisData {
  cause?: string;
  tables?: { name: string; engine?: string; rows?: string; note: string }[];
  suggestions?: string[];
  estimate?: FleetDoctorHeavyQuery["estimate"];
}

export function OptimizationAnalysis({ cause, tables, suggestions, estimate }: OptimizationAnalysisData) {
  return (
    <>
      {cause && (
        <p className="mb-2 text-[12px] leading-relaxed text-paper-muted">
          <span className="font-medium text-paper">Why: </span>
          {cause}
        </p>
      )}

      {tables && tables.length > 0 && (
        <ul className="mb-2 space-y-1">
          {tables.map((t, j) => (
            <li key={j} className="flex flex-wrap items-baseline gap-1.5 text-[11px] leading-relaxed">
              <span className="font-mono font-medium text-paper">{t.name}</span>
              {t.engine && <span className="font-mono text-[10px] text-paper-faint">{t.engine}</span>}
              {t.rows && <span className="font-mono text-[10px] text-paper-faint">· {t.rows} rows</span>}
              <span className="text-paper-muted">— {t.note}</span>
            </li>
          ))}
        </ul>
      )}

      {suggestions && suggestions.length > 0 && (
        <ul className="space-y-1">
          {suggestions.map((s, j) => (
            <li key={j} className="flex gap-2 text-[12px] leading-relaxed text-paper-muted">
              <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-brand" aria-hidden />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}

      {estimate && (estimate.before || estimate.after) && <EstimateBlock estimate={estimate} />}
    </>
  );
}

export function HeavyQueryCard({ hq }: { hq: FleetDoctorHeavyQuery }) {
  // Render queries as-is. The original is the real query that ran; the optimized
  // one is AI output that's already pretty + valid. Do NOT client-reformat: the
  // sql-formatter uppercases case-sensitive ClickHouse function/identifier names
  // and can break the (runnable) optimized query.
  const formattedOriginal = hq.query;
  const formattedOptimized = hq.optimizedQuery ?? "";
  return (
    <div className="rounded-xs border border-ink-500 bg-ink-200/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-xs border border-red-500/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-red-700 dark:text-red-400">
          {hq.peakMemory}
        </span>
        <span className="text-[12px] font-semibold text-paper">{hq.node}</span>
        {hq.user && <span className="font-mono text-[10px] text-paper-faint">{hq.user}</span>}
      </div>

      <code className="mb-2 block max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xs border border-ink-500 bg-ink-100 p-2 font-mono text-[11px] leading-relaxed text-paper-muted">
        {formattedOriginal}
      </code>

      <OptimizationAnalysis
        cause={hq.cause}
        tables={hq.tables}
        suggestions={hq.suggestions}
        estimate={hq.estimate}
      />

      {formattedOptimized && (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-brand">
              Optimized query · review before running
            </span>
            <CopyButton text={formattedOptimized} />
          </div>
          <code className="block max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xs border border-brand/30 bg-ink-100 p-2.5 font-mono text-[11px] leading-relaxed text-paper-muted">
            {formattedOptimized}
          </code>
        </div>
      )}
    </div>
  );
}

export default function DoctorReportView({ report }: { report: FleetDoctorReport }) {
  const analysis = report.analysis;
  const vitalsByName = new Map(report.vitals.map((v) => [v.name, v]));

  // Worst-first so the operator sees the fire before the calm.
  const nodes = [...(analysis?.nodes ?? [])].sort(
    (a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9),
  );

  return (
    <div className="space-y-4">
      <VerdictHero report={report} />

      {!analysis && report.raw.trim() && (
        <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-p:text-paper-muted prose-li:text-paper-muted prose-strong:text-paper">
          <ReactMarkdown>{report.raw}</ReactMarkdown>
        </div>
      )}

      {!analysis && !report.raw.trim() && (
        <p className="rounded-xs border border-ink-500 bg-ink-200 px-4 py-6 text-center text-[12px] text-paper-muted">
          The model didn't return a report this time. Try re-scanning or pick a different model.
        </p>
      )}

      {nodes.length > 0 && (
        <div>
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-dim">Nodes</div>
          <div className="space-y-2">
            {nodes.map((n, i) => (
              <NodeCard
                key={i}
                name={n.name}
                status={n.status}
                details={n.details}
                vitals={vitalsByName.get(n.name)}
              />
            ))}
          </div>
        </div>
      )}

      {analysis?.heavyQueries && analysis.heavyQueries.length > 0 && (
        <div>
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-dim">
            Heavy query analysis
          </div>
          <div className="space-y-2">
            {analysis.heavyQueries.map((hq, i) => (
              <HeavyQueryCard key={i} hq={hq} />
            ))}
          </div>
        </div>
      )}

      {analysis && analysis.recommendations.length > 0 && (
        <div>
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-dim">Recommendations</div>
          <ul className="space-y-1.5">
            {analysis.recommendations.map((r, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-paper-muted">
                <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-brand" aria-hidden />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.steps.length > 0 && (
        <details className="rounded-xs border border-ink-500 bg-ink-200/50">
          <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
            <Database className="h-3 w-3" aria-hidden />
            Evidence · {report.steps.length} {report.steps.length === 1 ? "query" : "queries"} the agent ran
          </summary>
          <ul className="space-y-1.5 border-t border-ink-500 px-3 py-2">
            {report.steps.map((s, i) => {
              const sql =
                s.input && typeof s.input === "object" && "sql" in s.input
                  ? String((s.input as { sql: unknown }).sql)
                  : JSON.stringify(s.input);
              return (
                <li key={i} className="flex gap-2 font-mono text-[11px] text-paper-faint">
                  <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-paper-dim" aria-hidden />
                  <code className="break-all">{sql}</code>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-500 pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
        <span>Scanned {formatTimestamp(report.scannedAt)}</span>
        <span className="text-paper-dim">·</span>
        <span>
          {report.nodes} {report.nodes === 1 ? "node" : "nodes"}
        </span>
        <span className="text-paper-dim">·</span>
        <span>{formatDuration(report.durationMs)}</span>
        <span className="text-paper-dim">·</span>
        <span>{report.model}</span>
      </div>
    </div>
  );
}
