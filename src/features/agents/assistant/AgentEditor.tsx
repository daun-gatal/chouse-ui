/**
 * Agent editor (ADR 0019 §12): prompt and task templates with a variable
 * palette, tools, skills (on demand or pinned), subagents, harness, model and
 * tuning — plus a rendered preview, a draft test run and the revision history.
 * Viewing needs ai_agents:view; saving needs ai_agents:manage.
 */

import { useMemo, useRef, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Copy, Eye, RotateCcw, Save, Search, Trash2 } from "lucide-react";

import type { AgentInput, AgentSkillLink, AiAgent, AiRegistry, PromptPreview } from "@/api/aiAgents";
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
import { useAssistantMutations, useModelOptions, usePromptPreview } from "./hooks";
import { agentSubtree, duplicateAgent, featuresBoundTo, groupTools, insertAt, problemsFor, variablesFor } from "./lib";
import { RevisionHistory } from "./RevisionHistory";
import { ContextBadge, errorMessage, Field, INPUT_CLASS, OriginBadge, ProblemList, SWITCH_CLASS, TAB_CLASS, TEXTAREA_CLASS } from "./shared";
import { TestConsole } from "./TestConsole";

const DEFAULT_MODEL = "__default__";
const OFF = "off";

export interface AgentEditorTarget {
  /** The stored agent being edited; null for a new agent. */
  agent: AiAgent | null;
  initial: AgentInput;
  /** Feature the editor was opened from (preview + test default). */
  featureId?: string;
}

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

  const set = <K extends keyof AgentInput>(key: K, value: AgentInput[K]): void => {
    setDraft((d) => ({ ...d, [key]: value }));
    setPreview(null);
  };

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
                <TabsTrigger key={t} value={t} className={TAB_CLASS} disabled={(t === "history" && !stored)}>{t}</TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="prompt" className="mt-4 space-y-4">
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
              <p className="text-[12px] text-paper-muted">Only read-only tools exist. Tools run in a context the feature must provide; CHouse tools also respect the chatting user's permissions.</p>
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
                          <span className="flex flex-wrap items-center gap-2 text-[12px] text-paper"><Mono>{tool.name}</Mono>{tool.requires && <ContextBadge kind={tool.requires} />}{unavailable && <span className="text-[10px] text-amber-500">not provided by the bound feature</span>}</span>
                          <span className="block text-[11px] text-paper-faint">{tool.description.split("\n")[0]}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </TabsContent>

            <TabsContent value="skills" className="mt-4 space-y-2">
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
              {hidesTask && <p role="status" className="rounded-xs border border-amber-500/40 bg-amber-500/5 p-2 text-[12px] text-amber-500">The {harness?.name} harness hides the task tool. Pick a delegating harness in Settings to use subagents.</p>}
              <p className="text-[12px] text-paper-muted">The agent delegates to these with the task tool, choosing by their description. Subagents don't see the conversation, only the task the parent writes.</p>
              {subagentOptions.map((option) => (
                <label key={option.id} className="flex items-start gap-2 rounded-xs px-2 py-1.5 hover:bg-ink-200/30">
                  <Checkbox
                    checked={draft.subagents.includes(option.id)}
                    onCheckedChange={(v) => set("subagents", v === true ? [...draft.subagents, option.id] : draft.subagents.filter((id) => id !== option.id))}
                    disabled={readOnly || (wouldCycle(option.id) && !draft.subagents.includes(option.id))}
                    aria-label={option.name}
                  />
                  <span className="min-w-0">
                    <span className="text-[12px] text-paper">{option.name} <Mono className="text-paper-faint">{option.slug}</Mono>{!option.enabled && <span className="ml-1 text-[10px] text-amber-500">disabled</span>}</span>
                    <span className="block text-[11px] text-paper-faint">{option.description}</span>
                  </span>
                </label>
              ))}
            </TabsContent>

            <TabsContent value="settings" className="mt-4 space-y-4">
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
              <Button className={DH_PRIMARY} disabled={saveAgent.isPending || (stored !== null && !dirty)} onClick={() => void save()}>
                <Save className="mr-1.5 h-3.5 w-3.5" /> {saveAgent.isPending ? "Saving…" : stored ? "Save" : "Create"}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
