/**
 * Edit a text or heading panel (ADR 0023 §1). Text panels hold Markdown, shown
 * as it will render; headings a title and a short description. Their place
 * and size are set on the canvas.
 */

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { HeadingPanelInput, TextPanelInput } from "@/api/dashboards";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, FIELD_LABEL, TEXTAREA } from "@/components/charts/controlStyles";

const MAX_MARKDOWN = 10_000;

interface Props<T extends TextPanelInput | HeadingPanelInput> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: T;
  onSave: (panel: T) => void;
}

export function TextPanelDialog<T extends TextPanelInput | HeadingPanelInput>({ open, onOpenChange, initial, onSave }: Props<T>): React.ReactElement {
  const [draft, setDraft] = useState<T>(initial);
  const isText = draft.kind === "text";
  const body = draft.kind === "text" ? draft.markdown : draft.description;
  const invalid = isText ? body.trim() === "" : draft.title.trim() === "";

  const save = (): void => {
    const trimmed = draft.kind === "text"
      ? { ...draft, title: draft.title.trim(), markdown: draft.markdown.trim() }
      : { ...draft, title: draft.title.trim(), description: draft.description.trim() };
    onSave(trimmed as T);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial.id ? `Edit ${isText ? "text" : "heading"}` : `New ${isText ? "text" : "heading"}`}</DialogTitle>
          <DialogDescription>
            {isText ? "Notes and runbooks next to the charts, in Markdown. Links open in a new tab." : "A heading starts a section of the dashboard."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>{isText ? "Title (optional)" : "Title"}</span>
            <Input className={FIELD} value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          {draft.kind === "text" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={FIELD_LABEL}>Markdown</span>
                <Textarea className={TEXTAREA} rows={12} maxLength={MAX_MARKDOWN} value={draft.markdown} onChange={(e) => setDraft({ ...draft, markdown: e.target.value })} aria-label="Markdown" />
                <span className="text-right font-mono text-[10px] text-paper-faint">{draft.markdown.length.toLocaleString("en-US")} / {MAX_MARKDOWN.toLocaleString("en-US")}</span>
              </label>
              <div className="flex flex-col gap-1">
                <span className={FIELD_LABEL}>Preview</span>
                <div className="markdown-panel min-h-48 rounded-xs border border-ink-500 bg-ink-100 p-3 text-sm leading-relaxed text-paper-muted" data-testid="markdown-preview">
                  {draft.markdown.trim() === "" ? <span className="text-paper-faint">Nothing to show yet</span> : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-yellow-300 underline underline-offset-2">{children}</a> }}>
                      {draft.markdown}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Description (optional)</span>
              <Input className={FIELD} value={draft.description} maxLength={500} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" className={BTN_OUTLINE} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className={BTN_PRIMARY} onClick={save} disabled={invalid}>{initial.id ? "Update" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
