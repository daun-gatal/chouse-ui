/**
 * FleetAlertsBell — the alert surface in the Fleet header.
 *
 * A bell with a breach count badge; the popover holds the rule settings
 * (enable, memory threshold, desktop-notification permission), the list of
 * nodes currently breaching, and a short history of fired alerts.
 */

import { Bell, BellRing, MonitorCheck, MonitorX, Trash2, AlertTriangle, ArrowRight, Radio } from "lucide-react";

import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { UseFleetAlerts } from "@/hooks/useFleetAlerts";

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function FleetAlertsBell({
  alerts,
  onInvestigate,
  onConfigureDelivery,
  side = "bottom",
}: {
  alerts: UseFleetAlerts;
  /** Open the node's live queries (so the operator can see what's eating memory). */
  onInvestigate?: (connectionId: string) => void;
  /** Open the always-on delivery (Slack/email) config — shown only to admins. */
  onConfigureDelivery?: () => void;
  /** Which side the popover opens — "right" when hosted in the left dock. */
  side?: "top" | "right" | "bottom" | "left";
}) {
  const {
    config,
    setConfig,
    activeBreaches,
    fires,
    clearFires,
    permission,
    requestPermission,
    notificationsSupported,
  } = alerts;

  const count = activeBreaches.length;
  const breaching = count > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={breaching ? `${count} active alert${count === 1 ? "" : "s"}` : "Alerts"}
          className={cn(
            "relative grid h-8 w-8 place-items-center rounded-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            breaching
              ? "border border-red-300 bg-red-50 text-red-700 dark:border-red-500/50 dark:bg-red-950/30 dark:text-red-300"
              : "text-paper-dim hover:bg-ink-200 hover:text-paper"
          )}
        >
          {breaching ? (
            <BellRing className="h-3.5 w-3.5 motion-safe:animate-[pulse_2s_ease-in-out_infinite]" aria-hidden />
          ) : (
            <Bell className="h-3.5 w-3.5" aria-hidden />
          )}
          {breaching && (
            <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-red-500 px-1 font-mono text-[9px] font-bold tabular-nums text-white">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side={side}
        sideOffset={8}
        collisionPadding={12}
        className="z-[100] w-[340px] overflow-hidden rounded-md border-ink-500 bg-ink-100 p-0"
      >
        <div className="flex items-center justify-between border-b border-ink-500 px-4 py-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper">Alerts</span>
          <Toggle
            checked={config.enabled}
            onChange={(v) => setConfig({ enabled: v })}
            label="Enabled"
          />
        </div>

        {/* Rules — a 4-column grid so toggle · label · input · unit line up
            cleanly across rows instead of stretching apart. Dimmed while the
            master switch is off, so it's obvious the rules are inactive. */}
        <div
          className={cn(
            "grid grid-cols-[auto_auto_auto_auto] items-center gap-x-2.5 gap-y-3 border-b border-ink-500 px-4 py-3 transition-opacity",
            !config.enabled && "opacity-40",
          )}
        >
          <RuleRow
            label="Node memory above"
            unit="%"
            min={1}
            max={99}
            enabled={config.memoryEnabled}
            onToggle={(v) => setConfig({ memoryEnabled: v })}
            value={config.memoryThresholdPercent}
            onValue={(n) => setConfig({ memoryThresholdPercent: n })}
          />
          <RuleRow
            label="Query memory above"
            unit="GB"
            min={1}
            max={1024}
            enabled={config.queryMemoryEnabled}
            onToggle={(v) => setConfig({ queryMemoryEnabled: v })}
            value={config.queryMemoryThresholdGb}
            onValue={(n) => setConfig({ queryMemoryThresholdGb: n })}
          />
          <RuleRow
            label="Query running over"
            unit="min"
            min={1}
            max={1440}
            enabled={config.longQueryEnabled}
            onToggle={(v) => setConfig({ longQueryEnabled: v })}
            value={config.longQueryThresholdMinutes}
            onValue={(n) => setConfig({ longQueryThresholdMinutes: n })}
          />
        </div>

        {/* Delivery — dimmed along with the rules when the master switch is
            off, since nothing fires while alerts are turned off. */}
        <div
          className={cn(
            "border-b border-ink-500 px-4 py-3 transition-opacity",
            !config.enabled && "opacity-40",
          )}
        >
          {/* Desktop notification permission */}
          {!notificationsSupported ? (
            <p className="text-[11px] text-paper-faint">Desktop notifications aren't available in this browser.</p>
          ) : permission === "granted" ? (
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "flex items-center gap-2 text-[11px]",
                  config.desktopEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-paper-faint",
                )}
              >
                {config.desktopEnabled ? (
                  <MonitorCheck className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <MonitorX className="h-3.5 w-3.5" aria-hidden />
                )}
                Desktop notifications {config.desktopEnabled ? "on" : "off"}
              </span>
              <Toggle
                checked={config.desktopEnabled}
                onChange={(v) => setConfig({ desktopEnabled: v })}
                label="Desktop notifications"
              />
            </div>
          ) : permission === "denied" ? (
            <div className="flex items-center gap-2 text-[11px] text-paper-faint">
              <MonitorX className="h-3.5 w-3.5" aria-hidden /> Desktop notifications blocked (allow them in browser settings)
            </div>
          ) : (
            <button
              type="button"
              onClick={requestPermission}
              className="inline-flex items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-200 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted transition-colors hover:bg-ink-300 hover:text-paper"
            >
              <MonitorCheck className="h-3.5 w-3.5" aria-hidden /> Enable desktop alerts
            </button>
          )}
        </div>

        {/* Always-on delivery config (Slack / email) — super-admin only. */}
        {onConfigureDelivery && (
          <button
            type="button"
            onClick={onConfigureDelivery}
            className="flex w-full items-center justify-between border-b border-ink-500 px-4 py-2.5 text-left transition-colors hover:bg-ink-200/50"
          >
            <span className="flex items-center gap-2 text-[12px] text-paper-muted">
              <Radio className="h-3.5 w-3.5 text-paper-dim" aria-hidden /> Slack &amp; email delivery
            </span>
            <ArrowRight className="h-3 w-3 text-paper-faint" aria-hidden />
          </button>
        )}

        {/* Currently breaching */}
        {breaching && (
          <div className="border-b border-ink-500 px-4 py-3">
            <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-red-700 dark:text-red-300">
              Breaching now
            </div>
            <div className="flex flex-col gap-0.5">
              {activeBreaches.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => onInvestigate?.(b.connectionId)}
                  title="Open live queries on this node"
                  className="group flex w-full items-center justify-between gap-2 rounded-xs px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-ink-200/60 focus:outline-none focus-visible:bg-ink-200/60"
                >
                  <span className="flex min-w-0 items-center gap-1.5 truncate text-paper">
                    <AlertTriangle className="h-3 w-3 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
                    {b.connectionName}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="font-mono tabular-nums text-red-700 dark:text-red-300">{b.summary}</span>
                    <ArrowRight className="h-3 w-3 text-paper-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* History */}
        <div className="max-h-64 overflow-auto">
          <div className="flex items-center justify-between px-4 pb-1 pt-3">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">Recent</span>
            {fires.length > 0 && (
              <button
                type="button"
                onClick={clearFires}
                className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint hover:text-paper-muted"
              >
                <Trash2 className="h-3 w-3" aria-hidden /> Clear
              </button>
            )}
          </div>
          {fires.length === 0 ? (
            <p className="px-4 pb-4 pt-1 text-[12px] text-paper-faint">
              {config.enabled ? "No alerts fired yet." : "Alerts are turned off."}
            </p>
          ) : (
            <ul className="pb-2">
              {fires.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onInvestigate?.(f.connectionId)}
                    title="Open live queries on this node"
                    className="group flex w-full items-center justify-between gap-2 px-4 py-1.5 text-left text-[12px] transition-colors hover:bg-ink-200/50 focus:outline-none focus-visible:bg-ink-200/50"
                  >
                    <span className="min-w-0 truncate text-paper-muted">
                      <span className="text-paper">{f.connectionName}</span> · {f.summary}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="font-mono text-[10px] text-paper-faint">{timeAgo(f.at)}</span>
                      <ArrowRight className="h-3 w-3 text-paper-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One alert rule: a toggle, a label, and a threshold input + unit. */
function RuleRow({
  label,
  unit,
  min,
  max,
  enabled,
  onToggle,
  value,
  onValue,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  value: number;
  onValue: (n: number) => void;
}) {
  return (
    <>
      <Toggle checked={enabled} onChange={onToggle} label={label} />
      <span className={cn("truncate text-[12px]", enabled ? "text-paper-muted" : "text-paper-faint")}>
        {label}
      </span>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={!enabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onValue(Math.min(max, Math.max(min, Math.round(n))));
        }}
        className={cn(
          "h-7 w-14 rounded-xs border-ink-500 bg-ink-200 text-right font-mono text-[12px] text-paper focus-visible:border-brand focus-visible:ring-0",
          !enabled && "opacity-50",
        )}
      />
      <span className="w-7 font-mono text-[11px] text-paper-muted">{unit}</span>
    </>
  );
}

/** Compact track toggle styled to the editorial palette. */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        checked ? "bg-brand" : "bg-ink-400"
      )}
    >
      {/* Knob is a flex child: OFF rests at the left (translate-x-0), ON slides
          right. Avoids fractional translate that rendered ambiguously. */}
      <span
        className={cn(
          "h-3 w-3 rounded-full bg-ink-50 shadow-sm transition-transform",
          checked ? "translate-x-3" : "translate-x-0"
        )}
        aria-hidden
      />
    </button>
  );
}
