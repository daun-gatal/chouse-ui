import { Bell, BellOff } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { nudgesMuted, useChobiStore, type QuietHours } from "@/stores/chobi";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_QUIET: QuietHours = { start: 22, end: 7 };

/** 09:00 tomorrow, local time. */
export function tomorrowMorning(now: Date = new Date()): number {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next.getTime();
}

function hour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** Mute Chobi's nudges for a while, or set quiet hours. */
export function NudgeMenu({ enabledByOrg }: { enabledByOrg: boolean }): React.JSX.Element {
  const mutedUntil = useChobiStore((s) => s.mutedUntil);
  const quietHours = useChobiStore((s) => s.quietHours);
  const { muteNudges, setQuietHours } = useChobiStore.getState();
  const now = Date.now();
  const muted = mutedUntil !== null && mutedUntil > now;
  const silent = !enabledByOrg || nudgesMuted({ mutedUntil, quietHours });
  const Icon = silent ? BellOff : Bell;

  if (!enabledByOrg) {
    return (
      <span className="grid h-7 w-7 place-items-center text-paper-faint" title="Nudges are off for your organization" aria-label="Nudges are off for your organization">
        <BellOff className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Nudges"
          title={silent ? "Nudges muted" : "Nudges on"}
          className={cn("grid h-7 w-7 place-items-center rounded-xs transition-colors hover:bg-ink-300 hover:text-paper", silent ? "text-paper-faint" : "text-paper-dim")}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-md border-ink-500 bg-ink-100 p-1">
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          {muted ? (mutedUntil >= Number.MAX_SAFE_INTEGER ? "Muted until you turn them on" : `Muted until ${new Date(mutedUntil).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`) : "Chobi points out news"}
        </DropdownMenuLabel>
        {muted ? (
          <DropdownMenuItem onClick={() => muteNudges(null)}>Unmute</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={() => muteNudges(Date.now() + HOUR_MS)}>Mute for 1 hour</DropdownMenuItem>
            <DropdownMenuItem onClick={() => muteNudges(tomorrowMorning())}>Mute until tomorrow 09:00</DropdownMenuItem>
            <DropdownMenuItem onClick={() => muteNudges(Number.MAX_SAFE_INTEGER)}>Mute until I turn them on</DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        {quietHours ? (
          <DropdownMenuItem onClick={() => setQuietHours(null)}>
            No quiet hours ({hour(quietHours.start)}–{hour(quietHours.end)} now)
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => setQuietHours(DEFAULT_QUIET)}>
            Quiet {hour(DEFAULT_QUIET.start)}–{hour(DEFAULT_QUIET.end)}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
