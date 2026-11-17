/**
 * The General tab of the connection panel: name, environment, active and
 * default, and the connection's collection schedule and remediation login.
 * It saves on its own and never sends a login field. While creating it only
 * holds the name and environment, which Create on the ClickHouse login tab
 * sends.
 */

import { useEffect, useState, type MutableRefObject, type ReactElement } from "react";
import { ArrowRight, Check, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/client";
import { rbacConnectionsApi, type ClickHouseConnection } from "@/api/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ConnectionObservability } from "@/features/observe/ConnectionObservability";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";
import { ERROR_CLASS, HELP_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./formStyles";
import {
  ENVIRONMENT_OPTIONS,
  generalPatch,
  isEnvironmentChoice,
  isGeneralDirty,
  nameProblem,
  type GeneralDraft,
} from "./loginForm";
import { errorMessage, Note } from "./panelParts";

interface GeneralTabProps {
  /** Null while creating. */
  connection: ClickHouseConnection | null;
  draft: GeneralDraft;
  baseline: GeneralDraft;
  onDraftChange: (patch: Partial<GeneralDraft>) => void;
  /** Set by Create when the name is missing. */
  nameError: string | null;
  saveRef: MutableRefObject<(() => Promise<boolean>) | null>;
  /** Saved: reload the connection. */
  onSaved: () => Promise<void>;
  onClose: () => void;
  /** Create mode: go on to the ClickHouse login tab. */
  onNext: () => void;
}

export function GeneralTab({ connection, draft, baseline, onDraftChange, nameError, saveRef, onSaved, onClose, onNext }: GeneralTabProps): ReactElement {
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const creating = connection === null;
  const shownNameError = formError === null ? nameError : null;

  const edit = (patch: Partial<GeneralDraft>): void => {
    onDraftChange(patch);
    setFormError(null);
    if (patch.isDefault !== undefined) setDefaultError(null);
  };

  const save = async (): Promise<boolean> => {
    if (connection === null) return true;
    const problem = nameProblem(draft.name);
    if (problem) {
      setFormError(problem);
      return false;
    }
    if (!isGeneralDirty(draft, baseline)) return true;
    setBusy(true);
    setFormError(null);
    setDefaultError(null);
    try {
      await rbacConnectionsApi.update(connection.id, generalPatch(draft, connection));
      toast.success("Connection saved");
      await onSaved();
      return true;
    } catch (error) {
      const message = errorMessage(error, "Save failed");
      if (error instanceof ApiError && error.code === "CONNECTION_NOT_READY") {
        setDefaultError(message);
      } else if (error instanceof ApiError && error.code === "CONNECTION_CHANGED") {
        setChanged(true);
      } else {
        log.error("[ConnectionPanel] Saving General failed", { errorMessage: message });
        setFormError(message);
      }
      toast.error("Couldn't save the connection", { description: message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  // The panel saves the tab being left with "Save and go".
  useEffect(() => {
    saveRef.current = save;
    return () => {
      if (saveRef.current === save) saveRef.current = null;
    };
  });

  const reload = async (): Promise<void> => {
    setChanged(false);
    await onSaved();
  };

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (creating) onNext();
        else void save();
      }}
    >
      {changed && (
        <Note tone="bad" title="This connection was changed by someone else">
          <p>Reload it to see the change, then make yours again.</p>
          <Button type="button" variant="outline" onClick={() => void reload()} className={cn(SECONDARY_BUTTON_CLASS, "h-7 self-start px-2")}>
            <RefreshCw className="h-3 w-3" aria-hidden />
            Reload
          </Button>
        </Note>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="general-name" className={LABEL_CLASS}>Name</Label>
          <Input
            id="general-name"
            value={draft.name}
            onChange={(event) => edit({ name: event.target.value })}
            maxLength={255}
            placeholder="Production cluster"
            aria-invalid={shownNameError !== null || undefined}
            className={cn(INPUT_CLASS, shownNameError !== null && "border-red-500 dark:border-red-400")}
          />
          {shownNameError && <p role="alert" className={ERROR_CLASS}>{shownNameError}</p>}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="general-environment" className={LABEL_CLASS}>Environment</Label>
          <Select value={draft.environment} onValueChange={(value) => { if (isEnvironmentChoice(value)) edit({ environment: value }); }}>
            <SelectTrigger id="general-environment" className={INPUT_CLASS} aria-label="Environment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENVIRONMENT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className={cn(HELP_CLASS, "-mt-3 leading-[1.5]")}>
        On a production connection, AI changes are checked one step harder: undoable changes ask first, and changes that ask once need a second approver.
      </p>

      {!creating && (
        <>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="general-active" className={LABEL_CLASS}>Active</Label>
            <Switch id="general-active" checked={draft.isActive} onCheckedChange={(checked) => edit({ isActive: checked })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="general-default" className={LABEL_CLASS}>Default connection</Label>
              <Switch id="general-default" checked={draft.isDefault} onCheckedChange={(checked) => edit({ isDefault: checked })} />
            </div>
            {defaultError ? (
              <p role="alert" className={ERROR_CLASS}>{defaultError}</p>
            ) : (
              <p className={cn(HELP_CLASS, "leading-[1.5]")}>A connection that isn't ready can't be made the default: people would land on a refusal.</p>
            )}
          </div>
          <ConnectionObservability connectionId={connection.id} />
        </>
      )}

      {formError && <p role="alert" className={ERROR_CLASS}>{formError}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-500 pt-4">
        <Button type="button" variant="outline" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
          Close
        </Button>
        {creating ? (
          <Button type="submit" className={PRIMARY_BUTTON_CLASS}>
            Next: ClickHouse login
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : (
          <Button type="submit" disabled={busy || !isGeneralDirty(draft, baseline)} className={PRIMARY_BUTTON_CLASS}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
            Save general
          </Button>
        )}
      </div>
    </form>
  );
}
