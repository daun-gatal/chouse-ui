/**
 * Agent editor (ADR 0019 §12): prompt and task templates with a variable
 * palette, tools, skills (on demand or pinned), subagents, harness, model and
 * tuning — plus a rendered preview, a draft test run and the revision history.
 * Viewing needs ai_agents:view; saving needs ai_agents:manage.
 */

import { useMemo, useRef, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Copy, Eye, RotateCcw, Save, Search, Trash2 } from "lucide-react";

import type { AgentInput, AgentSkillLink, AiAgent, AiRegistry, DraftResult, PromptPreview } from "@/api/aiAgents";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { Mono, StatusPill } from "@/features/observe/ui";
import { AiDraftBanner, RefineWithAi, SaveWarning, SectionMark, SectionReview, useAiDraftSession, useSaveGuard, type DraftOrigin } from "./DraftWithAi";
import { useAssistantMutations, useModelOptions, usePromptPreview } from "./hooks";
import { agentSubtree, duplicateAgent, featuresBoundTo, groupTools, insertAt, problemsFor, variablesFor } from "./lib";
import { RevisionHistory } from "./RevisionHistory";
import { ApprovalBadge, ContextBadge, errorMessage, Field, INPUT_CLASS, OriginBadge, ProblemList, SWITCH_CLASS, TAB_CLASS, TEXTAREA_CLASS } from "./shared";
import { TestConsole } from "./TestConsole";

const DEFAULT_MODEL = "__default__";
const NO_FALLBACK = "__none__";
const OFF = "off";

export interface AgentEditorTarget {
  /** The stored agent being edited; null for a new agent. */
  agent: AiAgent | null;
  initial: AgentInput;
  /** Feature the editor was opened from (preview + test default). */
  featureId?: string;
  /** A Draft with AI result under review. */
  aiDraft?: DraftResult<AgentInput>;
  /** What the AI draft was started from (kept for redrafts and refinements). */
  origin?: DraftOrigin;
}

const DRAFT_TABS = new Set(["prompt", "tools", "skills", "subagents", "settings"]);

function numberOrNull(text: string): number | null {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function TemplateEditor({ label, hint, value, onChange, variables, skillRefs, disabled }: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  variables: string[];
  skillRefs: string[];
  disabled: boolean;
}): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (text: string): void => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = insertAt(value, start, end, text);
    onChange(next.value);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };
  return (
    <Field label={label} hint={hint}>
      {!disabled && (variables.length > 0 || skillRefs.length > 0) && (
        <div className="flex flex-wrap items-center gap-1" aria-label={`${label} insert palette`}>
          {variables.map((name) => (
            <button key={name} type="button" className="rounded-xs border border-ink-500 px-1.5 py-0.5 font-mono text-[10px] text-brand hover:bg-brand/10" onClick={() => insert(`{{ctx.${name}}}`)}>
              {`{{ctx.${name}}}`}
            </button>
          ))}
          {skillRefs.length > 0 && (
            <Select value="" onValueChange={(v) => insert(`{{skill:${v}}}`)}>
              <SelectTrigger className="h-6 w-44 rounded-xs text-[10px]" aria-label="Inline a skill"><SelectValue placeholder="Inline a skill…" /></SelectTrigger>
              <SelectContent>{skillRefs.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
      )}
      <Textarea ref={ref} className={`${TEXTAREA_CLASS} min-h-[260px]`} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} spellCheck={false} aria-label={label} />
    </Field>
  );
}

export function AgentEditor({ registry, target, canManage, onClose, onOpenAgent }: {
  registry: AiRegistry;
  target: AgentEditorTarget;
  canManage: boolean;
  onClose: () => void;
  onOpenAgent: (target: AgentEditorTarget) => void;
}): ReactElement {
  const stored = target.agent;
  const [draft, setDraft] = useState<AgentInput>(target.initial);
  const [toolFilter, setToolFilter] = useState("");
  const [preview, setPreview] = useState<PromptPreview | null>(null);
  const models = useModelOptions();
  const previewMutation = usePromptPreview();
  const { saveAgent, deleteAgent, resetAgent } = useAssistantMutations();
  const readOnly = !canManage;
  const dirty = JSON.stringify(draft) !== JSON.stringify(target.initial);
  const session = useAiDraftSession<AgentInput>("agent", target.aiDraft ?? null, target.origin ?? {}, stored?.id ?? null);
  const guard = useSaveGuard(session.result);
  const drafting = canManage && registry.drafting.agent;
  const canRefine = drafting && (session.result !== null || (stored !== null && !stored.isSystem));
  const take = (next: AgentInput | null): boolean => {
    if (!next) return false;
    setDraft(next);
    setPreview(null);
    return true;
  };
  const review = (section: string): ReactElement | null => (
    <SectionReview kind="agent" section={section} status={session.result?.sections[section]} pending={session.pending}
      onRedraft={drafting ? () => void session.redraft(section, draft).then(take) : undefined} />
  );

  const set = <K extends keyof AgentInput>(key: K, value: AgentInput[K]): void => {
    setDraft((d) => ({ ...d, [key]: value }));
    setPreview(null);
  };
  const setTuning = (patch: Partial<AgentInput["tuning"]>): void => {
    setDraft((d) => ({ ...d, tuning: { ...d.tuning, ...patch } }));
  };
  const forkedSubagents = draft.tuning.forkedSubagents ?? [];

  const bound = stored ? featuresBoundTo(stored.id, registry) : [];
  const previewFeatureId = target.featureId ?? bound[0]?.id ?? null;
  const variables = Object.keys(variablesFor(stored?.id ?? null, registry));
  const featureVariables = target.featureId ? Object.keys(registry.features.find((f) => f.id === target.featureId)?.variables ?? {}) : variables;
  const palette = draft.taskTemplate === null ? [] : featureVariables;
  const skillRefs = useMemo(() => registry.skills.filter((s) => s.enabled).flatMap((s) => [s.name, ...Object.keys(s.files).map((f) => `${s.name}/${f}`)]), [registry.skills]);
  const harness = registry.harnesses.find((h) => h.id === draft.harnessId);
  const hidesTask = harness?.excludedTools.includes("task") ?? false;
  const providedContexts = new Set(bound.flatMap((f) => f.contexts));
  const wouldCycle = (optionId: string): boolean => Boolean(stored) && agentSubtree(optionId, registry).some((a) => a.id === stored?.id);
  const subagentOptions = registry.agents.filter((a) => a.id !== stored?.id && a.taskTemplate === null);
  const serverProblems = stored ? problemsFor(registry.problems, "agent", stored.id) : [];
  const toolGroups = groupTools(registry.tools.filter((t) => !toolFilter || `${t.name} ${t.title} ${t.category}`.toLowerCase().includes(toolFilter.toLowerCase())));

  const toggleTool = (name: string, on: boolean): void => set("tools", on ? [...draft.tools, name] : draft.tools.filter((t) => t !== name));
  const skillMode = (skillId: string): string => {
    const progressive = draft.skills.some((l) => l.skillId === skillId && l.mode === "progressive");
    const pinned = draft.skills.find((l) => l.skillId === skillId && l.mode === "pinned");
    if (pinned) return `pinned:${pinned.pinnedFile ?? "SKILL.md"}${progressive ? "+progressive" : ""}`;
    return progressive ? "progressive" : OFF;
  };
  const setSkillMode = (skillId: string, mode: string): void => {
    const rest = draft.skills.filter((l) => l.skillId !== skillId);
    const links: AgentSkillLink[] = [];
    if (mode === "progressive" || mode.endsWith("+progressive")) links.push({ skillId, mode: "progressive", pinnedFile: null });
    if (mode.startsWith("pinned:")) {
      const file = mode.slice("pinned:".length).replace("+progressive", "");
      links.push({ skillId, mode: "pinned", pinnedFile: file === "SKILL.md" ? null : file });
    }
    set("skills", [...rest, ...links]);
  };

  const runPreview = async (): Promise<void> => {
    try {
      setPreview(await previewMutation.mutateAsync({ featureId: previewFeatureId, agentId: stored?.id ?? null, agent: draft }));
    } catch (error) {
      toast.error(errorMessage(error, "Could not render the preview"));
    }
  };

  const save = async (): Promise<void> => {
    if (!guard.check()) return;
    try {
      const saved = await saveAgent.mutateAsync({ id: stored?.id ?? null, input: draft, version: stored?.version ?? null });
      toast.success(stored ? `Saved ${saved.name}` : `Created ${saved.name}`);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the agent"));
    }
  };

  const remove = async (): Promise<void> => {
    if (!stored) return;
    try {
      await deleteAgent.mutateAsync({ id: stored.id, version: stored.version });
      toast.success(`Deleted ${stored.name}`);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete the agent"));
    }
  };

  const reset = async (): Promise<void> => {
    if (!stored) return;
    try {
      await resetAgent.mutateAsync(stored.id);
      toast.success(`${stored.name} is back to its built-in definition`);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Could not reset the agent"));
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {stored ? stored.name : "New agent"}
            {stored && <OriginBadge row={stored} />}
            {draft.kind === "router" && <StatusPill tone="info" dot={false}>router</StatusPill>}
          </SheetTitle>
          <SheetDescription>
            {bound.length > 0 ? `Runs ${bound.map((f) => f.title).join(", ")}.` : "Not bound to a feature — usable as a chat agent or a subagent."}
            {stored?.isSystem && " Built-in: editing marks it customized; CHouse upgrades stop changing it until you reset it."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <ProblemList problems={serverProblems} />
          {session.result && <AiDraftBanner result={session.result} />}
          {canRefine && <RefineWithAi kind="agent" pending={session.pending} onRefine={async (instruction) => take(await session.refine(instruction, draft))} />}
          {review("identity")}
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Name" htmlFor="agent-name">
              <Input id="agent-name" className={INPUT_CLASS} value={draft.name} onChange={(e) => set("name", e.target.value)} disabled={readOnly} />
            </Field>
            <Field label="Slug" htmlFor="agent-slug" hint="The name a parent agent delegates to.">
              <Input id="agent-slug" className={`${INPUT_CLASS} font-mono`} value={draft.slug} onChange={(e) => set("slug", e.target.value)} disabled={readOnly || Boolean(stored?.isSystem)} />
            </Field>
            <Field label="Enabled">
              <div className="flex h-8 items-center"><Switch className={SWITCH_CLASS} checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} disabled={readOnly} aria-label="Enabled" /></div>
            </Field>
          </div>

          <Tabs defaultValue="prompt">
            <TabsList className="h-9 rounded-xs bg-ink-200/40">
              {["prompt", "tools", "skills", "subagents", "settings", "test", "history"].map((t) => (
                <TabsTrigger key={t} value={t} className={TAB_CLASS} disabled={(t === "history" && !stored)}>
                  {t}{DRAFT_TABS.has(t) && <SectionMark status={session.result?.sections[t]} />}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="prompt" className="mt-4 space-y-4">
              {review("prompt")}
              <TemplateEditor
                label="System prompt"
                hint={draft.taskTemplate === null
                  ? "Chat agents and subagents receive no {{ctx.…}} variables. {{skill:name}} inlines a skill."
                  : "Feature agents may use the feature's {{ctx.…}} variables. The feature appends its output contract (JSON schema) after this prompt; that part cannot be edited."}
                value={draft.systemPrompt}
                onChange={(v) => set("systemPrompt", v)}
                variables={palette}
                skillRefs={skillRefs}
                disabled={readOnly}
              />
              <div className="flex items-center gap-2">
                <Switch className={SWITCH_CLASS} checked={draft.taskTemplate !== null} onCheckedChange={(v) => set("taskTemplate", v ? (stored?.taskTemplate ?? "") : null)} disabled={readOnly || bound.length > 0} aria-label="Runs an AI feature" />
                <span className="text-[12px] text-paper-muted">Runs an AI feature (has a task template){bound.length > 0 && " — bound features need it"}</span>
              </div>
              {draft.taskTemplate !== null && (
                <TemplateEditor
                  label="Task template"
                  hint="The first user message: how the feature's evidence is framed for the model."
                  value={draft.taskTemplate}
                  onChange={(v) => set("taskTemplate", v)}
                  variables={palette}
                  skillRefs={[]}
                  disabled={readOnly}
                />
              )}
              <div className="space-y-2">
                <Button variant="outline" className="h-8 rounded-xs text-[11px]" disabled={previewMutation.isPending} onClick={() => void runPreview()}>
                  <Eye className="mr-1 h-3 w-3" /> {previewMutation.isPending ? "Rendering…" : `Preview${previewFeatureId ? ` for ${registry.features.find((f) => f.id === previewFeatureId)?.title}` : ""}`}
                </Button>
                {preview && (
                  <div className="space-y-2">
                    <ProblemList problems={preview.problems} />
                    {preview.problems.length === 0 && <p className="text-[11px] text-emerald-500">No problems. Variables show as «name»; a skill-pinned section shows in full.</p>}
                    {preview.system !== null && <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[11px] text-paper">{preview.system}</pre>}
                    {preview.task !== null && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[11px] text-paper">{preview.task}</pre>}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="tools" className="mt-4 space-y-3">
              {review("tools")}
              <p className="text-[12px] text-paper-muted">Tools read, except action tools, which wait for a person to approve each call. Tools run in a context the feature must provide; CHouse tools also respect the chatting user's permissions.</p>
              <div className="relative max-w-sm">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-paper-faint" />
                <Input className={`${INPUT_CLASS} pl-7`} value={toolFilter} onChange={(e) => setToolFilter(e.target.value)} placeholder="Filter tools" aria-label="Filter tools" />
              </div>
              {toolGroups.map((group) => (
                <div key={group.key} className="space-y-1">
                  <h4 className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{group.label}</h4>
                  {group.tools.map((tool) => {
                    const checked = draft.tools.includes(tool.name);
                    const unavailable = bound.length > 0 && tool.requires !== null && !providedContexts.has(tool.requires);
                    return (
                      <label key={tool.name} className="flex items-start gap-2 rounded-xs px-2 py-1.5 hover:bg-ink-200/30">
                        <Checkbox checked={checked} onCheckedChange={(v) => toggleTool(tool.name, v === true)} disabled={readOnly} aria-label={tool.name} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 text-[12px] text-paper"><Mono>{tool.name}</Mono>{tool.requires && <ContextBadge kind={tool.requires} />}{tool.access === "write" && <ApprovalBadge risk={tool.risk} />}{unavailable && <span className="text-[10px] text-amber-500">not provided by the bound feature</span>}</span>
                          <span className="block text-[11px] text-paper-faint">{tool.description.split("\n")[0]}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </TabsContent>

            <TabsContent value="skills" className="mt-4 space-y-2">
              {review("skills")}
              <p className="text-[12px] text-paper-muted">On demand: listed in the prompt, read when needed. Pinned: the chosen file is inlined at the end of the system prompt.</p>
              {registry.skills.map((skill) => (
                <div key={skill.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xs border border-ink-500 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[12px] text-paper"><Mono>{skill.name}</Mono> <span className="font-mono text-[10px] text-paper-faint">/skills/{skill.path}</span>{!skill.enabled && <span className="ml-2 text-[10px] text-amber-500">disabled</span>}</div>
                    <p className="text-[11px] text-paper-faint">{skill.description}</p>
                  </div>
                  <Select value={skillMode(skill.id)} onValueChange={(v) => setSkillMode(skill.id, v)} disabled={readOnly}>
                    <SelectTrigger className="h-8 w-60 rounded-xs text-[11px]" aria-label={`${skill.name} mode`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={OFF}>Not used</SelectItem>
                      <SelectItem value="progressive">On demand</SelectItem>
                      {["SKILL.md", ...Object.keys(skill.files)].map((file) => (
                        <SelectItem key={file} value={`pinned:${file}`}>Pinned: {file}</SelectItem>
                      ))}
                      {["SKILL.md", ...Object.keys(skill.files)].map((file) => (
                        <SelectItem key={`${file}+p`} value={`pinned:${file}+progressive`}>On demand + pinned: {file}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="subagents" className="mt-4 space-y-2">
              {review("subagents")}
              {hidesTask && <p role="status" className="rounded-xs border border-amber-500/40 bg-amber-500/5 p-2 text-[12px] text-amber-500">The {harness?.name} harness hides the task tool. Pick a delegating harness in Settings to use subagents.</p>}
              <p className="text-[12px] text-paper-muted">The agent delegates to these with the task tool, choosing by their description. A subagent sees only the task the parent writes, unless it inherits the conversation.</p>
              {subagentOptions.map((option) => {
                const selected = draft.subagents.includes(option.id);
                const forked = forkedSubagents.includes(option.id);
                const hasOwnSubagents = option.subagents.length > 0;
                return (
                  <div key={option.id} className="flex items-start gap-2 rounded-xs px-2 py-1.5 hover:bg-ink-200/30">
                    <label className="flex min-w-0 flex-1 items-start gap-2">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(v) => {
                          set("subagents", v === true ? [...draft.subagents, option.id] : draft.subagents.filter((id) => id !== option.id));
                          if (v !== true && forked) setTuning({ forkedSubagents: forkedSubagents.filter((id) => id !== option.id) });
                        }}
                        disabled={readOnly || (wouldCycle(option.id) && !selected)}
                        aria-label={option.name}
                      />
                      <span className="min-w-0">
                        <span className="text-[12px] text-paper">{option.name} <Mono className="text-paper-faint">{option.slug}</Mono>{!option.enabled && <span className="ml-1 text-[10px] text-amber-500">disabled</span>}</span>
                        <span className="block text-[11px] text-paper-faint">{option.description}</span>
                      </span>
                    </label>
                    {selected && (
                      <label
                        className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[11px] text-paper-muted"
                        title={hasOwnSubagents ? "A subagent with subagents of its own can't inherit the conversation." : "The subagent sees the whole conversation, not only its task."}
                      >
                        <Switch
                          className={SWITCH_CLASS}
                          checked={forked}
                          onCheckedChange={(v) => setTuning({ forkedSubagents: v ? [...forkedSubagents, option.id] : forkedSubagents.filter((id) => id !== option.id) })}
                          disabled={readOnly || (hasOwnSubagents && !forked)}
                          aria-label={`${option.name} inherits the conversation`}
                        />
                        Inherit conversation
                      </label>
                    )}
                  </div>
                );
              })}
            </TabsContent>

            <TabsContent value="settings" className="mt-4 space-y-4">
              {review("settings")}
              <Field label="Description" hint="Parent agents and the router choose subagents by this text — say what it answers.">
                <Textarea className={TEXTAREA_CLASS} value={draft.description} onChange={(e) => set("description", e.target.value)} disabled={readOnly} />
              </Field>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Kind" hint="A router only delegates.">
                  <Select value={draft.kind} onValueChange={(v) => set("kind", v === "router" ? "router" : "agent")} disabled={readOnly}>
                    <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Kind"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="agent">Agent</SelectItem><SelectItem value="router">Router</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field label="Harness" hint={harness?.description}>
                  <Select value={draft.harnessId} onValueChange={(v) => set("harnessId", v)} disabled={readOnly}>
                    <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Harness"><SelectValue /></SelectTrigger>
                    <SelectContent>{registry.harnesses.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Model" hint="A model picked by the user (chat, SQL editor) wins over this.">
                  <Select value={draft.modelConfigId ?? DEFAULT_MODEL} onValueChange={(v) => set("modelConfigId", v === DEFAULT_MODEL ? null : v)} disabled={readOnly}>
                    <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Model"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_MODEL}>Default model</SelectItem>
                      {(models.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="Step budget" hint={`${registry.limits.stepBudget.min}–${registry.limits.stepBudget.max}; recursion limit = max(24, steps × 4)`}>
                  <Input type="number" className={INPUT_CLASS} value={draft.tuning.stepBudget} onChange={(e) => set("tuning", { ...draft.tuning, stepBudget: numberOrNull(e.target.value) ?? 0 })} disabled={readOnly} aria-label="Step budget" />
                </Field>
                <Field label="Recursion limit" hint="Optional override">
                  <Input type="number" className={INPUT_CLASS} value={draft.tuning.recursionLimit ?? ""} onChange={(e) => set("tuning", { ...draft.tuning, recursionLimit: numberOrNull(e.target.value) })} disabled={readOnly} aria-label="Recursion limit" />
                </Field>
                <Field label="Timeout, s" hint="Default: 4 min features, 2 min chat">
                  <Input type="number" className={INPUT_CLASS} value={draft.tuning.timeoutMs ? Math.round(draft.tuning.timeoutMs / 1000) : ""} onChange={(e) => { const s = numberOrNull(e.target.value); set("tuning", { ...draft.tuning, timeoutMs: s === null ? null : s * 1000 }); }} disabled={readOnly} aria-label="Timeout seconds" />
                </Field>
                <Field label="Max output tokens" hint="Formatter fallback budget">
                  <Input type="number" className={INPUT_CLASS} value={draft.tuning.maxOutputTokens ?? ""} onChange={(e) => set("tuning", { ...draft.tuning, maxOutputTokens: numberOrNull(e.target.value) })} disabled={readOnly} aria-label="Max output tokens" />
                </Field>
              </div>
              <div className="space-y-3 rounded-xs border border-ink-500 p-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Runtime</p>
                  <p className="text-[11px] text-paper-faint">What happens when a call fails or a run grows. Empty fields keep the default.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Fallback model" hint="Answers when the agent's model fails after its retries.">
                    <Select value={draft.tuning.fallbackModelConfigId ?? NO_FALLBACK} onValueChange={(v) => setTuning({ fallbackModelConfigId: v === NO_FALLBACK ? null : v })} disabled={readOnly}>
                      <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Fallback model"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_FALLBACK}>None</SelectItem>
                        {(models.data ?? []).filter((m) => m.id !== draft.modelConfigId).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Model retries" hint={`Transient provider errors, ${registry.limits.modelRetries.min}–${registry.limits.modelRetries.max}`}>
                    <Input type="number" className={INPUT_CLASS} placeholder="0" value={draft.tuning.modelRetries ?? ""} onChange={(e) => setTuning({ modelRetries: numberOrNull(e.target.value) })} disabled={readOnly} aria-label="Model retries" />
                  </Field>
                  <Field label="Tool retries" hint={`Timeouts and busy servers, ${registry.limits.toolRetries.min}–${registry.limits.toolRetries.max}`}>
                    <Input type="number" className={INPUT_CLASS} placeholder="0" value={draft.tuning.toolRetries ?? ""} onChange={(e) => setTuning({ toolRetries: numberOrNull(e.target.value) })} disabled={readOnly} aria-label="Tool retries" />
                  </Field>
                  <Field label="Max model calls" hint="Per run; the agent answers with what it has">
                    <Input type="number" className={INPUT_CLASS} placeholder="no cap" value={draft.tuning.maxModelCalls ?? ""} onChange={(e) => setTuning({ maxModelCalls: numberOrNull(e.target.value) })} disabled={readOnly} aria-label="Max model calls" />
                  </Field>
                  <Field label="Max tool calls" hint="Per run; the agent is told the cap is reached">
                    <Input type="number" className={INPUT_CLASS} placeholder="no cap" value={draft.tuning.maxToolCalls ?? ""} onChange={(e) => setTuning({ maxToolCalls: numberOrNull(e.target.value) })} disabled={readOnly} aria-label="Max tool calls" />
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-start gap-2">
                    <Switch className={`${SWITCH_CLASS} mt-0.5`} checked={draft.tuning.promptCaching !== false} onCheckedChange={(v) => setTuning({ promptCaching: v })} disabled={readOnly} aria-label="Prompt caching" />
                    <span>
                      <span className="block text-[12px] text-paper">Prompt caching</span>
                      <span className="block text-[11px] text-paper-faint">Anthropic and Bedrock reuse the unchanged start of each prompt; AI Usage shows the savings.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <Switch className={`${SWITCH_CLASS} mt-0.5`} checked={draft.tuning.clearOldToolResults === true} onCheckedChange={(v) => setTuning({ clearOldToolResults: v })} disabled={readOnly} aria-label="Clear old tool results" />
                    <span>
                      <span className="block text-[12px] text-paper">Clear old tool results</span>
                      <span className="block text-[11px] text-paper-faint">Long runs drop older tool output once the context is 60% full.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <Switch className={`${SWITCH_CLASS} mt-0.5`} checked={draft.tuning.memory === true} onCheckedChange={(v) => setTuning({ memory: v })} disabled={readOnly} aria-label="Memory" />
                    <span>
                      <span className="block text-[12px] text-paper">Memory</span>
                      <span className="block text-[11px] text-paper-faint">Sees the user&apos;s memories and approved team memories; in chat it can keep new ones (AI Governance › Memories).</span>
                    </span>
                  </label>
                </div>
              </div>
              <Field label="Required permissions" hint="Chat users need at least one of these to see the agent (comma-separated). Empty: anyone with ai:chat.">
                <Input className={`${INPUT_CLASS} font-mono`} value={draft.requiredPermissions.join(", ")} onChange={(e) => set("requiredPermissions", e.target.value.split(",").map((p) => p.trim()).filter(Boolean))} disabled={readOnly} aria-label="Required permissions" />
              </Field>
            </TabsContent>

            <TabsContent value="test" className="mt-4">
              <TestConsole registry={registry} draft={{ agentId: stored?.id ?? null, agent: draft }} defaultFeatureId={previewFeatureId ?? undefined} canManage={canManage} />
            </TabsContent>

            {stored && (
              <TabsContent value="history" className="mt-4">
                <RevisionHistory entity="agent" id={stored.id} canManage={canManage} onRestored={onClose} />
              </TabsContent>
            )}
          </Tabs>

          {guard.confirming && <SaveWarning warnings={guard.warnings} onCancel={guard.cancel} />}
          {canManage && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-500 pt-4">
              <div className="flex flex-wrap gap-2">
                {stored && (
                  <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => onOpenAgent({ agent: null, initial: duplicateAgent(stored, registry) })}>
                    <Copy className="mr-1 h-3 w-3" /> Duplicate
                  </Button>
                )}
                {stored?.isSystem && (stored.customized || stored.updateAvailable) && (
                  <Button variant="outline" className="h-8 rounded-xs text-[11px]" disabled={resetAgent.isPending} onClick={() => void reset()}>
                    <RotateCcw className="mr-1 h-3 w-3" /> Reset to built-in
                  </Button>
                )}
                {stored && !stored.isSystem && (
                  <Button variant="outline" className="h-8 rounded-xs border-red-500/40 text-[11px] text-red-400" disabled={deleteAgent.isPending || stored.usedBy.length > 0} title={stored.usedBy.length > 0 ? `Used by ${stored.usedBy.join(", ")}` : undefined} onClick={() => void remove()}>
                    <Trash2 className="mr-1 h-3 w-3" /> Delete
                  </Button>
                )}
              </div>
              <Button className={DH_PRIMARY} disabled={saveAgent.isPending || session.pending || (stored !== null && !dirty)} onClick={() => void save()}>
                <Save className="mr-1.5 h-3.5 w-3.5" /> {saveAgent.isPending ? "Saving…" : guard.confirming ? "Save anyway" : stored ? "Save" : "Create"}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
