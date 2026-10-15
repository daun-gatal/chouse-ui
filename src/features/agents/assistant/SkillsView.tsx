/**
 * Skills (ADR 0019 §6): SKILL.md files and their reference files, stored in
 * the metadata DB and served read-only to agents under /skills/.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { BookOpen, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";

import { skillInputOf, type AiRegistry, type AiSkill, type DraftResult, type SkillInput } from "@/api/aiAgents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { DataTable, EmptyState, Mono, Panel } from "@/features/observe/ui";
import { AiDraftBanner, DraftWithAiButton, DraftWithAiDialog, RefineWithAi, SaveWarning, SectionReview, useAiDraftSession, useSaveGuard, type DraftOrigin } from "./DraftWithAi";
import { useAssistantMutations } from "./hooks";
import { problemsFor } from "./lib";
import { RevisionHistory } from "./RevisionHistory";
import { errorMessage, Field, INPUT_CLASS, OriginBadge, ProblemList, SWITCH_CLASS, TEXTAREA_CLASS } from "./shared";

const BLANK_SKILL: SkillInput = {
  path: "custom/my-skill",
  skillMd: "---\nname: my-skill\ndescription: When to use this skill, in one sentence.\n---\n\nInstructions the agent follows when it reads this skill.\n",
  files: {},
  enabled: true,
};

interface SkillEditorTarget {
  skill: AiSkill | null;
  initial: SkillInput;
  aiDraft?: DraftResult<SkillInput>;
  origin?: DraftOrigin;
}

function SkillEditor({ registry, target, canManage, onClose }: { registry: AiRegistry; target: SkillEditorTarget; canManage: boolean; onClose: () => void }): ReactElement {
  const { skill } = target;
  const [draft, setDraft] = useState(target.initial);
  const [newFile, setNewFile] = useState("");
  const { saveSkill, deleteSkill, resetSkill } = useAssistantMutations();
  const readOnly = !canManage;
  const problems = skill ? problemsFor(registry.problems, "skill", skill.id) : [];
  const session = useAiDraftSession<SkillInput>("skill", target.aiDraft ?? null, target.origin ?? {}, skill?.id ?? null);
  const guard = useSaveGuard(session.result);
  const canRefine = canManage && registry.drafting.skill && (session.result !== null || (skill !== null && !skill.isSystem));
  const review = (section: string): ReactElement | null => (
    <SectionReview kind="skill" section={section} status={session.result?.sections[section]} pending={session.pending}
      onRedraft={canManage && registry.drafting.skill ? () => void session.redraft(section, draft).then((next) => next && setDraft(next)) : undefined} />
  );

  const act = async (fn: () => Promise<unknown>, done: string, failed: string): Promise<void> => {
    try {
      await fn();
      toast.success(done);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, failed));
    }
  };

  const addFile = (): void => {
    const name = newFile.trim();
    if (!name || name === "SKILL.md" || name in draft.files) return;
    setDraft({ ...draft, files: { ...draft.files, [name]: "" } });
    setNewFile("");
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">{skill ? skill.name : "New skill"}{skill && <OriginBadge row={skill} />}</SheetTitle>
          <SheetDescription>The name and description come from the SKILL.md front matter. Agents see it at /skills/{draft.path}/SKILL.md.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <ProblemList problems={problems} />
          {session.result && <AiDraftBanner result={session.result} />}
          {canRefine && <RefineWithAi kind="skill" pending={session.pending} onRefine={async (instruction) => {
            const next = await session.refine(instruction, draft);
            if (next) setDraft(next);
            return next !== null;
          }} />}
          {review("path")}
          {review("enabled")}
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Field label="Path" hint="<group>/<directory>; agents list skills per group.">
              <Input className={`${INPUT_CLASS} font-mono`} value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} disabled={readOnly} aria-label="Skill path" />
            </Field>
            <Field label="Enabled">
              <div className="flex h-8 items-center"><Switch className={SWITCH_CLASS} checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} disabled={readOnly} aria-label="Skill enabled" /></div>
            </Field>
          </div>
          {review("skillMd")}
          <Field label="SKILL.md">
            <Textarea className={`${TEXTAREA_CLASS} min-h-[260px]`} value={draft.skillMd} onChange={(e) => setDraft({ ...draft, skillMd: e.target.value })} disabled={readOnly} spellCheck={false} aria-label="SKILL.md" />
          </Field>
          {review("files")}
          {Object.entries(draft.files).map(([name, content]) => (
            <Field key={name} label={name}>
              <div className="space-y-1">
                <Textarea className={`${TEXTAREA_CLASS} min-h-[200px]`} value={content} onChange={(e) => setDraft({ ...draft, files: { ...draft.files, [name]: e.target.value } })} disabled={readOnly} spellCheck={false} aria-label={name} />
                {!readOnly && (
                  <Button variant="ghost" className="h-7 rounded-xs px-2 text-[11px]" onClick={() => { const { [name]: _removed, ...rest } = draft.files; setDraft({ ...draft, files: rest }); }}>
                    <X className="mr-1 h-3 w-3" /> Remove {name}
                  </Button>
                )}
              </div>
            </Field>
          ))}
          {!readOnly && (
            <div className="flex items-center gap-2">
              <Input className={`${INPUT_CLASS} max-w-xs font-mono`} placeholder="reference.md" value={newFile} onChange={(e) => setNewFile(e.target.value)} aria-label="New file name" />
              <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={addFile}><Plus className="mr-1 h-3 w-3" /> Add file</Button>
            </div>
          )}
          {skill && <Field label="History"><RevisionHistory entity="skill" id={skill.id} canManage={canManage} onRestored={onClose} /></Field>}
          {guard.confirming && <SaveWarning warnings={guard.warnings} onCancel={guard.cancel} />}
          {canManage && (
            <div className="flex flex-wrap justify-between gap-2 border-t border-ink-500 pt-4">
              <div className="flex gap-2">
                {skill?.isSystem && (skill.customized || skill.updateAvailable) && (
                  <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => void act(() => resetSkill.mutateAsync(skill.id), "Skill reset", "Could not reset")}><RotateCcw className="mr-1 h-3 w-3" /> Reset to built-in</Button>
                )}
                {skill && !skill.isSystem && (
                  <Button variant="outline" className="h-8 rounded-xs border-red-500/40 text-[11px] text-red-400" disabled={skill.usedBy.length > 0} title={skill.usedBy.join(", ") || undefined}
                    onClick={() => void act(() => deleteSkill.mutateAsync({ id: skill.id, version: skill.version }), "Skill deleted", "Could not delete")}><Trash2 className="mr-1 h-3 w-3" /> Delete</Button>
                )}
              </div>
              <Button className={DH_PRIMARY} disabled={saveSkill.isPending || session.pending}
                onClick={() => {
                  if (!guard.check()) return;
                  void act(() => saveSkill.mutateAsync({ id: skill?.id ?? null, input: draft, version: skill?.version ?? null }), "Skill saved", "Could not save the skill");
                }}>
                <Save className="mr-1.5 h-3.5 w-3.5" /> {guard.confirming ? "Save anyway" : skill ? "Save" : "Create"}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function SkillsView({ registry, canManage }: { registry: AiRegistry; canManage: boolean }): ReactElement {
  const [editing, setEditing] = useState<SkillEditorTarget | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [opened, setOpened] = useState(0);
  const open = (target: SkillEditorTarget): void => {
    setOpened((n) => n + 1);
    setEditing(target);
  };
  const skills = [...registry.skills].sort((a, b) => a.path.localeCompare(b.path));
  return (
    <>
      <Panel title="Skills" meta="Instructions and reference docs agents read on demand, or pin into their prompt"
        actions={canManage ? (
          <span className="flex gap-2">
            {registry.drafting.skill && <DraftWithAiButton onClick={() => setDrafting(true)} />}
            <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => open({ skill: null, initial: BLANK_SKILL })}><Plus className="mr-1 h-3 w-3" /> New skill</Button>
          </span>
        ) : undefined}>
        {skills.length === 0 ? <EmptyState icon={BookOpen} title="No skills" /> : (
          <DataTable label="Skills" head={["Skill", "Path", "Files", "Used by", "Status"]}>
            {skills.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-ink-200/50" onClick={() => open({ skill: s, initial: skillInputOf(s) })}>
                <td className="max-w-md"><Mono className="text-paper">{s.name}</Mono><span className="block text-[11px] text-paper-faint">{s.description}</span></td>
                <td className="font-mono text-[10px] text-paper-muted">{s.path}</td>
                <td className="font-mono text-[10px] text-paper-muted">{["SKILL.md", ...Object.keys(s.files)].join(", ")}</td>
                <td className="text-[11px] text-paper-muted">{s.usedBy.length}</td>
                <td><span className="inline-flex gap-1"><OriginBadge row={s} />{!s.enabled && <span className="text-[10px] text-amber-500">disabled</span>}</span></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      {editing && <SkillEditor key={opened} registry={registry} target={editing} canManage={canManage} onClose={() => setEditing(null)} />}
      {drafting && (
        <DraftWithAiDialog<SkillInput> kind="skill" registry={registry} onClose={() => setDrafting(false)}
          onDrafted={(result, origin) => {
            setDrafting(false);
            open({ skill: null, initial: result.input, aiDraft: result, origin });
          }} />
      )}
    </>
  );
}
