import { useCallback, useEffect, useRef, useState } from "react";

import { getChatStatus } from "@/api/ai-chat";
import { usePendingAiActionCount } from "@/features/agents/approvals/hooks";
import { useOnboardingGuideActive } from "@/features/onboarding";
import { useWindowSize } from "@/hooks/useWindowSize";
import { INITIAL_NUDGE_STATE, nextNudge, type Nudge, type NudgeState } from "@/lib/chobiNudges";
import { isInsideChobi } from "@/lib/layers";
import { useOnboardingSurfaceDismissAction } from "@/lib/onboardingSurfaces";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { askContext, CHOBI_TABS, nudgesMuted, useChobiStore } from "@/stores/chobi";
import { ActivityTab } from "./ActivityTab";
import { ChobiChat } from "./chat/ChobiChat";
import { ChobiLayer } from "./ChobiLayer";
import { useBriefing, useChobiSettings } from "./hooks";
import { Launcher } from "./Launcher";
import type { ChobiMood } from "./Mascot";
import { NowTab } from "./NowTab";
import { NudgeMenu } from "./NudgeMenu";
import { Panel } from "./Panel";

/** How long Chobi looks pleased after a reply finishes. */
const HAPPY_MS = 4000;
/** How long a nudge stays beside the launcher. */
const NUDGE_MS = 12_000;

/** Text the user has selected on the page (not inside Chobi), for quick ask. */
function pageSelection(): string {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  if (!selection || selection.isCollapsed || isInsideChobi(selection.anchorNode?.parentElement ?? null)) return "";
  return selection.toString().trim();
}

/** Whether AI chat is set up, rechecked when an admin changes AI settings. */
function useAiChatEnabled(allowed: boolean): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!allowed) return undefined;
    let cancelled = false;
    const check = (): void => {
      getChatStatus()
        .then((status) => { if (!cancelled) setEnabled(status.enabled); })
        .catch(() => { if (!cancelled) setEnabled(false); });
    };
    check();
    window.addEventListener("ai-config-updated", check);
    return () => {
      cancelled = true;
      window.removeEventListener("ai-config-updated", check);
    };
  }, [allowed]);
  return enabled;
}

/** Chobi's face follows what it is doing: working, news for you, waiting on you, just done. */
function useMood(busy: boolean, pendingApprovals: number, nudging: boolean): ChobiMood {
  const [happy, setHappy] = useState(false);
  const wasBusy = useRef(busy);
  useEffect(() => {
    const finished = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (!finished) return undefined;
    setHappy(true);
    const timer = setTimeout(() => setHappy(false), HAPPY_MS);
    return () => clearTimeout(timer);
  }, [busy]);
  if (busy) return "thinking";
  if (nudging) return "alert";
  if (pendingApprovals > 0) return "waiting";
  if (happy) return "happy";
  return "idle";
}

/**
 * Chobi, the CHouse buddy (ADR 0025 §6): the single place for AI in the UI,
 * above every dialog. Renders for users with ai:chat once AI is set up; while
 * a guided tour runs it shows a disabled launcher so the tour has a target.
 */
export function Chobi(): React.JSX.Element | null {
  const hasPermission = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AI_CHAT));
  const userId = useRbacStore((s) => s.user?.id ?? null);
  const guideActive = useOnboardingGuideActive();
  const aiEnabled = useAiChatEnabled(hasPermission);
  const { breakpoint } = useWindowSize();
  const mobile = breakpoint === "mobile";

  const open = useChobiStore((s) => s.open);
  const size = useChobiStore((s) => s.size);
  const storedTab = useChobiStore((s) => s.tab);
  const side = useChobiStore((s) => s.side);
  const y = useChobiStore((s) => s.y);
  const busy = useChobiStore((s) => s.busy);
  const pendingApprovals = useChobiStore((s) => s.pendingApprovals);
  const mutedUntil = useChobiStore((s) => s.mutedUntil);
  const quietHours = useChobiStore((s) => s.quietHours);
  const { openPanel, close, setSize, setTab, moveLauncher, setPendingApprovals, setAvailable, askChobi } = useChobiStore.getState();
  const toggle = useChobiStore((s) => s.toggle);
  const tab = CHOBI_TABS.includes(storedTab) ? storedTab : "now";

  // Chobi's place and size are kept per user: load them again when the signed-in user changes.
  useEffect(() => {
    if (userId) void useChobiStore.persist?.rehydrate();
  }, [userId]);

  const ready = hasPermission && aiEnabled === true;
  // Other features (the SQL editor, item actions) offer "Ask Chobi" only when Chobi is there to answer.
  useEffect(() => {
    setAvailable(ready);
    return () => setAvailable(false);
  }, [ready, setAvailable]);
  const pending = usePendingAiActionCount(ready);
  useEffect(() => {
    if (pending.data !== undefined) setPendingApprovals(pending.data);
  }, [pending.data, setPendingApprovals]);

  const settings = useChobiSettings(ready);
  const plain = settings.data?.plainMode ?? false;
  const orgNudges = settings.data?.nudges ?? true;
  const nowShowing = open && tab === "now";
  // Without nudges, the briefing is only needed while someone is looking at it.
  const briefing = useBriefing(ready && (nowShowing || orgNudges));

  const [nudge, setNudge] = useState<Nudge | null>(null);
  const nudgeState = useRef<NudgeState>(INITIAL_NUDGE_STATE);
  useEffect(() => {
    if (!briefing.data) return;
    const allowed = orgNudges && !nowShowing && !nudgesMuted({ mutedUntil, quietHours });
    const next = nextNudge(nudgeState.current, briefing.data, { allowed, now: Date.now() });
    nudgeState.current = next.state;
    if (next.nudge) setNudge(next.nudge);
    // Re-running on the same briefing finds nothing new, so settings changes are safe here.
  }, [briefing.data, orgNudges, nowShowing, mutedUntil, quietHours]);
  useEffect(() => {
    if (!nudge) return undefined;
    const timer = setTimeout(() => setNudge(null), NUDGE_MS);
    return () => clearTimeout(timer);
  }, [nudge]);
  // Opening the panel answers the nudge.
  useEffect(() => {
    if (open) setNudge(null);
  }, [open]);

  const mood = useMood(busy, pendingApprovals, nudge !== null);
  useOnboardingSurfaceDismissAction(close);

  useEffect(() => {
    if (!ready) return undefined;
    // Quick ask: Ctrl/⌘+J opens the chat — with the text you selected on the page attached — or closes Chobi.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "j" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.defaultPrevented) return;
      event.preventDefault();
      if (useChobiStore.getState().open) {
        close();
        return;
      }
      const selected = pageSelection();
      if (selected) askChobi("", { context: askContext("selection.txt", selected) });
      else openPanel({ tab: "chat" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ready, askChobi, close, openPanel]);

  const showChat = useCallback((): void => openPanel({ tab: "chat" }), [openPanel]);
  const showActivity = useCallback((): void => openPanel({ tab: "activity" }), [openPanel]);
  const showNow = useCallback((): void => openPanel({ tab: "now" }), [openPanel]);
  // A panel that covers the page steps aside once you follow a link out of it.
  const afterNavigate = useCallback((): void => {
    if (mobile || size === "focus") close();
  }, [close, mobile, size]);

  if (!hasPermission) return null;
  if (aiEnabled !== true) {
    if (!guideActive) return null;
    return (
      <ChobiLayer open={false} onEscape={close}>
        <Launcher
          mood="sleeping"
          plain={plain}
          open={false}
          side={side}
          y={y}
          mobile={mobile}
          pendingApprovals={0}
          peek={null}
          unavailable={aiEnabled === null ? "loading" : "off"}
          onToggle={toggle}
          onMove={moveLauncher}
        />
      </ChobiLayer>
    );
  }

  // A docked or full panel covers the launcher's spot, and its header has Chobi and a close button.
  const launcherHidden = open && (mobile || size !== "bubble");

  return (
    <ChobiLayer open={open} onEscape={close}>
      {!launcherHidden && (
        <Launcher
          mood={mood}
          plain={plain}
          open={open}
          side={side}
          y={y}
          mobile={mobile}
          pendingApprovals={pendingApprovals}
          peek={nudge?.text ?? null}
          onToggle={toggle}
          onMove={moveLauncher}
          onPeek={showNow}
          onDismissPeek={() => setNudge(null)}
          onDropContext={(context) => askChobi("", { context })}
        />
      )}
      <Panel
        open={open}
        size={size}
        tab={tab}
        tabs={CHOBI_TABS}
        side={side}
        y={y}
        mood={mood}
        plain={plain}
        pendingApprovals={pendingApprovals}
        controls={<NudgeMenu enabledByOrg={orgNudges} />}
        onClose={close}
        onSize={setSize}
        onTab={setTab}
      >
        {(option, width) => option === "chat"
          ? <ChobiChat open={open} visible={open && tab === "chat"} width={width} onShowChat={showChat} />
          : option === "activity"
            ? <ActivityTab active={open && tab === "activity"} />
            : <NowTab briefing={briefing.data} loading={briefing.isLoading} error={briefing.isError} onOpenActivity={showActivity} onNavigated={afterNavigate} />}
      </Panel>
    </ChobiLayer>
  );
}
