/**
 * AI Governance › Memories (ADR 0024 §Phase 3): the notes agents keep.
 * Your memories are private and saved at once; team memories describe a
 * ClickHouse connection and wait for someone with ai_memories:manage to
 * approve them before any agent reads them.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { AlertTriangle, Brain, Check, Download, Pencil, Plus, Trash2, Users, X } from "lucide-react";

import { exportMyMemories, MEMORY_MAX_CHARS, type AiMemory, type MemoryStatus } from "@/api/aiMemories";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, SWITCH_CLASS, TEXTAREA_CLASS } from "@/features/agents/assistant/shared";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { formatAgo } from "@/features/observe/lib";
import { DataTable, EmptyState, ErrorState, LoadingGrid, Panel, StatusPill } from "@/features/observe/ui";
import { memoryExportFile } from "@/lib/aiMemories";
import { useAuthStore } from "@/stores";
import { useMemoryMutations, useMyMemories, usePendingMemoryCount, useTeamMemories } from "./hooks";

const STATUS_LABEL: Record<MemoryStatus, string> = { active: "Approved", proposed: "Waiting for review", rejected: "Rejected" };
const STATUS_TONE = { active: "ok", proposed: "warn", rejected: "muted" } as const;

/** The note editor used to add and to edit: Enter in the field does not submit, the buttons do. */
function NoteEditor({ initial = "", placeholder, saveLabel, busy, onSave, onCancel }: {
  initial?: string;
  placeholder: string;
  saveLabel: string;
  busy: boolean;
  onSave: (content: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [text, setText] = useState(initial);
  const trimmed = text.trim();
  const valid = trimmed.length >= 3 && trimmed.length <= MEMORY_MAX_CHARS;
  return (
    <div className="space-y-2">
      <Textarea
        autoFocus
        className={`${TEXTAREA_CLASS} min-h-[72px] font-sans`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={MEMORY_MAX_CHARS}
        aria-label="Memory note"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-paper-faint">{trimmed.length}/{MEMORY_MAX_CHARS}</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-8 rounded-xs text-[11px]" onClick={onCancel}>Cancel</Button>
          <Button type="button" className={`${DH_PRIMARY} h-8`} disabled={!valid || busy} onClick={() => onSave(trimmed)}>
            <Check className="h-3.5 w-3.5" /> {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function sourceLabel(memory: AiMemory): string {
  if (memory.source === "person") return memory.scope === "user" ? "Added by you" : `Added by ${memory.proposedByName ?? "a deleted user"}`;
  const by = memory.scope === "connection" ? ` for ${memory.proposedByName ?? "a deleted user"}` : "";
  return `Kept by ${memory.agentSlug ?? "an agent"}${by}`;
}

function MyMemoriesPanel(): ReactElement {
  const mine = useMyMemories();
  const { create, update, remove, setEnabled } = useMemoryMutations();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const save = async (content: string): Promise<void> => {
    try {
      const saved = await create.mutateAsync({ scope: "user", content });
      toast.success(saved.duplicate ? "Already in your memory" : "Saved to your memory");
      setAdding(false);
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the memory"));
    }
  };

  const edit = async (id: string, content: string): Promise<void> => {
    try {
      await update.mutateAsync({ id, content });
      setEditing(null);
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the memory"));
    }
  };

  const destroy = async (id: string): Promise<void> => {
    try {
      await remove.mutateAsync(id);
      toast.success("Memory deleted");
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete the memory"));
    }
  };

  const toggle = async (enabled: boolean): Promise<void> => {
    try {
      await setEnabled.mutateAsync(enabled);
      toast.success(enabled ? "Memory is on" : "Memory is off: agents won't read or keep notes about you");
    } catch (error) {
      toast.error(errorMessage(error, "Could not change memory"));
    }
  };

  const download = async (): Promise<void> => {
    try {
      const body = await exportMyMemories();
      const file = memoryExportFile(body.exportedAt, body.memories);
      const url = URL.createObjectURL(new Blob([file.text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(errorMessage(error, "Could not export your memories"));
    }
  };

  const enabled = mine.data?.enabled ?? true;
  const rows = mine.data?.memories ?? [];

  return (
    <Panel
      title="Your memories"
      meta="Notes agents keep about you, such as preferences. Only you see them."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[11px] text-paper-muted">
            <Switch className={SWITCH_CLASS} checked={enabled} disabled={!mine.data || setEnabled.isPending} onCheckedChange={(v) => void toggle(v)} aria-label="Memory on" />
            Memory {enabled ? "on" : "off"}
          </label>
          <Button variant="outline" className="h-8 rounded-xs text-[11px]" disabled={rows.length === 0} onClick={() => void download()}>
            <Download className="mr-1 h-3 w-3" /> Export
          </Button>
          <Button className={DH_PRIMARY} onClick={() => setAdding(true)} disabled={adding} aria-label="Add memory"><Plus className="h-3.5 w-3.5" /> Add</Button>
        </div>
      }
    >
      {!enabled && (
        <p role="status" className="mb-3 rounded-xs border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] text-amber-500">
          Memory is off. Agents don't read these notes or keep new ones about you until you turn it back on.
        </p>
      )}
      {adding && (
        <div className="mb-3 rounded-xs border border-ink-500 p-3">
          <NoteEditor placeholder="e.g. Show timestamps in UTC and counts with thousands separators" saveLabel="Save" busy={create.isPending} onSave={(c) => void save(c)} onCancel={() => setAdding(false)} />
        </div>
      )}
      {mine.isLoading ? <LoadingGrid count={1} /> : mine.isError || !mine.data ? (
        <ErrorState title="Your memories could not be loaded." error={mine.error} />
      ) : rows.length === 0 ? (
        !adding && <EmptyState icon={Brain} title="No memories yet" body="Tell the assistant something to remember (“always use UTC”), or add a note here." />
      ) : (
        <DataTable label="Your memories" head={["Note", "Source", "Saved", ""]}>
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="w-full max-w-[560px]">
                {editing === m.id ? (
                  <NoteEditor initial={m.content} placeholder="" saveLabel="Save" busy={update.isPending} onSave={(c) => void edit(m.id, c)} onCancel={() => setEditing(null)} />
                ) : <span className="whitespace-pre-wrap break-words text-[12px] text-paper">{m.content}</span>}
              </td>
              <td className="whitespace-nowrap text-[11px] text-paper-muted">{sourceLabel(m)}</td>
              <td className="whitespace-nowrap text-[11px] text-paper-muted" title={new Date(m.createdAt).toLocaleString()}>{formatAgo(m.createdAt)}</td>
              <td className="whitespace-nowrap text-right">
                {editing !== m.id && (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" className="h-7 rounded-xs px-2" onClick={() => setEditing(m.id)} aria-label="Edit memory"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" className="h-7 rounded-xs px-2 text-red-400 hover:text-red-300" disabled={remove.isPending} onClick={() => void destroy(m.id)} aria-label="Delete memory"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </Panel>
  );
}

type TeamFilter = MemoryStatus | "all";
const TEAM_FILTERS: Array<{ value: TeamFilter; label: string }> = [
  { value: "active", label: "Approved" },
  { value: "proposed", label: "Waiting for review" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function TeamMemoriesPanel(): ReactElement {
  const connectionId = useAuthStore((s) => s.activeConnectionId);
  const [filter, setFilter] = useState<TeamFilter>("active");
  const team = useTeamMemories(null, filter === "all" ? null : filter);
  const pending = usePendingMemoryCount();
  const { create, update, remove, review } = useMemoryMutations();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const canManage = team.data?.canManage ?? false;
  const rows = team.data?.memories ?? [];
  const waiting = pending.data ?? 0;

  const save = async (content: string): Promise<void> => {
    if (!connectionId) return;
    try {
      const saved = await create.mutateAsync({ scope: "connection", content, connectionId });
      toast.success(saved.duplicate ? "The team already knows this" : saved.status === "active" ? "Team memory saved" : "Proposed: an admin reviews it before agents use it");
      setAdding(false);
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the team memory"));
    }
  };

  const decide = async (memory: AiMemory, approve: boolean): Promise<void> => {
    try {
      await review.mutateAsync({ id: memory.id, approve });
      toast.success(approve ? "Approved: agents use it from now on" : "Rejected");
    } catch (error) {
      toast.error(errorMessage(error, "Could not review the memory"));
    }
  };

  const edit = async (id: string, content: string): Promise<void> => {
    try {
      await update.mutateAsync({ id, content });
      setEditing(null);
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the memory"));
    }
  };

  const destroy = async (id: string): Promise<void> => {
    try {
      await remove.mutateAsync(id);
      toast.success("Team memory deleted");
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete the memory"));
    }
  };

  return (
    <Panel
      title="Team memories"
      meta={canManage ? "What agents know about each ClickHouse connection. You review new notes before agents use them." : "What agents know about your ClickHouse connections. Admins review new notes before agents use them."}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(TEAM_FILTERS.find((f) => f.value === v)?.value ?? "active")}>
            <SelectTrigger className="h-8 w-44 rounded-xs text-[11px]" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>{TEAM_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" className="h-8 rounded-xs text-[11px]" disabled={!connectionId || adding} title={connectionId ? undefined : "Pick a connection first"} onClick={() => setAdding(true)} aria-label={canManage ? "Add team memory" : "Propose team memory"}>
            <Plus className="mr-1 h-3 w-3" /> {canManage ? "Add" : "Propose"}
          </Button>
        </div>
      }
    >
      {canManage && waiting > 0 && filter !== "proposed" && (
        <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xs border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] text-amber-500">
          <span>{waiting} team {waiting === 1 ? "note waits" : "notes wait"} for your review.</span>
          <Button variant="outline" className="h-7 rounded-xs border-amber-500/40 text-[11px] text-amber-500 hover:bg-amber-500/10 hover:text-amber-500" onClick={() => setFilter("proposed")}>Review</Button>
        </div>
      )}
      {adding && (
        <div className="mb-3 rounded-xs border border-ink-500 p-3">
          <NoteEditor placeholder="e.g. events.ts is stored in UTC; orders_v1 is deprecated, use orders" saveLabel={canManage ? "Save" : "Propose"} busy={create.isPending} onSave={(c) => void save(c)} onCancel={() => setAdding(false)} />
          <p className="mt-2 text-[11px] text-paper-faint">For the connection you have open now. Don't add personal data or secrets.</p>
        </div>
      )}
      {team.isLoading ? <LoadingGrid count={1} /> : team.isError || !team.data ? (
        <ErrorState title="Team memories could not be loaded." error={team.error} />
      ) : rows.length === 0 ? (
        !adding && <EmptyState icon={Users} title={filter === "proposed" ? "Nothing waits for review" : "No team memories here"} body="Agents propose team notes when they learn something about a connection that helps everyone; so can you." />
      ) : (
        <DataTable label="Team memories" head={["Note", "Connection", "Source", "Status", ""]}>
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="w-full max-w-[520px]">
                {editing === m.id ? (
                  <NoteEditor initial={m.content} placeholder="" saveLabel="Save" busy={update.isPending} onSave={(c) => void edit(m.id, c)} onCancel={() => setEditing(null)} />
                ) : (
                  <>
                    <span className="whitespace-pre-wrap break-words text-[12px] text-paper">{m.content}</span>
                    {m.flag && <span className="mt-1 flex items-center gap-1 text-[11px] text-amber-500"><AlertTriangle className="h-3 w-3" aria-hidden /> {m.flag}: check it holds no personal data or secrets</span>}
                  </>
                )}
              </td>
              <td className="whitespace-nowrap text-[11px] text-paper-muted">{m.connectionName ?? "—"}</td>
              <td className="whitespace-nowrap text-[11px] text-paper-muted">{sourceLabel(m)}<span className="block text-[10px] text-paper-faint">{formatAgo(m.createdAt)}</span></td>
              <td>
                <StatusPill tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</StatusPill>
                {m.decidedByName && <span className="mt-0.5 block text-[10px] text-paper-faint">by {m.decidedByName}</span>}
              </td>
              <td className="whitespace-nowrap text-right">
                {editing !== m.id && (
                  <div className="flex justify-end gap-1">
                    {canManage && m.status === "proposed" && (
                      <>
                        <Button variant="ghost" className="h-7 rounded-xs px-2 text-[11px] text-red-400 hover:text-red-300" disabled={review.isPending} onClick={() => void decide(m, false)} aria-label="Reject memory">
                          <X className="mr-1 h-3 w-3" /> Reject
                        </Button>
                        <Button className="h-7 gap-1 rounded-xs bg-brand px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft" disabled={review.isPending} onClick={() => void decide(m, true)} aria-label="Approve memory">
                          <Check className="h-3 w-3" /> Approve
                        </Button>
                      </>
                    )}
                    {m.canEdit && (
                      <>
                        <Button variant="ghost" className="h-7 rounded-xs px-2" onClick={() => setEditing(m.id)} aria-label="Edit memory"><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" className="h-7 rounded-xs px-2 text-red-400 hover:text-red-300" disabled={remove.isPending} onClick={() => void destroy(m.id)} aria-label="Delete memory"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </Panel>
  );
}

export function MemoriesPanel(): ReactElement {
  return (
    <div className="space-y-4">
      <MyMemoriesPanel />
      <TeamMemoriesPanel />
    </div>
  );
}
