/**
 * What a click on a panel offers (ADR 0023 §5, §6, §9): the panel's drill-down
 * links, the queries in that bucket, a note at that time, and on a selected
 * range Zoom and Explain this spike. Annotation details, and the note editor.
 */

import React, { useState } from "react";
import { ExternalLink, Filter, MapPin, Search, Sparkles, StickyNote, Trash2, ZoomIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { AnnotationEvent, ChartPanelInput } from "@/api/dashboards";
import { BTN_OUTLINE, BTN_PRIMARY, TEXTAREA } from "@/components/charts/controlStyles";

import { ANNOTATION_COLORS, ANNOTATION_LABELS } from "../overlays";
import type { TimeSpan } from "./PanelCard";

const MAX_NOTE = 500;

function when(span: TimeSpan): string {
  const from = new Date(span.fromMs);
  const to = new Date(span.toMs);
  return `${from.toLocaleString()} – ${to.toLocaleTimeString()}`;
}

function Action({ icon, label, detail, onClick }: { icon: React.ReactNode; label: string; detail?: string; onClick: () => void }): React.ReactElement {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xs px-3 py-2 text-left text-sm text-paper hover:bg-ink-200">
      <span className="text-paper-dim">{icon}</span>
      <span className="flex-1">{label}</span>
      {detail && <span className="font-mono text-[10px] text-paper-faint">{detail}</span>}
    </button>
  );
}

export type ChartActionsTarget =
  | { kind: "datum"; panel: ChartPanelInput; row: Record<string, unknown>; bucket: TimeSpan | null }
  | { kind: "range"; panel: ChartPanelInput; span: TimeSpan };

interface ChartActionsProps {
  target: ChartActionsTarget;
  canNote: boolean;
  canExplain: boolean;
  onClose: () => void;
  onLink: (index: number) => void;
  onQueries: (span: TimeSpan) => void;
  onNote: (atMs: number) => void;
  onZoom: (span: TimeSpan) => void;
  onExplain: (span: TimeSpan) => void;
}

export function ChartActionsDialog({ target, canNote, canExplain, onClose, onLink, onQueries, onNote, onZoom, onExplain }: ChartActionsProps): React.ReactElement {
  const span = target.kind === "range" ? target.span : target.bucket;
  const links = target.kind === "datum" ? target.panel.viz.links : [];
  const x = target.kind === "datum" && target.panel.viz.x ? target.row[target.panel.viz.x] : null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{target.panel.title}</DialogTitle>
          <DialogDescription>
            {target.kind === "range" ? `Selected ${when(target.span)}` : span ? `Bucket ${when(span)}` : x !== null && x !== undefined ? `${target.panel.viz.x} = ${String(x)}` : "The clicked row"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col" data-testid="chart-actions">
          {target.kind === "range" && canExplain && <Action icon={<Sparkles className="h-4 w-4" />} label="Explain this spike" detail="AI" onClick={() => onExplain(target.span)} />}
          {target.kind === "range" && <Action icon={<ZoomIn className="h-4 w-4" />} label="Zoom to this range" onClick={() => onZoom(target.span)} />}
          {links.map((link, i) => (
            <Action
              key={`${link.kind}-${i}`}
              icon={link.kind === "filter" ? <Filter className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
              label={link.label}
              detail={link.kind === "dashboard" ? "dashboard" : link.kind === "filter" ? `sets ${link.variable}` : "Explorer"}
              onClick={() => onLink(i)}
            />
          ))}
          {span && <Action icon={<Search className="h-4 w-4" />} label={target.kind === "range" ? "Queries in this range" : "Queries in this bucket"} detail="query_log" onClick={() => onQueries(span)} />}
          {span && canNote && <Action icon={<StickyNote className="h-4 w-4" />} label="Add a note here" onClick={() => onNote(span.fromMs)} />}
          {links.length === 0 && !span && <p className="px-3 py-2 text-xs text-paper-faint">This panel has no links. Add them in the panel's chart settings.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface AnnotationProps {
  event: AnnotationEvent;
  canDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
  onClose: () => void;
}

export function AnnotationDialog({ event, canDelete, deleting, onDelete, onClose }: AnnotationProps): React.ReactElement {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4" style={{ color: ANNOTATION_COLORS[event.source] }} aria-hidden />
            {ANNOTATION_LABELS[event.source]}
          </DialogTitle>
          <DialogDescription>{new Date(event.at).toLocaleString()}{event.authorName ? ` · ${event.authorName}` : ""}{event.objectRef ? ` · ${event.objectRef}` : ""}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-paper">{event.title}</p>
        {event.detail && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-200 p-2 font-mono text-[11px] text-paper-muted">{event.detail}</pre>}
        {canDelete && (
          <DialogFooter>
            <Button variant="outline" className={BTN_OUTLINE} onClick={onDelete} disabled={deleting}><Trash2 className="mr-1.5 h-3.5 w-3.5" /> {deleting ? "Deleting…" : "Delete note"}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface NoteProps {
  atMs: number;
  saving: boolean;
  error: string | null;
  onSave: (text: string) => void;
  onClose: () => void;
}

export function NoteDialog({ atMs, saving, error, onSave, onClose }: NoteProps): React.ReactElement {
  const [text, setText] = useState("");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a note</DialogTitle>
          <DialogDescription>At {new Date(atMs).toLocaleString()}, on this connection. Everyone who can view the dashboard sees it on its time charts.</DialogDescription>
        </DialogHeader>
        <Textarea className={TEXTAREA} rows={4} maxLength={MAX_NOTE} value={text} onChange={(e) => setText(e.target.value)} aria-label="Note" placeholder="Backfill of 2025 orders started" />
        <span className="text-right font-mono text-[10px] text-paper-faint">{text.length} / {MAX_NOTE}</span>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        <DialogFooter>
          <Button variant="outline" className={BTN_OUTLINE} onClick={onClose}>Cancel</Button>
          <Button className={BTN_PRIMARY} onClick={() => onSave(text.trim())} disabled={saving || text.trim() === ""}>{saving ? "Saving…" : "Add note"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
