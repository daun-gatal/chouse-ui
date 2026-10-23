/**
 * Dashboards › Ask AI › the review's header: the dashboard's title, the
 * status counts (each filters the list), and the actions. Wide screens show
 * every action; narrower ones keep the main one and move the rest into a ⋯
 * menu, and phones put the main one in a bar at the bottom (PrimaryAction).
 * Refine opens beside its button on wide screens and from the bottom
 * elsewhere, so the keyboard does not cover it.
 */

import React, { useState } from "react";
import { Loader2, MoreHorizontal, Sparkles, Undo2, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { MAX_FEEDBACK_LENGTH, type DraftPanelStatus } from "@/api/dashboards";
import { BTN_GHOST, BTN_ICON, BTN_OUTLINE, BTN_PRIMARY, FIELD, TEXTAREA } from "@/components/charts/controlStyles";
import { cn } from "@/lib/utils";

import type { StatusCounts } from "../askAi";
import { STATUS } from "./AskAiPanelList";

export type ReviewLayout = "wide" | "tablet" | "phone";

export interface PrimaryProps {
  label: string;
  onClick: () => void;
  /** Why it cannot be pressed (null when it can), shown as text. */
  disabledReason: string | null;
  pending: boolean;
  /** An AI request is running: the draft may still change. */
  locked: boolean;
  /** Some included panels need a look: pressing asks first. */
  warn: boolean;
}

export interface RefineProps {
  text: string;
  onText: (text: string) => void;
  onSubmit: () => void;
  /** Why the AI cannot be asked now (null when it can). */
  blocked: string | null;
}

interface Props {
  layout: ReviewLayout;
  /** Adding to this dashboard; null when the draft is a new one. */
  existingTitle: string | null;
  title: string;
  onTitle: (title: string) => void;
  counts: StatusCounts;
  onFilter: (status: DraftPanelStatus) => void;
  fixes: number;
  onApplyFixes: () => void;
  canUndo: boolean;
  onUndo: () => void;
  onStartOver: () => void;
  refine: RefineProps;
  primary: PrimaryProps;
  /** An AI request or a save is running: nothing can change. */
  locked: boolean;
}

export function PrimaryAction({ primary, className }: { primary: PrimaryProps; className?: string }): React.ReactElement {
  return (
    <Button
      className={cn(BTN_PRIMARY, "min-h-9", className)}
      onClick={primary.onClick}
      disabled={primary.disabledReason !== null || primary.pending || primary.locked}
      aria-describedby={primary.disabledReason ? "ask-ai-primary-reason" : undefined}
      data-testid="primary-action"
    >
      {primary.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : primary.warn ? <STATUS.attention.icon className="h-3.5 w-3.5" aria-label="Some included panels need a look" /> : null}
      {primary.label}
    </Button>
  );
}

function RefineForm({ refine, onDone }: { refine: RefineProps; onDone: () => void }): React.ReactElement {
  const submit = (): void => {
    refine.onSubmit();
    onDone();
  };
  const ready = refine.text.trim().length >= 3 && refine.blocked === null;
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        className={TEXTAREA}
        value={refine.text}
        onChange={(e) => refine.onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) {
            e.preventDefault();
            submit();
          }
        }}
        rows={4}
        maxLength={MAX_FEEDBACK_LENGTH}
        placeholder="Drop the merge panels and add disk usage per shard"
        aria-label="What should change in the draft?"
        autoFocus
      />
      {refine.blocked && <p className="text-[11px] text-amber-300">{refine.blocked}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-paper-faint">The current draft is kept until the new one is ready; you can undo it.</span>
        <Button className={cn(BTN_PRIMARY, "min-h-9 shrink-0")} onClick={submit} disabled={!ready}><Wand2 className="h-3.5 w-3.5" aria-hidden /> Refine</Button>
      </div>
    </div>
  );
}

export function AskAiHeader({ layout, existingTitle, title, onTitle, counts, onFilter, fixes, onApplyFixes, canUndo, onUndo, onStartOver, refine, primary, locked }: Props): React.ReactElement {
  const [refineOpen, setRefineOpen] = useState(false);
  const wide = layout === "wide";
  const statuses: DraftPanelStatus[] = ["ok", "attention", "blocked"];

  return (
    <header className="flex shrink-0 flex-col gap-1 border-b border-ink-500 py-2 pl-4 pr-12" data-testid="review-header">
      <div className="flex min-h-10 items-center gap-2">
        <Sparkles className="hidden h-4 w-4 shrink-0 text-paper-dim sm:block" aria-hidden />
        {existingTitle ? (
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-paper">Add panels to {existingTitle}</h2>
        ) : (
          <Input
            className={cn(FIELD, "min-w-0 flex-1 border-transparent bg-transparent text-sm font-semibold text-paper hover:border-ink-500 focus:border-ink-500")}
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            maxLength={200}
            aria-label="Dashboard title"
            disabled={locked}
          />
        )}
        <div className="flex shrink-0 items-center gap-1" aria-label="Panels by status">
          {statuses.filter((s) => counts[s] > 0).map((s) => {
            const Icon = STATUS[s].icon;
            return (
              <button key={s} type="button" onClick={() => onFilter(s)} className={cn("flex min-h-8 items-center gap-1 rounded-xs px-1.5 font-mono text-[11px]", STATUS[s].className, "hover:bg-ink-200")} aria-label={`${counts[s]} ${STATUS[s].label.toLowerCase()}: show them`}>
                <Icon className="h-3.5 w-3.5" aria-hidden /> {counts[s]}
              </button>
            );
          })}
        </div>
        {wide ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {canUndo && <Button variant="ghost" className={BTN_GHOST} onClick={onUndo} disabled={locked}><Undo2 className="h-3.5 w-3.5" aria-hidden /> Undo</Button>}
            {fixes > 0 && <Button variant="outline" className={BTN_OUTLINE} onClick={onApplyFixes} disabled={locked}>Apply {fixes} fix{fixes === 1 ? "" : "es"}</Button>}
            <Popover open={refineOpen} onOpenChange={setRefineOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className={BTN_OUTLINE} disabled={locked}><Wand2 className="h-3.5 w-3.5" aria-hidden /> Refine…</Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[420px] max-w-[calc(100vw-2rem)]">
                <RefineForm refine={refine} onDone={() => setRefineOpen(false)} />
              </PopoverContent>
            </Popover>
            <Button variant="ghost" className={BTN_GHOST} onClick={onStartOver} disabled={locked}>Start over</Button>
            <PrimaryAction primary={primary} />
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className={cn(BTN_ICON, "h-9 w-9")} aria-label="More actions" disabled={locked}><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {fixes > 0 && <DropdownMenuItem onClick={onApplyFixes}>Apply {fixes} fix{fixes === 1 ? "" : "es"}</DropdownMenuItem>}
                <DropdownMenuItem onClick={() => setRefineOpen(true)}><Wand2 className="mr-2 h-3.5 w-3.5" /> Refine…</DropdownMenuItem>
                {canUndo && <DropdownMenuItem onClick={onUndo}><Undo2 className="mr-2 h-3.5 w-3.5" /> Undo</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onStartOver}>Start over</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {layout === "tablet" && <PrimaryAction primary={primary} />}
          </div>
        )}
      </div>
      {primary.disabledReason && layout !== "phone" && <p id="ask-ai-primary-reason" className="text-right text-[11px] text-amber-300">{primary.disabledReason}</p>}
      {!wide && (
        <Sheet open={refineOpen} onOpenChange={setRefineOpen}>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
            <SheetHeader className="text-left">
              <SheetTitle>Refine the draft</SheetTitle>
              <SheetDescription>Say what to change. The AI revises this draft instead of starting over.</SheetDescription>
            </SheetHeader>
            <div className="mt-3"><RefineForm refine={refine} onDone={() => setRefineOpen(false)} /></div>
          </SheetContent>
        </Sheet>
      )}
    </header>
  );
}
