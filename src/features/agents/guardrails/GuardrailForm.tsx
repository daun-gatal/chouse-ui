/**
 * Form sections for a guardrail, shared by the editor sheet and the
 * "New guardrail" dialog: basics, the kind's settings, stages/action/scope,
 * and a live test on sample text.
 */

import { useState, type ReactElement } from "react";
import { FlaskConical, Loader2, Plus, Trash2 } from "lucide-react";

import type { GuardrailCatalog, GuardrailInput, GuardrailStage, RedactStrategy } from "@/api/aiGuardrails";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/features/observe/ui";
import { useModelOptions } from "../assistant/hooks";
import { errorMessage, Field, INPUT_CLASS, SWITCH_CLASS, TEXTAREA_CLASS } from "../assistant/shared";
import { useGuardrailTest } from "./hooks";
import { ACTION_HINTS, allowedActions, kindStages, linesOf, listOf, STAGE_LABELS, withStages } from "./lib";

export interface SectionProps {
  value: GuardrailInput;
  onChange: (next: GuardrailInput) => void;
  catalog: GuardrailCatalog;
  readOnly?: boolean;
}

const CHIP = "rounded-xs border px-2 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand disabled:opacity-50";

function Chip({ on, onClick, children, disabled, label }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean; label?: string }): ReactElement {
  return (
    <button type="button" aria-pressed={on} aria-label={label} disabled={disabled} onClick={onClick}
      className={cn(CHIP, on ? "border-brand bg-brand/10 text-brand" : "border-ink-500 text-paper-muted hover:text-paper")}>
      {children}
    </button>
  );
}

function config<T>(value: GuardrailInput, key: string, fallback: T): T {
  const v = value.config[key];
  return (v === undefined ? fallback : v) as T;
}

function numberOrNull(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function BasicsSection({ value, onChange, readOnly }: SectionProps): ReactElement {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" htmlFor="guardrail-name">
        <Input id="guardrail-name" value={value.name} disabled={readOnly} maxLength={100} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="Employee IDs" className={INPUT_CLASS} />
      </Field>
      <Field label="Slug" htmlFor="guardrail-slug" hint="Lowercase letters, digits and dashes.">
        <Input id="guardrail-slug" value={value.slug} disabled={readOnly} maxLength={63} onChange={(e) => onChange({ ...value, slug: e.target.value })} placeholder="employee-ids" className={cn(INPUT_CLASS, "font-mono")} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Description" htmlFor="guardrail-description">
          <Input id="guardrail-description" value={value.description} disabled={readOnly} maxLength={1000} onChange={(e) => onChange({ ...value, description: e.target.value })} placeholder="What it protects and why" className={INPUT_CLASS} />
        </Field>
      </div>
    </div>
  );
}

function StrategyField({ value, onChange, catalog, readOnly }: SectionProps): ReactElement {
  const labels: Record<RedactStrategy, string> = { placeholder: "Placeholder · [EMAIL]", mask: "Mask · da•••", hash: "Hash · [EMAIL:3f9a…], same value same hash" };
  return (
    <Field label="Replace matches with">
      <Select value={config(value, "strategy", "placeholder")} disabled={readOnly} onValueChange={(v) => onChange({ ...value, config: { ...value.config, strategy: v } })}>
        <SelectTrigger className={INPUT_CLASS} aria-label="Redaction strategy"><SelectValue /></SelectTrigger>
        <SelectContent>{catalog.strategies.map((s) => <SelectItem key={s} value={s}>{labels[s]}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
}

function LinesField({ label, hint, value, onChange, keyName, readOnly, placeholder }: SectionProps & { label: string; hint?: string; keyName: string; placeholder: string }): ReactElement {
  const [text, setText] = useState(() => linesOf(value.config[keyName]));
  return (
    <Field label={label} hint={hint ?? "One per line."} htmlFor={`guardrail-${keyName}`}>
      <Textarea id={`guardrail-${keyName}`} value={text} disabled={readOnly} placeholder={placeholder} className={cn(TEXTAREA_CLASS, "min-h-[90px]")}
        onChange={(e) => { setText(e.target.value); onChange({ ...value, config: { ...value.config, [keyName]: listOf(e.target.value) } }); }} />
    </Field>
  );
}

interface PatternRow { label: string; regex: string; caseInsensitive: boolean }

function PatternFields(props: SectionProps): ReactElement {
  const { value, onChange, catalog, readOnly } = props;
  const detectors = config<string[]>(value, "detectors", []);
  const patterns = config<PatternRow[]>(value, "patterns", []);
  const setConfig = (patch: Record<string, unknown>): void => onChange({ ...value, config: { ...value.config, ...patch } });
  const toggle = (id: string): void => setConfig({ detectors: detectors.includes(id) ? detectors.filter((d) => d !== id) : [...detectors, id] });
  const setPattern = (i: number, patch: Partial<PatternRow>): void => setConfig({ patterns: patterns.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <div className="space-y-3">
      {(["pii", "secret"] as const).map((group) => (
        <Field key={group} label={group === "pii" ? "Built-in detectors · personal data" : "Built-in detectors · secrets"} hint={group === "pii" ? "Use these instead of writing your own pattern for common personal data." : undefined}>
          <div className="flex flex-wrap gap-1.5">
            {catalog.detectors.filter((d) => d.group === group).map((d) => (
              <Chip key={d.id} on={detectors.includes(d.id)} disabled={readOnly} onClick={() => toggle(d.id)} label={d.label}>{d.label}</Chip>
            ))}
          </div>
        </Field>
      ))}
      <Field label="Your patterns" hint="JavaScript regexes. Patterns with nested repeats like (a+)+ are refused: they can stall every run.">
        <div className="space-y-2">
          {patterns.map((p, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] items-center gap-2">
              <Input aria-label={`Pattern ${i + 1} label`} value={p.label} disabled={readOnly} placeholder="Employee ID" onChange={(e) => setPattern(i, { label: e.target.value })} className={INPUT_CLASS} />
              <Input aria-label={`Pattern ${i + 1} regex`} value={p.regex} disabled={readOnly} placeholder="EMP-\d{6}" onChange={(e) => setPattern(i, { regex: e.target.value })} className={cn(INPUT_CLASS, "font-mono")} />
              <label className="flex items-center gap-1.5 text-[11px] text-paper-muted">
                <Checkbox checked={p.caseInsensitive} disabled={readOnly} onCheckedChange={(c) => setPattern(i, { caseInsensitive: c === true })} /> Aa
              </label>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={readOnly} aria-label={`Remove pattern ${i + 1}`} onClick={() => setConfig({ patterns: patterns.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          {!readOnly && patterns.length < 20 && (
            <Button type="button" variant="outline" className="h-7 rounded-xs text-[11px]" onClick={() => setConfig({ patterns: [...patterns, { label: "", regex: "", caseInsensitive: false }] })}><Plus className="mr-1 h-3 w-3" /> Add pattern</Button>
          )}
        </div>
      </Field>
      <StrategyField {...props} />
    </div>
  );
}

function NumberField({ label, hint, value, onChange, keyName, readOnly, placeholder }: SectionProps & { label: string; hint?: string; keyName: string; placeholder: string }): ReactElement {
  const current = value.config[keyName];
  return (
    <Field label={label} hint={hint} htmlFor={`guardrail-${keyName}`}>
      <Input id={`guardrail-${keyName}`} type="number" min={1} value={typeof current === "number" ? String(current) : ""} disabled={readOnly} placeholder={placeholder}
        onChange={(e) => onChange({ ...value, config: { ...value.config, [keyName]: numberOrNull(e.target.value) } })} className={INPUT_CLASS} />
    </Field>
  );
}

function SwitchField({ label, value, onChange, keyName, readOnly }: SectionProps & { label: string; keyName: string }): ReactElement {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xs border border-ink-500 px-3 py-2 text-[12px] text-paper">
      {label}
      <Switch className={SWITCH_CLASS} checked={config(value, keyName, false)} disabled={readOnly} onCheckedChange={(c) => onChange({ ...value, config: { ...value.config, [keyName]: c } })} aria-label={label} />
    </label>
  );
}

function JudgeFields(props: SectionProps): ReactElement {
  const { value, onChange, readOnly } = props;
  const models = useModelOptions();
  return (
    <div className="space-y-3">
      <Field label="Rule" hint="Describe what breaks the rule in one plain sentence. A small model checks each message against it." htmlFor="guardrail-rule">
        <Textarea id="guardrail-rule" value={config(value, "rule", "")} disabled={readOnly} className={cn(TEXTAREA_CLASS, "min-h-[80px] font-sans")}
          onChange={(e) => onChange({ ...value, config: { ...value.config, rule: e.target.value } })} />
      </Field>
      <Field label="Judge model" hint="Required. A fast, cheap model is enough; each check adds a model call and its tokens show in AI activity.">
        <Select value={config<string | null>(value, "modelConfigId", null) ?? ""} disabled={readOnly} onValueChange={(v) => onChange({ ...value, config: { ...value.config, modelConfigId: v } })}>
          <SelectTrigger className={INPUT_CLASS} aria-label="Judge model"><SelectValue placeholder="Choose a model" /></SelectTrigger>
          <SelectContent>{(models.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
    </div>
  );
}

export function ConfigSection(props: SectionProps): ReactElement {
  const { value, onChange, readOnly } = props;
  switch (value.kind) {
    case "pattern":
      return <PatternFields {...props} />;
    case "keywords":
      return <div className="space-y-3"><LinesField {...props} label="Terms" keyName="terms" placeholder={"project falcon\nacquisition"} hint="Whole words, case-insensitive. One per line." /><StrategyField {...props} /></div>;
    case "columns":
      return <div className="space-y-3"><LinesField {...props} label="Columns" keyName="columns" placeholder={"users.email\n*_ssn"} hint="Column names or globs. Results rarely say the table, so users.email also matches a bare email column." /><StrategyField {...props} /></div>;
    case "injection":
      return <LinesField {...props} label="Extra phrases" keyName="extraPhrases" placeholder="act as the database owner" hint="Added to the built-in list of instruction-like phrases. One per line." />;
    case "sql":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <SwitchField {...props} label="Read-only SELECT only" keyName="readOnly" />
          <SwitchField {...props} label="Row-returning SELECTs need a LIMIT" keyName="requireLimit" />
          <LinesField {...props} label="Denied databases" keyName="denyDatabases" placeholder="secrets" />
          <LinesField {...props} label="Denied tables" keyName="denyTables" placeholder="default.salaries" />
          <NumberField {...props} label="Max estimated rows" keyName="maxEstimatedRows" placeholder="No estimate" hint="EXPLAIN ESTIMATE before the query runs, for tools on your connection." />
        </div>
      );
    case "tool":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tool" htmlFor="guardrail-tool" hint="The tool's name, as in the Assistant › Tools catalog.">
            <Input id="guardrail-tool" value={config(value, "tool", "")} disabled={readOnly} placeholder="kill_query" className={cn(INPUT_CLASS, "font-mono")} onChange={(e) => onChange({ ...value, config: { ...value.config, tool: e.target.value } })} />
          </Field>
          <Field label="Rule">
            <Select value={config<string>(value, "rule", "deny")} disabled={readOnly} onValueChange={(v) => onChange({ ...value, config: { ...value.config, rule: v } })}>
              <SelectTrigger className={INPUT_CLASS} aria-label="Tool rule"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="deny">Never allow</SelectItem>
                <SelectItem value="max_calls">At most N calls per run</SelectItem>
                <SelectItem value="permission">Only for users with a permission</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {config<string>(value, "rule", "deny") === "max_calls" && <NumberField {...props} label="Calls per run" keyName="maxCalls" placeholder="1" />}
          {config<string>(value, "rule", "deny") === "permission" && (
            <Field label="Permission" htmlFor="guardrail-permission">
              <Input id="guardrail-permission" value={config<string | null>(value, "permission", null) ?? ""} disabled={readOnly} placeholder="live_queries:kill" className={cn(INPUT_CLASS, "font-mono")}
                onChange={(e) => onChange({ ...value, config: { ...value.config, permission: e.target.value.trim() || null } })} />
            </Field>
          )}
        </div>
      );
    case "limits":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField {...props} label="Tool calls per run" keyName="maxToolCalls" placeholder="No limit" hint="Tool calls stage." />
          <NumberField {...props} label="Model calls per run" keyName="maxModelCalls" placeholder="No limit" hint="Tool calls stage." />
          <NumberField {...props} label="Rows per tool result" keyName="maxResultRows" placeholder="No limit" hint="Tool results stage." />
          <NumberField {...props} label="Bytes per tool result" keyName="maxResultBytes" placeholder="No limit" hint="Tool results stage; at least 1024." />
        </div>
      );
    case "judge":
      return <JudgeFields {...props} />;
  }
}

function Multi({ label, all, options, chosen, onChange, readOnly }: { label: string; all: string; options: Array<{ id: string; name: string }>; chosen: "all" | string[]; onChange: (next: "all" | string[]) => void; readOnly?: boolean }): ReactElement {
  const selected = chosen === "all" ? [] : chosen;
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1.5">
        <Chip on={chosen === "all"} disabled={readOnly} onClick={() => onChange("all")}>{all}</Chip>
        {options.map((o) => (
          <Chip key={o.id} on={selected.includes(o.id)} disabled={readOnly}
            onClick={() => onChange(selected.includes(o.id) ? (selected.length === 1 ? "all" : selected.filter((s) => s !== o.id)) : [...selected, o.id])}>{o.name}</Chip>
        ))}
      </div>
    </Field>
  );
}

export function ScopeSection({ value, onChange, catalog, readOnly }: SectionProps): ReactElement {
  const info = catalog.kinds[value.kind];
  const stages = kindStages(info);
  const actions = allowedActions(info, value.stages);
  const mcpPossible = value.stages.includes("tool_result") && value.kind !== "judge";
  const toggleStage = (stage: GuardrailStage): void => {
    const next = value.stages.includes(stage) ? value.stages.filter((s) => s !== stage) : [...value.stages, stage];
    onChange(withStages(value, info, next));
  };
  return (
    <div className="space-y-4">
      <Field label="Runs on" hint={value.stages.length === 0 ? "Choose at least one stage." : undefined}>
        <div className="flex flex-wrap gap-1.5">{stages.map((s) => <Chip key={s} on={value.stages.includes(s)} disabled={readOnly} onClick={() => toggleStage(s)}>{STAGE_LABELS[s]}</Chip>)}</div>
      </Field>
      <Field label="When it matches" hint={ACTION_HINTS[value.action]}>
        <div className="flex flex-wrap gap-1.5">{actions.map((a) => <Chip key={a} on={value.action === a} disabled={readOnly} onClick={() => onChange({ ...value, action: a })}>{a}</Chip>)}</div>
      </Field>
      <Multi label="Agents" all="Every agent and subagent" options={catalog.agents.map((a) => ({ id: a.id, name: a.name }))} chosen={value.scope.agents} readOnly={readOnly}
        onChange={(agents) => onChange({ ...value, scope: { ...value.scope, agents } })} />
      <Multi label="AI features" all="Every feature and the chat" options={catalog.features.map((f) => ({ id: f.id, name: f.title }))} chosen={value.scope.features} readOnly={readOnly}
        onChange={(features) => onChange({ ...value, scope: { ...value.scope, features } })} />
      <label className={cn("flex items-center justify-between gap-3 rounded-xs border border-ink-500 px-3 py-2 text-[12px]", mcpPossible ? "text-paper" : "text-paper-faint")}>
        <span>Also apply to MCP tool results<span className="block text-[11px] text-paper-faint">{mcpPossible ? "External agents get the same treatment before the client sees a result." : "Needs the tool results stage; AI judges cannot apply to MCP."}</span></span>
        <Switch className={SWITCH_CLASS} checked={value.scope.mcp} disabled={readOnly || !mcpPossible} onCheckedChange={(c) => onChange({ ...value, scope: { ...value.scope, mcp: c } })} aria-label="Apply to MCP tool results" />
      </label>
    </div>
  );
}

const SAMPLES: Record<GuardrailStage, string> = {
  input: "Customer dana.lee@acme.io paid with 4242 4242 4242 4242",
  tool_call: "",
  tool_result: JSON.stringify([{ id: 91, owner: "dana.lee@acme.io", note: "EMP-204518" }], null, 1),
  output: "Write to dana.lee@acme.io about the refund.",
};

/** Run the guardrail on sample text. Nothing is stored and nothing reaches a model, except an AI judge's own check. */
export function TestSection({ value }: { value: GuardrailInput }): ReactElement {
  const [stage, setStage] = useState<GuardrailStage>(value.stages[0] ?? "tool_result");
  const [text, setText] = useState(SAMPLES[stage]);
  const [tool, setTool] = useState("run_select_query");
  const [args, setArgs] = useState('{"sql": "SELECT * FROM default.events"}');
  const test = useGuardrailTest();
  const activeStage = value.stages.includes(stage) ? stage : value.stages[0];
  const run = (): void => {
    if (!activeStage) return;
    let parsedArgs: Record<string, unknown> | undefined;
    if (activeStage === "tool_call") {
      try {
        parsedArgs = JSON.parse(args) as Record<string, unknown>;
      } catch {
        test.reset();
        return;
      }
    }
    test.mutate({ guardrail: value, stage: activeStage, text, tool, args: parsedArgs });
  };
  const argsInvalid = activeStage === "tool_call" && (() => { try { JSON.parse(args); return false; } catch { return true; } })();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {value.stages.map((s) => <Chip key={s} on={activeStage === s} onClick={() => { setStage(s); setText(SAMPLES[s]); test.reset(); }}>{STAGE_LABELS[s]}</Chip>)}
      </div>
      {activeStage === "tool_call" ? (
        <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
          <Input aria-label="Tool name" value={tool} onChange={(e) => setTool(e.target.value)} className={cn(INPUT_CLASS, "font-mono")} />
          <Input aria-label="Tool arguments (JSON)" value={args} onChange={(e) => setArgs(e.target.value)} className={cn(INPUT_CLASS, "font-mono")} />
          {argsInvalid && <p className="text-[11px] text-red-400 sm:col-span-2">The arguments must be a JSON object.</p>}
        </div>
      ) : (
        <Textarea aria-label="Sample text" value={text} onChange={(e) => setText(e.target.value)} className={cn(TEXTAREA_CLASS, "min-h-[90px]")} />
      )}
      <Button type="button" variant="outline" className="h-8 rounded-xs text-[11px]" disabled={!activeStage || test.isPending || argsInvalid} onClick={run}>
        {test.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="mr-1 h-3.5 w-3.5" />} Try it
      </Button>
      {test.isError && <p role="alert" className="text-[12px] text-red-400">{errorMessage(test.error, "The test failed")}</p>}
      {test.data && (
        <div className="space-y-1.5 rounded-xs border border-ink-500 bg-ink-200/30 p-3">
          <div className="flex items-center gap-2 text-[11px] text-paper-muted">
            <StatusPill tone={test.data.outcome === "blocked" ? "bad" : test.data.outcome === "matched" ? "brand" : "muted"} dot={false}>{test.data.outcome === "no-match" ? "no match" : test.data.outcome}</StatusPill>
            {test.data.events.map((e, i) => <span key={i}>{e.reason}</span>)}
          </div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-paper-faint">{activeStage === "tool_call" ? "Notes for the model" : "What the model sees"}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-paper">{test.data.output || "(nothing)"}</pre>
        </div>
      )}
    </div>
  );
}
