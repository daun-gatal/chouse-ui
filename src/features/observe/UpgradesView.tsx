/**
 * Monitoring › Upgrades (ADR 0029): where this connection's ClickHouse stands,
 * the versions worth moving to, and — when someone clicks Check — what that
 * upgrade changes for the real workload. Exact when a connection already runs
 * the target line, from the release notes otherwise; Chouse AI reads the notes
 * when it is set up, and the top queries can be planned here with the
 * target's settings. CHouse UI never performs the upgrade.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpCircle, Check, Copy, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { fetchAiModels, invokeAI } from "@/api/ai";
import type { AssessmentSummary, UpgradeStatus, UpgradeTarget } from "@/api/upgrades";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { useAiModelId } from "@/hooks";
import { log } from "@/lib/log";
import {
  agoText, checkMarkdown, checkSteps, checkVerdict, daysSince, findingCounts, formatDay, mainFindings, notesToJudge, stepState,
  supportWindowText, targetKindLabel, targetTag, versionStatusText, versionTone,
} from "@/lib/upgrades";
import { cn } from "@/lib/utils";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";
import { upgradeKeys, useAssessment, useUpgradeMutations, useUpgradeReferences, useUpgrades, useUpgradeStatus } from "./hooks";
import { formatAgo, formatCount } from "./lib";
import { copyText, UpgradeFinding } from "./UpgradeFinding";
import { EmptyState, ErrorState, LoadingGrid, OBS_LABEL, Panel, StatusPill } from "./ui";

const VERSION_RE = /^\d{1,3}\.\d{1,2}(\.\d{1,4}(\.\d{1,6})?)?$/;
const NOTES_ONLY = "notes";

function lineOf(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

export function UpgradesView({ refreshKey }: { refreshKey?: number }): ReactElement {
  const client = useQueryClient();
  const canRun = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.UPGRADES_RUN));
  const status = useUpgradeStatus();
  const list = useUpgrades();
  const [searchParams] = useSearchParams();
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState("");

  useEffect(() => {
    if (refreshKey) void client.invalidateQueries({ queryKey: upgradeKeys.all });
  }, [refreshKey, client]);

  const targets = useMemo(() => status.data?.targets ?? [], [status.data]);
  // ?target= from the Fleet may name a line ("26.8") or a patch.
  const fromUrl = searchParams.get("target");
  const urlTarget = fromUrl && VERSION_RE.test(fromUrl) ? (targets.find((t) => t.line === fromUrl || t.patch === fromUrl)?.patch ?? fromUrl) : null;
  const target = picked ?? urlTarget ?? targets.find((t) => t.recommended)?.patch ?? targets[0]?.patch ?? null;

  if (status.isLoading || list.isLoading) return <LoadingGrid />;
  if (status.isError || !status.data) return <ErrorState title="Upgrade status could not be loaded." error={status.error} />;
  if (list.isError || !list.data) return <ErrorState title="Upgrade checks could not be loaded." error={list.error} />;
  const s = status.data;
  const checks = list.data.assessments;

  const submitOther = (): void => {
    const v = other.trim();
    if (VERSION_RE.test(v)) setPicked(v);
  };

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4" data-onboarding-id="monitoring-upgrades-assess">
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight text-paper">What an upgrade changes for this connection</h2>
        <p className="mt-1 text-[12px] text-paper-muted">Checked on demand against your schema, settings profiles and 30 days of query_log. CHouse never upgrades anything.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <StatusCard status={s} />
        <div className="min-w-0 space-y-2">
          <p className={OBS_LABEL}>Where to go next</p>
          {/* Flex-wrap, not a fixed grid: there are 0–3 targets, and every row should fill its width. */}
          <div className="flex flex-wrap items-stretch gap-2">
            {targets.map((t) => (
              <TargetCard key={`${t.kind}:${t.patch}`} target={t} all={targets} selected={target === t.patch} last={checks.find((a) => a.targetVersion === t.patch && a.status === "done")} onPick={() => setPicked(t.patch)} />
            ))}
            <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-2 rounded-xs border border-dashed border-ink-500 bg-ink-100 p-3">
              <span className={OBS_LABEL}>Other version</span>
              <label htmlFor="upgrade-other" className="text-[11px] text-paper-muted">A specific line or patch</label>
              <div className="flex max-w-xs gap-1.5">
                <Input id="upgrade-other" value={other} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitOther()} placeholder="26.9.27.3" className="h-8 min-w-0 flex-1 rounded-xs font-mono text-[12px]" />
                <Button variant="outline" className="h-8 rounded-xs text-[11px]" disabled={!VERSION_RE.test(other.trim())} onClick={submitOther}>Pick</Button>
              </div>
              {targets.length === 0 && <p className="text-[11px] text-paper-muted">{s.enabled ? "Nothing newer is supported right now." : "Release data is off on this server, so pick a version here."}</p>}
            </div>
          </div>
        </div>
      </div>

      {target ? (
        <ImpactPanel key={target} target={target} status={s} checks={checks} canRun={canRun} />
      ) : (
        <Panel title="Impact"><EmptyState title="Pick a version to check" body="Choose a target above or type one." /></Panel>
      )}
    </div>
  );
}

function StatusCard({ status: s }: { status: UpgradeStatus }): ReactElement {
  const c = s.current;
  const tone = versionTone(c);
  return (
    <div className="min-w-0 space-y-2 rounded-xs border border-ink-500 bg-ink-100 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className={OBS_LABEL}>This connection runs</span>
        {c && c.supported === false && <StatusPill tone="bad">Out of support</StatusPill>}
        {c && c.supported && tone === "warn" && <StatusPill tone="warn">Newer patch</StatusPill>}
        {c && c.supported && !tone && <StatusPill tone="ok">Supported</StatusPill>}
      </div>
      <p className="text-[26px] font-semibold tabular-nums tracking-tight text-paper">
        {s.version ?? "Unknown"} {c?.lts && <span className="text-[12px] font-normal tracking-normal text-paper-faint">LTS</span>}
      </p>
      {c ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-paper-faint">Status</dt><dd className="text-paper">{versionStatusText(c)}</dd>
          {c.supported && c.expectedEnd && <><dt className="text-paper-faint">Support</dt><dd className="text-paper">{supportWindowText({ expectedEnd: c.expectedEnd })}</dd></>}
          {c.latestDate && <><dt className="text-paper-faint">Last patch</dt><dd className="text-paper">{c.latestPatch} on {formatDay(c.latestDate)}{daysSince(c.latestDate) !== null ? `, ${agoText(daysSince(c.latestDate))}` : ""}</dd></>}
          {s.release && <><dt className="text-paper-faint">Supported now</dt><dd className="text-paper">{s.release.supported.join(", ")}</dd></>}
        </dl>
      ) : (
        <p className="text-[12px] text-paper-muted">{s.enabled ? "Support data isn't available for this version right now." : "Support status and targets need release data, which is off on this server (UPGRADE_CHECK_ENABLED)."}</p>
      )}
      {s.release && (
        <p className="text-[11px] text-paper-faint">
          Release data from GitHub{s.release.hubLines.length ? " and Docker Hub" : ""}, fetched {formatAgo(s.release.fetchedAt)}{s.release.partial ? " · some newest patches couldn't be read" : ""}
        </p>
      )}
    </div>
  );
}

function TargetCard({ target: t, all, selected, last, onPick }: { target: UpgradeTarget; all: UpgradeTarget[]; selected: boolean; last: AssessmentSummary | undefined; onPick: () => void }): ReactElement {
  const tag = targetTag(t, all);
  const v = last ? checkVerdict(last.summary) : null;
  const days = daysSince(t.releasedAt);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className={cn(
        "flex min-w-0 flex-[1_1_14rem] flex-col gap-2 rounded-xs border bg-ink-100 p-3 text-left transition-colors hover:border-brand/50",
        selected ? "border-brand ring-1 ring-inset ring-brand" : "border-ink-500",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className={OBS_LABEL}>{targetKindLabel(t)}</span>
        <StatusPill tone={tag === "Recommended" ? "ok" : "muted"} dot={false}>{tag}</StatusPill>
      </span>
      <span className="text-[17px] font-semibold tracking-tight text-paper">{t.line} <span className="font-mono text-[11px] font-normal text-paper-faint">{t.patch}</span></span>
      <span className="flex flex-wrap gap-1.5">
        {v ? (
          <>
            {v.breaks > 0 && <StatusPill tone="bad" dot={false}>{v.breaks} break{v.breaks > 1 ? "s" : ""}</StatusPill>}
            {v.changes > 0 && <StatusPill tone="warn" dot={false}>{v.changes} change{v.changes > 1 ? "s" : ""}</StatusPill>}
            {v.toJudge > 0 && <StatusPill tone="muted" dot={false}>{v.toJudge} to judge</StatusPill>}
            {v.clear && <StatusPill tone="ok" dot={false}>nothing hits you</StatusPill>}
            <StatusPill tone="muted" dot={false}>{last?.summary.mode === "exact" ? "exact" : "from notes"}</StatusPill>
          </>
        ) : <span className="text-[11px] text-paper-faint">Not checked yet</span>}
      </span>
      <span className="mt-auto text-[11px] text-paper-muted">
        {t.releasedAt ? `Released ${formatDay(t.releasedAt)}${days !== null ? `, ${agoText(days)}` : ""}` : "Release date unknown"}
        <br />
        {supportWindowText(t)}
      </span>
    </button>
  );
}

function ImpactPanel({ target, status, checks, canRun }: { target: string; status: UpgradeStatus; checks: AssessmentSummary[]; canRun: boolean }): ReactElement {
  const client = useQueryClient();
  const modelId = useAiModelId();
  const connectionName = useAuthStore((st) => st.activeConnectionName) ?? "This connection";
  const canAi = useRbacStore((st) => st.hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE));
  const references = useUpgradeReferences(target);
  const { check } = useUpgradeMutations();
  const [compare, setCompare] = useState<string | null>(null);
  const [checkId, setCheckId] = useState<string | null>(null);
  const [tryQueries, setTryQueries] = useState(true);
  const aiTried = useRef(new Set<string>());

  const models = useQuery({ queryKey: ["ai-models"], queryFn: fetchAiModels, enabled: canAi && status.enabled, staleTime: 5 * 60_000, retry: false });
  const aiAvailable = canAi && status.enabled && (models.data?.length ?? 0) > 0;

  const refs = references.data ?? [];
  const chosen = compare ?? (refs[0]?.connectionId ?? (status.enabled ? NOTES_ONLY : null));
  const latest = checks.find((a) => a.targetVersion === target);
  const id = checkId ?? latest?.id ?? null;
  const assessment = useAssessment(id);
  const a = assessment.data;
  const currentLine = status.version ? lineOf(status.version) : null;

  const ai = useMutation({
    mutationFn: (assessmentId: string) => invokeAI<{ findings: number; dropped: number; model: string }>("match-upgrade-notes", { assessmentId }, { modelId }),
    onSettled: (_data, _error, assessmentId) => client.invalidateQueries({ queryKey: upgradeKeys.assessment(assessmentId) }),
    onError: (error) => log.warn("[Upgrades] Chouse AI could not read the notes", { err: error instanceof Error ? error.message : String(error) }),
  });

  const finished = a && a.status !== "running" ? a.id : null;
  useEffect(() => {
    if (!finished) return;
    void client.invalidateQueries({ queryKey: upgradeKeys.list(null).slice(0, 2) });
    void client.invalidateQueries({ queryKey: upgradeKeys.fleet() });
  }, [finished, a?.summary.ai?.at, client]);

  const notesCount = a?.summary.coverage?.notes.count ?? 0;
  const aiWanted = Boolean(a && a.status === "done" && aiAvailable && canRun && notesCount > 0 && a.summary.target.line !== currentLine);
  // Runs on its own only right after a check started here; an older check offers a button instead,
  // so opening the page never spends tokens by itself.
  useEffect(() => {
    if (!a || !aiWanted || a.id !== checkId || a.summary.ai || aiTried.current.has(a.id)) return;
    aiTried.current.add(a.id);
    ai.mutate(a.id);
    // Keyed on the check, not on the mutation object, which changes every render.
  }, [a?.id, a?.status, aiWanted, a?.summary.ai, checkId]);

  const start = async (): Promise<void> => {
    if (!chosen) return;
    try {
      const res = await check.mutateAsync({ targetVersion: target, referenceConnectionId: chosen === NOTES_ONLY ? null : chosen, tryQueries });
      setCheckId(res.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The check could not start");
    }
  };

  const mode = chosen === NOTES_ONLY ? "notes" : "exact";
  const refName = refs.find((r) => r.connectionId === chosen)?.name ?? null;
  const running = a?.status === "running" || check.isPending;
  const aiRunning = ai.isPending;

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="upgrade-compare" className="text-[11px] text-paper-muted">Compare with</label>
      <Select value={chosen ?? ""} onValueChange={setCompare} disabled={running}>
        <SelectTrigger id="upgrade-compare" className="h-8 w-64 rounded-xs text-[11px]"><SelectValue placeholder={references.isLoading ? "Looking for connections…" : "No comparison available"} /></SelectTrigger>
        <SelectContent>
          {refs.map((r) => <SelectItem key={r.connectionId} value={r.connectionId}>{r.name} · {r.version}</SelectItem>)}
          <SelectItem value={NOTES_ONLY} disabled={!status.enabled}>Release notes only{status.enabled ? "" : " (off on this server)"}</SelectItem>
        </SelectContent>
      </Select>
      {canRun && (
        <Button className={DH_PRIMARY} disabled={!chosen || running} onClick={() => void start()}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpCircle className="h-3.5 w-3.5" />} {a ? "Re-check" : "Check"}
        </Button>
      )}
    </div>
  );

  const title = `Impact · ${status.version ?? "?"} → ${target}`;

  const option = canRun ? (
    <label htmlFor="upgrade-try" className="mb-3 flex items-start gap-2 text-[12px] text-paper">
      <Checkbox id="upgrade-try" checked={tryQueries} disabled={running} onCheckedChange={(v) => setTryQueries(v === true)} className="mt-0.5" />
      <span>
        Also try my top 200 read-only query shapes with {target}&apos;s settings on this server
        <span className="block text-[11px] text-paper-muted">Plans only with EXPLAIN: nothing runs and no data is read. Finds the queries the new analyzer and changed defaults break.</span>
      </span>
    </label>
  ) : null;

  if (!refs.length && !status.enabled && !references.isLoading) {
    return (
      <Panel title={title}>
        <EmptyState title="Nothing to compare with" body={`Add a connection that runs ${lineOf(target)}, or turn on release data (UPGRADE_CHECK_ENABLED) to check from the release notes.`} />
      </Panel>
    );
  }

  if (check.isPending) {
    return <Panel title={title} actions={header}><Progress mode={mode} refName={refName} stage="release" withAi={aiAvailable} tryQueries={tryQueries} target={target} /></Panel>;
  }

  if (!a) {
    return (
      <Panel title={title} actions={header}>
        {option}
        <EmptyState
            title="Not checked yet"
            body={canRun
              ? `Checking reads this server${mode === "exact" && refName ? ` and ${refName}` : ""}${status.enabled ? ", fetches the release notes in between" : ""}, and looks at 30 days of query_log. It usually takes a few seconds.${refs.length === 0 && status.enabled ? ` For an exact comparison, add a connection that runs ${lineOf(target)}.` : ""}`
              : "Ask someone with upgrades:run to check this version."}
        />
      </Panel>
    );
  }

  if (a.status === "running") {
    return <Panel title={title} actions={header}><Progress mode={a.summary.mode} refName={a.summary.reference?.name ?? null} stage={a.summary.stage} withAi={aiAvailable} tryQueries={a.summary.tryQueries !== false} target={target} /></Panel>;
  }

  if (a.status === "failed") {
    return (
      <Panel title={title} actions={header}>
        {option}
        <div className="rounded-xs border border-red-500/40 bg-red-500/10 p-3 text-[12px] text-paper">
          <p className="font-medium">The check didn't finish</p>
          <p className="mt-1 text-paper-muted">{a.summary.error ?? "Something went wrong."}</p>
        </div>
      </Panel>
    );
  }

  const cov = a.summary.coverage;
  const counts = findingCounts(a.findings);
  const main = mainFindings(a.findings);
  const judge = notesToJudge(a.findings);
  const exact = a.summary.mode === "exact" && a.summary.reference;
  const tf = (n: [number, number] | undefined): string => (n ? `${formatCount(n[0])} → ${formatCount(n[1])}` : "");

  return (
    <Panel title={title} actions={header}>
      {option}
      {aiRunning ? (
        <Progress mode={a.summary.mode} refName={a.summary.reference?.name ?? null} stage="ai" withAi tryQueries={a.summary.tryQueries !== false} target={target} />
      ) : (
        <div className="space-y-4">
          <div className={cn("rounded-xs border p-3 text-[12px] text-paper", exact ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10")}>
            {exact ? (
              <p>
                <strong>Exact comparison</strong> with {a.summary.reference!.name} ({a.summary.reference!.version}): settings {tf(cov?.diff?.settings)} ({cov?.changedDefaults ?? 0} defaults changed, {cov?.newlyObsolete ?? 0} newly obsolete), MergeTree settings {tf(cov?.diff?.mergeTree)}, functions {tf(cov?.diff?.functions)}, {cov?.removed ?? 0} functions, types, engines and formats removed.
                {cov && cov.notes.count > 0 ? ` Plus ${cov.notes.count} breaking-change notes from ${cov.notes.lines[0]} to ${cov.notes.lines[cov.notes.lines.length - 1]}.` : ""}
              </p>
            ) : (
              <p>
                <strong>From release notes only.</strong> {cov?.notes.count ?? 0} breaking-change notes{cov?.notes.lines.length ? ` from ${cov.notes.lines[0]} to ${cov.notes.lines[cov.notes.lines.length - 1]}` : ""}. Release notes don't list most default changes (in a test of 25.8 → 26.8 they named 16 of 56). For an exact answer, compare with a connection that runs {a.summary.target.line}.
              </p>
            )}
            {cov?.notes.skipped && <p className="mt-1 text-paper-muted">{cov.notes.skipped}</p>}
            {cov && cov.notes.missingLines.length > 0 && <p className="mt-1 text-paper-muted">Notes for {cov.notes.missingLines.join(", ")} couldn't be read, so this list may be short.</p>}
            {cov && !cov.workload.readable && <p className="mt-1 text-paper-muted">query_log couldn't be read, so only the schema and profiles were checked.</p>}
            {cov?.tried && (cov.tried.readable ? (
              <p className="mt-1 text-paper-muted">
                Tried on this server: {formatCount(cov.tried.tried)} read-only query shapes planned with {a.summary.target.version}&apos;s settings{cov.tried.analyzerOnly ? " (the analyzer only: compare with a connection on the target line to also apply its changed defaults)" : ` (the analyzer and ${cov.tried.applied} changed defaults)`}. {cov.tried.skipped > 0 ? `${cov.tried.skipped} skipped because they fail today too. ` : ""}Nothing was executed.
                {cov.tried.dropped.length > 0 ? ` This server doesn't accept ${cov.tried.dropped.length} of the new values (${cov.tried.dropped.slice(0, 3).join(", ")}${cov.tried.dropped.length > 3 ? "…" : ""}), so they weren't tried.` : ""}
                {cov.tried.budgetExhausted ? " The time limit was reached before every shape was tried." : ""}
              </p>
            ) : <p className="mt-1 text-paper-muted">Your queries couldn&apos;t be tried on this server{cov.tried.error ? `: ${cov.tried.error}` : ""}.</p>)}
            {cov && cov.workload.readable && <p className="mt-1 text-paper-muted">Workload: {formatCount(cov.workload.shapes)} query shapes in query_log{cov.workload.from ? ` since ${new Date(cov.workload.from).toLocaleDateString()}` : ""}. Queries outside that window and client-side behaviour aren't seen.</p>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {counts.blocker > 0 && <StatusPill tone="bad">{counts.blocker} break{counts.blocker > 1 ? "s" : ""}</StatusPill>}
              {counts.warning > 0 && <StatusPill tone="warn">{counts.warning} behave{counts.warning > 1 ? "" : "s"} differently</StatusPill>}
              {counts.info > 0 && <StatusPill tone="info">{counts.info} heads-up</StatusPill>}
              {counts.note > 0 && <StatusPill tone="muted">{counts.note} note{counts.note > 1 ? "s" : ""} to judge</StatusPill>}
              {counts.blocker + counts.warning + counts.info + counts.note === 0 && <StatusPill tone="ok">Nothing found that this workload uses</StatusPill>}
              <span className="ml-1 text-[11px] text-paper-faint">Checked {formatAgo(a.finishedAt ?? a.createdAt)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {aiWanted && (
                <Button variant="outline" className="h-8 rounded-xs border-brand/40 text-[11px] text-brand" disabled={ai.isPending} onClick={() => ai.mutate(a.id)}>
                  <Sparkles className="mr-1.5 h-3 w-3" /> {a.summary.ai ? "Read the notes again" : ai.isError ? "Try Chouse AI again" : "Read the notes with Chouse AI"}
                </Button>
              )}
              <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => void copyText(checkMarkdown(a, connectionName), "Report")}><Copy className="mr-1.5 h-3 w-3" /> Copy as Markdown</Button>
            </div>
          </div>

          {ai.isError && <p className="text-[12px] text-red-500">Chouse AI couldn't read the notes: {ai.error instanceof Error ? ai.error.message : "unknown error"}. The findings below are CHouse's own.</p>}
          {a.summary.ai && <p className="flex items-center gap-1.5 text-[11px] text-paper-faint"><Sparkles className="h-3 w-3 text-brand" aria-hidden />Chouse AI ({a.summary.ai.model}) read the notes {formatAgo(a.summary.ai.at)}.{a.summary.ai.dropped > 0 ? ` ${a.summary.ai.dropped} of its answers were dropped because their citations didn't check out.` : ""}</p>}
          {!aiAvailable && cov && cov.notes.count > 0 && judge.length > 0 && <p className="text-[11px] text-paper-faint">Chouse AI isn't set up for you, so CHouse lists the notes that name what you use and leaves the judging to you.</p>}
          {a.hiddenRows > 0 && <p className="text-[11px] text-paper-faint">{a.hiddenRows} evidence rows are on tables you don't have access to.</p>}

          {main.length > 0 && (
            <div className="space-y-2">
              {main.map((f, i) => <UpgradeFinding key={f.id} finding={f} defaultOpen={i === 0 && f.severity === "blocker"} />)}
            </div>
          )}

          {judge.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-paper">Release notes that name what you use, for a person to judge</h3>
                {cov && cov.generalNotes > 0 && <span className="text-[11px] text-paper-faint">{cov.generalNotes} more name only common types and engines</span>}
              </div>
              <ul className="divide-y divide-ink-500/60 rounded-xs border border-ink-500 bg-ink-100">
                {judge.map((f) => {
                  const n = f.evidence.source.notes?.[0];
                  return (
                    <li key={f.id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] gap-3 px-3 py-2.5">
                      <span className="pt-0.5 font-mono text-[11px] text-paper-faint">{n?.line}</span>
                      <span className="min-w-0"><span className="block text-[12px] text-paper">{f.title}</span><span className="block text-[11px] text-paper-muted">{f.detail}</span></span>
                      {n?.prs[0] ? <a className="text-[11px] text-brand hover:underline" href={`https://github.com/ClickHouse/ClickHouse/pull/${n.prs[0]}`} target="_blank" rel="noreferrer">#{n.prs[0]}</a> : <span />}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Progress({ mode, refName, stage, withAi, tryQueries, target }: { mode: "exact" | "notes"; refName: string | null; stage: Parameters<typeof stepState>[1]; withAi: boolean; tryQueries: boolean; target: string }): ReactElement {
  return (
    <ol className="space-y-1.5 rounded-xs border border-ink-500 bg-ink-100 p-3 text-[12px]" aria-label="Check progress">
      {checkSteps(mode, refName, withAi, tryQueries, target).map((step) => {
        const st = stepState(step.key, stage);
        return (
          <li key={step.key} className={cn("flex items-center gap-2.5", st < 0 ? "text-paper-faint" : "text-paper")}>
            {st > 0 ? <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> : st === 0 ? <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand" aria-hidden /> : <span className="inline-block h-3.5 w-3.5 text-center" aria-hidden>·</span>}
            {step.key === "ai" && <Sparkles className="h-3 w-3 text-brand" aria-hidden />}
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
