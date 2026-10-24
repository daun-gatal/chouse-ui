/**
 * AI Governance › Assistant › Chobi (ADR 0025 §6): the organization's choices
 * for Chobi — the character or the plain logo, and whether Chobi may point
 * out news on its own. Each user can still mute nudges for themselves.
 */

import type { ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { updateChobiSettings, type ChobiSettings } from "@/api/chobi";
import { Switch } from "@/components/ui/switch";
import { Mascot } from "@/features/buddy/Mascot";
import { chobiKeys, useChobiSettings } from "@/features/buddy/hooks";
import { ErrorState, LoadingGrid, Panel } from "@/features/observe/ui";
import { errorMessage } from "./shared";

export function ChobiSettingsView({ canManage }: { canManage: boolean }): ReactElement {
  const settings = useChobiSettings(true);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (update: Partial<Pick<ChobiSettings, "plainMode" | "nudges">>) => updateChobiSettings(update),
    onSuccess: (saved) => {
      client.setQueryData(chobiKeys.settings(), saved);
      toast.success("Chobi settings saved");
    },
    onError: (error) => toast.error(errorMessage(error, "Could not save the Chobi settings")),
  });

  if (settings.isLoading) return <LoadingGrid count={1} />;
  if (settings.isError || !settings.data) return <ErrorState title="Chobi settings could not be loaded." error={settings.error} />;
  const { plainMode, nudges } = settings.data;

  return (
    <Panel title="Chobi" meta={canManage ? "For everyone in this organization" : "Changing these needs ai_agents:manage"}>
      <div className="space-y-4">
        <Row
          title="Character"
          body="Chobi appears as the CHouse character, with moods. Plain mode shows the CHouse logo instead."
          preview={<Mascot mood="idle" plain={plainMode} size={36} />}
        >
          <label className="flex items-center gap-2 text-[12px] text-paper-muted">
            Plain mode
            <Switch checked={plainMode} disabled={!canManage || save.isPending} onCheckedChange={(value) => save.mutate({ plainMode: value })} aria-label="Plain mode" />
          </label>
        </Row>
        <Row
          title="Nudges"
          body="Chobi points out new incidents, failures and approvals waiting for you — from data, never a model call, a few an hour at most. Each person can mute them."
        >
          <label className="flex items-center gap-2 text-[12px] text-paper-muted">
            Nudges
            <Switch checked={nudges} disabled={!canManage || save.isPending} onCheckedChange={(value) => save.mutate({ nudges: value })} aria-label="Nudges" />
          </label>
        </Row>
      </div>
    </Panel>
  );
}

function Row({ title, body, preview, children }: { title: string; body: string; preview?: ReactElement; children: ReactElement }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-500 pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-start gap-3">
        {preview}
        <div>
          <p className="text-[13px] font-medium text-paper">{title}</p>
          <p className="mt-0.5 max-w-xl text-[12px] text-paper-faint">{body}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
