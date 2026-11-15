/**
 * The signed-in person's ClickHouse links (ADR 0033): on a personal
 * connection their statements run as the ClickHouse user their account is
 * linked to. Only a super admin makes or removes a link; here a person sees
 * theirs and can ask CHouse to check one again.
 */

import type { ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RefreshCw, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MONO_FAINT, SettingCard } from "@/pages/Preferences";
import { bindingStateLabel, canRecheckBinding, recheckBinding, type BindingState, type OwnBinding } from "@/api/clickhouseBindings";
import { IDENTITY_MODE_PERSONAL } from "@/api/connectionIdentity";
import { myClickHouseLinksKey, useMyClickHouseLinks } from "@/hooks/useMyClickHouseLinks";
import { useRbacStore } from "@/stores";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";

const STATE_CLASS: Record<BindingState, string> = {
  active: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  pending_grant: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  suspended: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  disabled: "border-red-500/40 text-red-700 dark:text-red-300",
};

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

interface LinkRowProps {
  link: OwnBinding;
  checking: boolean;
  disabled: boolean;
  onRecheck: () => void;
}

function LinkRow({ link, checking, disabled, onRecheck }: LinkRowProps): ReactElement {
  const connection = link.connectionName ?? "A connection that was removed";
  return (
    <li className="flex flex-col gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words text-[13px] font-medium text-paper">{connection}</span>
          <span className={cn("inline-flex shrink-0 items-center rounded-xs border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]", STATE_CLASS[link.state])}>
            {bindingStateLabel(link.state)}
          </span>
        </div>
        <p className="break-words text-[12px] text-paper-muted">
          Runs as <span className="font-mono text-paper">{link.clickhouseUser}</span>
          {link.defaultDatabase ? (
            <>
              {" "}· default database <span className="font-mono text-paper">{link.defaultDatabase}</span>
            </>
          ) : null}
        </p>
        {link.reason && <p className="break-words text-[12px] leading-[1.5] text-paper-muted">{link.reason}</p>}
        {link.connectionKind !== IDENTITY_MODE_PERSONAL && (
          <p className={MONO_FAINT}>Not in use until this connection is switched to Personal</p>
        )}
      </div>
      {canRecheckBinding(link.state) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 self-start text-[12px] sm:self-center"
          onClick={onRecheck}
          disabled={disabled}
          aria-label={`Check again: ${connection}`}
        >
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          Check again
        </Button>
      )}
    </li>
  );
}

export function ClickHouseLinksCard(): ReactElement | null {
  const queryClient = useQueryClient();
  const userId = useRbacStore((state) => state.user?.id);
  const { data } = useMyClickHouseLinks();

  const recheck = useMutation({
    mutationFn: (id: string) => recheckBinding(id),
    onSuccess: (link) => {
      void queryClient.invalidateQueries({ queryKey: myClickHouseLinksKey(userId) });
      if (link.state === "active") toast.success(`Your link runs as ${link.clickhouseUser}`);
      else toast.warning(bindingStateLabel(link.state), { description: link.reason ?? undefined });
    },
    onError: (error) => {
      log.error("[ClickHouseLinksCard] Failed to check a link", { errorMessage: errMessage(error) });
      toast.error("Couldn't check the link", { description: errMessage(error) });
    },
  });

  // Most people have no link: no card rather than an empty one. A failed read is the same, the selector already says what it can.
  if (!data || data.length === 0) return null;

  return (
    <SettingCard title="ClickHouse user" description="Who your statements run as on personal connections" icon={UserCheck} delay={0.5} className="md:col-span-3">
      <ul className="space-y-2">
        {data.map((link) => (
          <LinkRow
            key={link.id}
            link={link}
            checking={recheck.isPending && recheck.variables === link.id}
            disabled={recheck.isPending}
            onRecheck={() => recheck.mutate(link.id)}
          />
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-[1.5] text-paper-faint">
        Only a super admin can link your account to a ClickHouse user, confirm a suspended link or remove one.
      </p>
    </SettingCard>
  );
}
