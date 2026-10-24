/**
 * The agent editor's Evals tab (ADR 0024 §Phase 6): test cases the agent
 * should pass, a run that scores the current draft, and the threshold that
 * gates saving it.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { CheckCircle2, FlaskConical, Pencil, Play, Plus, Trash2, XCircle } from "lucide-react";

import type { AgentInput, AiRegistry } from "@/api/aiAgents";
import type { EvalCase, EvalCaseInput, EvalRun } from "@/api/aiEvals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, Field, INPUT_CLASS, ProblemList, TEXTAREA_CLASS } from "@/features/agents/assistant/shared";
import { formatTokens, formatUsd } from "@/features/agents/usage/lib";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { formatAgo } from "@/features/observe/lib";
import { DataTable, EmptyState, LoadingGrid, Mono, StatusPill } from "@/features/observe/ui";
import { useAgentEvals, useEvalGate, useEvalMutations, useEvalRun } from "./hooks";
import { caseProblems, caseSummary, isRunning, parseToolList, percent, thresholdFromPercent } from "./lib";

function CaseEditor({ agentId, test, registry, featureAgent, onClose }: {
  agentId: string;
  test: EvalCase | null;
  registry: AiRegistry;
  featureAgent: boolean;
  onClose: () => void;
}): ReactElement {
  const { create, update } = useEvalMutations();
  const features = registry.features.filter((f) => f.delivery === "structured");
  const [name, setName] = useState(test?.name ?? "");
  const [kind] = useState<"chat" | "feature">(test?.kind ?? (featureAgent ? "feature" : "chat"));
  const [featureId, setFeatureId] = useState<string | null>(test?.featureId ?? features.find((f) => f.agentId === agentId)?.id ?? null);
  const [message, setMessage] = useState(test && test.kind === "chat" ? caseSummary(test) : "");
  const [inputText, setInputText] = useState(test && test.kind === "feature" ? JSON.stringify(test.input, null, 2) : "{}");
  const [tools, setTools] = useState((test?.expectedTools ?? []).join(", "));
  const [rubric, setRubric] = useState(test?.rubric ?? "");
  const [showProblems, setShowProblems] = useState(false);
  const problems = caseProblems({ name, kind, message, inputText, featureId });
  const busy = create.isPending || update.isPending;

  const save = async (): Promise<void> => {
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    const input: EvalCaseInput = {
      name: name.trim(),
      kind,
      featureId: kind === "feature" ? featureId : null,
      input: kind === "chat" ? { messages: [{ role: "user", content: message.trim() }] } : JSON.parse(inputText) as Record<string, unknown>,
      expectedTools: parseToolList(tools),
      rubric: rubric.trim() || null,
    };
    try {
      if (test) await update.mutateAsync({ id: test.id, input });
      else await create.mutateAsync({ agentId, input });
      toast.success(test ? "Test case saved" : "Test case added");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the test case"));
    }
  };

  return (
    <div className="space-y-3 rounded-xs border border-ink-500 p-3">
      <Field label="Name" htmlFor="eval-case-name">
        <Input id="eval-case-name" className={INPUT_CLASS} value={name} onChange={(e) => setName(e.target.value)} placeholder="Counts tables in a database" />
      </Field>
      {kind === "chat" ? (
        <Field label="Message" htmlFor="eval-case-message" hint="What the user asks.">
          <Textarea id="eval-case-message" className={`${TEXTAREA_CLASS} min-h-[72px] font-sans`} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="How many tables does the sales database have?" />
        </Field>
      ) : (
        <>
          <Field label="Feature">
            <Select value={featureId ?? ""} onValueChange={setFeatureId}>
              <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Feature"><SelectValue placeholder="Pick a feature" /></SelectTrigger>
              <SelectContent>{features.map((f) => <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Feature input (JSON)" htmlFor="eval-case-input">
            <Textarea id="eval-case-input" className={TEXTAREA_CLASS} value={inputText} onChange={(e) => setInputText(e.target.value)} spellCheck={false} />
          </Field>
        </>
      )}
      <Field label="Expected tools" htmlFor="eval-case-tools" hint="Called in this order; other calls may come between. Empty: any tools.">
        <Input id="eval-case-tools" className={`${INPUT_CLASS} font-mono`} value={tools} onChange={(e) => setTools(e.target.value)} placeholder="list_tables, run_select_query" />
      </Field>
      <Field label="Rubric" htmlFor="eval-case-rubric" hint="What a good answer does; a judge model checks it. Empty: no judge.">
        <Textarea id="eval-case-rubric" className={`${TEXTAREA_CLASS} min-h-[60px] font-sans`} value={rubric} onChange={(e) => setRubric(e.target.value)} placeholder="Gives the number of tables and names the database." />
      </Field>
      {showProblems && <ProblemList problems={problems} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" className="h-8 rounded-xs text-[11px]" onClick={onClose}>Cancel</Button>
        <Button type="button" className={`${DH_PRIMARY} h-8`} disabled={busy} onClick={() => void save()}>{test ? "Save case" : "Add case"}</Button>
      </div>
    </div>
  );
}

function ResultPill({ passed }: { passed: boolean }): ReactElement {
  return passed
    ? <StatusPill tone="ok"><CheckCircle2 className="h-3 w-3" aria-hidden /> Pass</StatusPill>
    : <StatusPill tone="bad"><XCircle className="h-3 w-3" aria-hidden /> Fail</StatusPill>;
}

function RunResults({ run }: { run: EvalRun }): ReactElement {
  if (isRunning(run)) {
    return <p role="status" className="text-[12px] text-paper-muted">Running {run.total} case{run.total === 1 ? "" : "s"} against this draft… (started {formatAgo(run.startedAt)})</p>;
  }
  if (run.status === "failed") return <p role="alert" className="text-[12px] text-red-400">{run.error ?? "The eval run failed."}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <span className="text-[13px] font-semibold text-paper">{percent(run.score)} passed</span>
        <span className="text-paper-muted">{run.passed} of {run.total} · {formatTokens(run.tokens)} tokens{run.costUsd !== null ? ` · ${formatUsd(run.costUsd)}` : ""} · {formatAgo(run.finishedAt ?? run.startedAt)}</span>
      </div>
      {run.regressions.length > 0 && (
        <p role="alert" className="rounded-xs border border-red-500/30 bg-red-500/5 p-2 text-[12px] text-red-400">
          Regressions (passed in the previous run): {run.regressions.map((r) => r.name).join(", ")}
        </p>
      )}
      <DataTable label="Eval results" head={["Case", "Result", "Tools", "Judge", "Answer"]}>
        {run.results.map((r) => (
          <tr key={r.caseId}>
            <td className="max-w-[180px] text-[12px] text-paper">{r.name}</td>
            <td><ResultPill passed={r.passed} /></td>
            <td className="max-w-[200px] text-[11px] text-paper-muted">
              {r.toolsOk === null ? "—" : r.toolsOk ? "In order" : <span className="text-red-400">Missing <Mono>{r.missingTools.join(", ")}</Mono></span>}
            </td>
            <td className="max-w-[220px] text-[11px] text-paper-muted">{r.judge ? <span className={r.judge.pass ? undefined : "text-red-400"}>{r.judge.reason || (r.judge.pass ? "Meets the rubric" : "Misses the rubric")}</span> : "—"}</td>
            <td className="max-w-[260px]"><span className="line-clamp-2 text-[11px] text-paper-faint">{r.error ? <span className="text-red-400">{r.error}</span> : r.answer || "—"}</span></td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

export function EvalsTab({ agentId, draft, registry, readOnly, onThreshold }: {
  /** The stored agent; null while it is new. */
  agentId: string | null;
  draft: AgentInput;
  registry: AiRegistry;
  readOnly: boolean;
  onThreshold: (threshold: number | null) => void;
}): ReactElement {
  const evals = useAgentEvals(agentId);
  const { remove, run } = useEvalMutations();
  const [editing, setEditing] = useState<EvalCase | "new" | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const latestId = runId ?? evals.data?.runs[0]?.id ?? null;
  const current = useEvalRun(latestId);
  const threshold = draft.tuning.evalThreshold ?? null;
  const [thresholdText, setThresholdText] = useState(threshold === null ? "" : String(Math.round(threshold * 100)));
  const cases = evals.data?.cases ?? [];
  const gate = useEvalGate(agentId, draft, threshold !== null && cases.length > 0 && !isRunning(current.data));
  const featureAgent = draft.taskTemplate !== null;

  if (!agentId) return <EmptyState icon={FlaskConical} title="Save the agent first" body="Test cases belong to a saved agent. Save it, then add the cases it should pass." />;

  const changeThreshold = (text: string): void => {
    setThresholdText(text);
    const parsed = thresholdFromPercent(text);
    if (parsed !== "invalid") onThreshold(parsed);
  };

  const start = async (): Promise<void> => {
    try {
      const started = await run.mutateAsync({ agentId, draft });
      setRunId(started.id);
    } catch (error) {
      toast.error(errorMessage(error, "Could not start the evals"));
    }
  };

  const destroy = async (test: EvalCase): Promise<void> => {
    try {
      await remove.mutateAsync(test.id);
      toast.success("Test case deleted");
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete the test case"));
    }
  };

  const lastResult = (caseId: string): boolean | null => current.data?.results.find((r) => r.caseId === caseId)?.passed ?? null;
  const running = isRunning(current.data) || run.isPending;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[200px_1fr] md:items-end">
        <Field label="Eval threshold, %" htmlFor="eval-threshold" hint={thresholdFromPercent(thresholdText) === "invalid" ? "Between 1 and 100, or empty." : "Empty: saving needs no eval run."}>
          <Input id="eval-threshold" type="number" min={1} max={100} className={INPUT_CLASS} value={thresholdText} onChange={(e) => changeThreshold(e.target.value)} placeholder="No gate" disabled={readOnly} />
        </Field>
        {gate.data?.required && (
          <p role="status" className={`rounded-xs border p-2 text-[12px] ${gate.data.passing ? "border-emerald-400/40 bg-emerald-500/5 text-emerald-500" : "border-amber-500/40 bg-amber-500/5 text-amber-500"}`}>
            {gate.data.passing
              ? `This draft passed ${percent(gate.data.run?.score)} of its evals: it can be saved.`
              : gate.data.run
                ? `This draft passed ${percent(gate.data.run.score)}; saving needs ${percent(threshold)}. Fix the failing cases or lower the threshold.`
                : `Saving needs ${percent(threshold)} of ${gate.data.cases} case${gate.data.cases === 1 ? "" : "s"} to pass: run the evals for this draft.`}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Test cases {evals.data ? `(${cases.length} of ${evals.data.maxCases})` : ""}</h4>
        <div className="flex gap-2">
          {!readOnly && (
            <Button variant="outline" className="h-8 rounded-xs text-[11px]" disabled={editing !== null || cases.length >= (evals.data?.maxCases ?? 50)} onClick={() => setEditing("new")}>
              <Plus className="mr-1 h-3 w-3" /> Add case
            </Button>
          )}
          <Button className={DH_PRIMARY} disabled={readOnly || cases.length === 0 || running} onClick={() => void start()}>
            <Play className="h-3.5 w-3.5" /> {running ? "Running…" : "Run evals on this draft"}
          </Button>
        </div>
      </div>

      {editing && <CaseEditor key={editing === "new" ? "new" : editing.id} agentId={agentId} test={editing === "new" ? null : editing} registry={registry} featureAgent={featureAgent} onClose={() => setEditing(null)} />}

      {evals.isLoading ? <LoadingGrid count={1} /> : cases.length === 0 ? (
        editing === null && <EmptyState icon={FlaskConical} title="No test cases yet" body="Add the questions this agent must keep answering well, or save one from the Test tab or from a chat request in AI activity." />
      ) : (
        <DataTable label="Test cases" head={["Case", "Asks", "Expects", "Rubric", "Last run", ""]}>
          {cases.map((c) => {
            const last = lastResult(c.id);
            return (
              <tr key={c.id}>
                <td className="max-w-[180px]">
                  <span className="block text-[12px] text-paper">{c.name}</span>
                  <span className="block text-[10px] text-paper-faint">{c.kind === "chat" ? "Chat" : registry.features.find((f) => f.id === c.featureId)?.title ?? c.featureId}{c.source !== "manual" ? ` · from ${c.source === "console" ? "the test console" : "AI activity"}` : ""}</span>
                </td>
                <td className="max-w-[260px]"><span className="line-clamp-2 text-[11px] text-paper-muted">{caseSummary(c)}</span></td>
                <td className="max-w-[180px] font-mono text-[10px] text-paper-muted">{c.expectedTools.join(" → ") || "—"}</td>
                <td className="text-[11px] text-paper-muted">{c.rubric ? "Yes" : "—"}</td>
                <td>{last === null ? <span className="text-[11px] text-paper-faint">—</span> : <ResultPill passed={last} />}</td>
                <td className="whitespace-nowrap text-right">
                  {!readOnly && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" className="h-7 rounded-xs px-2" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" className="h-7 rounded-xs px-2 text-red-400 hover:text-red-300" disabled={remove.isPending} onClick={() => void destroy(c)} aria-label={`Delete ${c.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      {current.data && (
        <div className="space-y-2 border-t border-ink-500 pt-4">
          <h4 className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{runId ? "This run" : "Latest run"}</h4>
          <RunResults run={current.data} />
        </div>
      )}
    </div>
  );
}
