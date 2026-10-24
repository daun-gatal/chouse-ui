import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Download, NotebookPen, Send } from "lucide-react";

import { getAiActivity } from "@/api/aiActions";
import { listChannels, postChannelMessage } from "@/api/alerting";
import { addCell, ensureNotebook } from "@/api/notebooks";
import { listIncidents } from "@/api/observe";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { handoffMarkdown, handoffMessage, type HandoffAction, type HandoffMessage } from "@/lib/chobiHandoff";
import { log } from "@/lib/log";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";

interface HandoffDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  messages: HandoffMessage[];
  /** Action ids the conversation ran, filed or proposed. */
  actionIds: string[];
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Hand a conversation to someone else (ADR 0025 §6): into an incident's
 * notebook — readable by whoever can see the incident — as a Markdown file,
 * or as a short post to an alert channel. Built from the conversation itself.
 */
export function HandoffDialog({ open, onClose, title, messages, actionIds }: HandoffDialogProps): React.JSX.Element {
  const connection = useAuthStore((s) => s.activeConnectionName ?? null);
  const can = useRbacStore((s) => s.hasPermission);
  const mayNotebook = can(RBAC_PERMISSIONS.NOTEBOOKS_EDIT) && (can(RBAC_PERMISSIONS.OBSERVE_VIEW) || can(RBAC_PERMISSIONS.DATA_HEALTH_VIEW));
  const mayPost = can(RBAC_PERMISSIONS.ALERTING_EDIT);

  const actions = useQuery({ queryKey: ["chobi", "handoff", "actions", actionIds], queryFn: () => getAiActivity({ ids: actionIds }), enabled: open && actionIds.length > 0 });
  const incidents = useQuery({ queryKey: ["chobi", "handoff", "incidents"], queryFn: () => listIncidents(), enabled: open && mayNotebook });
  const channels = useQuery({ queryKey: ["chobi", "handoff", "channels"], queryFn: listChannels, enabled: open && mayPost });

  const input = useMemo(() => {
    const done: HandoffAction[] = (actions.data ?? []).map((a) => ({ title: a.title, description: a.description, status: a.status, undone: a.undoneAt !== null }));
    return { title, connection, at: new Date(), messages, actions: done };
  }, [actions.data, connection, messages, title]);
  const markdown = useMemo(() => handoffMarkdown(input), [input]);

  const [incident, setIncident] = useState("");
  const [channel, setChannel] = useState("");
  const [confirmPost, setConfirmPost] = useState(false);
  const [busy, setBusy] = useState<"notebook" | "post" | null>(null);

  const toNotebook = async (): Promise<void> => {
    const target = incidents.data?.find((i) => `${i.source}:${i.id}` === incident);
    if (!target) return;
    setBusy("notebook");
    try {
      const { notebook } = await ensureNotebook(target.source === "data_health" ? "incident_data_health" : "incident_observe", target.id, target.title);
      await addCell(notebook.id, { kind: "note", text: markdown });
      toast.success(`Added to the notebook of “${target.title}”`);
      onClose();
    } catch (error) {
      log.error("[Chobi] Handoff to notebook failed", error);
      toast.error(errorText(error, "Could not add to the notebook"));
    } finally {
      setBusy(null);
    }
  };

  const post = async (): Promise<void> => {
    if (!channel) return;
    if (!confirmPost) {
      setConfirmPost(true);
      return;
    }
    setBusy("post");
    try {
      const sent = await postChannelMessage(channel, handoffMessage(input));
      toast.success(`Posted to ${sent.channel}`);
      onClose();
    } catch (error) {
      log.error("[Chobi] Handoff post failed", error);
      toast.error(errorText(error, "Could not post to the channel"));
    } finally {
      setBusy(null);
      setConfirmPost(false);
    }
  };

  const download = (): void => {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `handoff-${title.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60) || "chobi"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success("Handoff copied");
    } catch {
      toast.error("Could not copy; download it instead");
    }
  };

  const enabledChannels = (channels.data ?? []).filter((c) => c.enabled);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl border-ink-500 bg-ink-100 text-paper">
        <DialogHeader>
          <DialogTitle>Hand off this conversation</DialogTitle>
          <DialogDescription>What was asked, where it landed and what changed — for whoever picks it up.</DialogDescription>
        </DialogHeader>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-sm border border-ink-500 bg-ink-50 p-3 font-mono text-[11px] text-paper-muted" data-testid="handoff-preview">{markdown}</pre>

        {mayNotebook && (
          <div className="flex items-center gap-2">
            <Select value={incident} onValueChange={setIncident}>
              <SelectTrigger className="h-8 flex-1 text-[12px]" aria-label="Incident"><SelectValue placeholder={incidents.isLoading ? "Loading incidents…" : (incidents.data?.length ?? 0) === 0 ? "No open incidents" : "An open incident…"} /></SelectTrigger>
              <SelectContent>
                {(incidents.data ?? []).map((i) => <SelectItem key={`${i.source}:${i.id}`} value={`${i.source}:${i.id}`}>{i.title}{i.connectionName ? ` · ${i.connectionName}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button className="h-8 gap-1.5 text-[12px]" disabled={!incident || busy !== null} onClick={() => void toNotebook()}>
              <NotebookPen className="h-3.5 w-3.5" /> Add to its notebook
            </Button>
          </div>
        )}

        {mayPost && (
          <div className="flex items-center gap-2">
            <Select value={channel} onValueChange={(v) => { setChannel(v); setConfirmPost(false); }}>
              <SelectTrigger className="h-8 flex-1 text-[12px]" aria-label="Alert channel"><SelectValue placeholder={enabledChannels.length === 0 ? "No alert channels" : "An alert channel…"} /></SelectTrigger>
              <SelectContent>
                {enabledChannels.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.type}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant={confirmPost ? "destructive" : "outline"} className="h-8 gap-1.5 text-[12px]" disabled={!channel || busy !== null} onClick={() => void post()}>
              <Send className="h-3.5 w-3.5" /> {confirmPost ? "Post — it reaches people" : "Post a summary"}
            </Button>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-ink-500 pt-3">
          <Button variant="ghost" className="h-8 gap-1.5 text-[12px]" onClick={() => void copy()}><Copy className="h-3.5 w-3.5" /> Copy</Button>
          <Button variant="ghost" className="h-8 gap-1.5 text-[12px]" onClick={download}><Download className="h-3.5 w-3.5" /> Download .md</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
