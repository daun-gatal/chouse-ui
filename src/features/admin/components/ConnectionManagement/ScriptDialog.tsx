/**
 * The setup script for the ClickHouse administrator, built from the names in
 * the login form. It never carries the password, and CHouse never runs it.
 */

import { useState, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { identityKindLabel } from "@/api/connectionIdentity";
import { cn } from "@/lib/utils";
import { HELP_CLASS, SECONDARY_BUTTON_CLASS } from "./formStyles";
import { setupScript, type ScriptInput, type ScriptVariant } from "./loginForm";
import { KindBadge } from "./panelParts";
import { CopyButton } from "./PrivilegeReport";

interface ScriptDialogProps {
  open: boolean;
  onClose: () => void;
  /** Everything but the variant, which the dialog's toggle chooses. */
  script: Omit<ScriptInput, "variant">;
  /** Offer emptying the current user: only when that user has grants of its own (a shared login). */
  offerEmptyCurrent: boolean;
}

const VARIANTS: ReadonlyArray<{ value: ScriptVariant; label: string }> = [
  { value: "new_user", label: "New empty user" },
  { value: "empty_current", label: "Empty the current user" },
];

export function ScriptDialog({ open, onClose, script, offerEmptyCurrent }: ScriptDialogProps): ReactElement {
  const [variant, setVariant] = useState<ScriptVariant>("new_user");
  const chosen: ScriptVariant = offerEmptyCurrent ? variant : "new_user";
  const text = setupScript({ ...script, variant: chosen }).join("\n");

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-xs border-ink-500 bg-ink-100 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="text-paper">Script for the ClickHouse admin</DialogTitle>
          <DialogDescription className="text-[12px] text-paper-muted">
            Built from the names in the form. The password is never put in the script; CHouse never runs it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {offerEmptyCurrent ? (
              <div role="radiogroup" aria-label="Script for" className="flex flex-wrap gap-2">
                {VARIANTS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={chosen === option.value}
                    onClick={() => setVariant(option.value)}
                    className={cn(SECONDARY_BUTTON_CLASS, "inline-flex h-8 items-center border", chosen === option.value ? "border-brand" : "border-ink-500")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : <span />}
            <KindBadge label={identityKindLabel(script.kind)} />
          </div>
          {offerEmptyCurrent && chosen === "empty_current" && (
            <p role="note" className="text-[12px] leading-[1.5] text-amber-800 dark:text-amber-200">
              Queries on this connection fail from the moment these statements run until you save the new kind.
            </p>
          )}
          <pre aria-label="Setup script" className="min-w-0 overflow-x-auto whitespace-pre rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5 font-mono text-[11px] leading-[1.6] text-paper">{text}</pre>
          <p className={cn(HELP_CLASS, "leading-[1.5]")}>
            Lines starting with -- are for the administrator to fill in: the data each role may reach.
          </p>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
            Close
          </Button>
          <CopyButton text={text} label="Copy script" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
