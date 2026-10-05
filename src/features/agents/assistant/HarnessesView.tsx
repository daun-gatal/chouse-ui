/**
 * Harnesses (ADR 0019 §3): which built-in DeepAgents tools an agent sees, the
 * general-purpose subagent, a prompt suffix and tool description overrides —
 * applied per agent.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Plus, RotateCcw, Save, Trash2, Wrench } from "lucide-react";

import { harnessInputOf, type AiHarness, type AiRegistry, type HarnessInput } from "@/api/aiAgents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { DataTable, EmptyState, Mono, Panel } from "@/features/observe/ui";
import { useAssistantMutations } from "./hooks";
import { parseOverrides, problemsFor, uniqueSlug } from "./lib";
import { RevisionHistory } from "./RevisionHistory";
import { errorMessage, Field, INPUT_CLASS, OriginBadge, ProblemList, SWITCH_CLASS, TEXTAREA_CLASS } from "./shared";

function blankHarness(registry: AiRegistry): HarnessInput {
  return {
    slug: uniqueSlug("new-harness", registry.harnesses.map((h) => h.slug)),
    name: "New harness",
    description: "",
    excludedTools: ["write_todos", "write_file", "edit_file", "execute"],
    generalPurpose: { enabled: false },
    promptSuffix: null,
    toolDescriptionOverrides: {},
  };
}

function overridesText(overrides: Record<string, string>): string {
  return Object.entries(overrides).map(([tool, description]) => `${tool}: ${description}`).join("\n");
}

function HarnessEditor({ registry, harness, initial, canManage, onClose }: { registry: AiRegistry; harness: AiHarness | null; initial: HarnessInput; canManage: boolean; onClose: () => void }): ReactElement {
  const [draft, setDraft] = useState(initial);
  const [overrides, setOverrides] = useState(overridesText(initial.toolDescriptionOverrides));
  const { saveHarness, deleteHarness, resetHarness } = useAssistantMutations();
  const readOnly = !canManage;
  const set = <K extends keyof HarnessInput>(key: K, value: HarnessInput[K]): void => setDraft((d) => ({ ...d, [key]: value }));
  const problems = harness ? problemsFor(registry.problems, "harness", harness.id) : [];

  const act = async (fn: () => Promise<unknown>, done: string, failed: string): Promise<void> => {
    try {
      await fn();
      toast.success(done);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, failed));
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">{harness ? harness.name : "New harness"}{harness && <OriginBadge row={harness} />}</SheetTitle>
          <SheetDescription>Applied to each agent that uses it, including subagents.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <ProblemList problems={problems} />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name"><Input className={INPUT_CLASS} value={draft.name} onChange={(e) => set("name", e.target.value)} disabled={readOnly} aria-label="Harness name" /></Field>
            <Field label="Slug"><Input className={`${INPUT_CLASS} font-mono`} value={draft.slug} onChange={(e) => set("slug", e.target.value)} disabled={readOnly || Boolean(harness?.isSystem)} aria-label="Harness slug" /></Field>
          </div>
          <Field label="Description"><Textarea className={TEXTAREA_CLASS} value={draft.description} onChange={(e) => set("description", e.target.value)} disabled={readOnly} /></Field>
          <Field label="Built-in tools" hint="Off hides the tool from the model. Agents with subagents need the task tool.">
            <div className="grid gap-1 md:grid-cols-2">
              {registry.builtinTools.map((tool) => (
                <label key={tool.name} className="flex items-start gap-2 rounded-xs border border-ink-500 px-2 py-1.5">
                  <Switch className={SWITCH_CLASS} checked={!draft.excludedTools.includes(tool.name)} disabled={readOnly} aria-label={tool.name}
                    onCheckedChange={(on) => set("excludedTools", on ? draft.excludedTools.filter((t) => t !== tool.name) : [...draft.excludedTools, tool.name])} />
                  <span><Mono className="text-[11px] text-paper">{tool.name}</Mono><span className="block text-[10px] text-paper-faint">{tool.description}</span></span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="General-purpose subagent" hint="A catch-all subagent with the agent's own tools and skills.">
            <div className="space-y-2">
              <Switch className={SWITCH_CLASS} checked={draft.generalPurpose.enabled} disabled={readOnly} aria-label="General-purpose subagent"
                onCheckedChange={(on) => set("generalPurpose", { ...draft.generalPurpose, enabled: on })} />
              {draft.generalPurpose.enabled && (
                <>
                  <Input className={INPUT_CLASS} placeholder="Description (optional)" value={draft.generalPurpose.description ?? ""} disabled={readOnly}
                    onChange={(e) => set("generalPurpose", { ...draft.generalPurpose, description: e.target.value || null })} aria-label="General-purpose description" />
                  <Textarea className={TEXTAREA_CLASS} placeholder="System prompt (optional)" value={draft.generalPurpose.systemPrompt ?? ""} disabled={readOnly}
                    onChange={(e) => set("generalPurpose", { ...draft.generalPurpose, systemPrompt: e.target.value || null })} aria-label="General-purpose prompt" />
                </>
              )}
            </div>
          </Field>
          <Field label="Prompt suffix" hint="Appended to every agent prompt that uses this harness.">
            <Textarea className={TEXTAREA_CLASS} value={draft.promptSuffix ?? ""} onChange={(e) => set("promptSuffix", e.target.value || null)} disabled={readOnly} aria-label="Prompt suffix" />
          </Field>
          <Field label="Tool description overrides" hint="One per line: tool_name: new description">
            <Textarea className={TEXTAREA_CLASS} value={overrides} onChange={(e) => setOverrides(e.target.value)} disabled={readOnly} aria-label="Tool description overrides" />
          </Field>
          {harness && <Field label="History"><RevisionHistory entity="harness" id={harness.id} canManage={canManage} onRestored={onClose} /></Field>}
          {canManage && (
            <div className="flex flex-wrap justify-between gap-2 border-t border-ink-500 pt-4">
              <div className="flex gap-2">
                {harness?.isSystem && (harness.customized || harness.updateAvailable) && (
                  <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => void act(() => resetHarness.mutateAsync(harness.id), "Harness reset", "Could not reset")}><RotateCcw className="mr-1 h-3 w-3" /> Reset to built-in</Button>
                )}
                {harness && !harness.isSystem && (
                  <Button variant="outline" className="h-8 rounded-xs border-red-500/40 text-[11px] text-red-400" disabled={harness.usedBy.length > 0} title={harness.usedBy.join(", ") || undefined}
                    onClick={() => void act(() => deleteHarness.mutateAsync({ id: harness.id, version: harness.version }), "Harness deleted", "Could not delete")}><Trash2 className="mr-1 h-3 w-3" /> Delete</Button>
                )}
              </div>
              <Button className={DH_PRIMARY} disabled={saveHarness.isPending}
                onClick={() => void act(() => saveHarness.mutateAsync({ id: harness?.id ?? null, input: { ...draft, toolDescriptionOverrides: parseOverrides(overrides) }, version: harness?.version ?? null }), "Harness saved", "Could not save the harness")}>
                <Save className="mr-1.5 h-3.5 w-3.5" /> {harness ? "Save" : "Create"}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function HarnessesView({ registry, canManage }: { registry: AiRegistry; canManage: boolean }): ReactElement {
  const [editing, setEditing] = useState<{ harness: AiHarness | null; initial: HarnessInput } | null>(null);
  return (
    <>
      <Panel title="Harnesses" meta="How DeepAgents runs an agent: built-in tools, delegation and prompt suffix"
        actions={canManage ? <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => setEditing({ harness: null, initial: blankHarness(registry) })}><Plus className="mr-1 h-3 w-3" /> New harness</Button> : undefined}>
        {registry.harnesses.length === 0 ? <EmptyState icon={Wrench} title="No harnesses" /> : (
          <DataTable label="Harnesses" head={["Harness", "Hidden built-in tools", "General-purpose", "Used by", "Status"]}>
            {registry.harnesses.map((h) => (
              <tr key={h.id} className="cursor-pointer hover:bg-ink-200/50" onClick={() => setEditing({ harness: h, initial: harnessInputOf(h) })}>
                <td><span className="block text-[12px] text-paper">{h.name}</span><span className="block text-[11px] text-paper-faint">{h.description}</span></td>
                <td className="font-mono text-[10px] text-paper-muted">{h.excludedTools.join(", ") || "none"}</td>
                <td className="text-[11px] text-paper-muted">{h.generalPurpose.enabled ? "on" : "off"}</td>
                <td className="text-[11px] text-paper-muted">{h.usedBy.length}</td>
                <td><OriginBadge row={h} /></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      {editing && <HarnessEditor registry={registry} harness={editing.harness} initial={editing.initial} canManage={canManage} onClose={() => setEditing(null)} />}
    </>
  );
}
