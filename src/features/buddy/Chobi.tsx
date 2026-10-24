import { useCallback, useEffect, useRef, useState } from "react";

import { getChatStatus } from "@/api/ai-chat";
import { usePendingAiActionCount } from "@/features/agents/approvals/hooks";
import { useOnboardingGuideActive } from "@/features/onboarding";
import { useWindowSize } from "@/hooks/useWindowSize";
import { useOnboardingSurfaceDismissAction } from "@/lib/onboardingSurfaces";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { useChobiStore, type ChobiTab } from "@/stores/chobi";
import { ActivityTab } from "./ActivityTab";
import { ChobiChat } from "./chat/ChobiChat";
import { ChobiLayer } from "./ChobiLayer";
import { Launcher } from "./Launcher";
import type { ChobiMood } from "./Mascot";
import { Panel } from "./Panel";

const TABS: readonly ChobiTab[] = ["chat", "activity"];
/** How long Chobi looks pleased after a reply finishes. */
const HAPPY_MS = 4000;

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

/** Chobi's face follows what it is doing: working, waiting on you, just done. */
function useMood(busy: boolean, pendingApprovals: number): ChobiMood {
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
  const { openPanel, close, toggle, setSize, setTab, moveLauncher, setPendingApprovals } = useChobiStore.getState();
  const tab = TABS.includes(storedTab) ? storedTab : "chat";

  // Chobi's place and size are kept per user: load them again when the signed-in user changes.
  useEffect(() => {
    if (userId) void useChobiStore.persist?.rehydrate();
  }, [userId]);

  const ready = hasPermission && aiEnabled === true;
  const pending = usePendingAiActionCount(ready);
  useEffect(() => {
    if (pending.data !== undefined) setPendingApprovals(pending.data);
  }, [pending.data, setPendingApprovals]);

  const mood = useMood(busy, pendingApprovals);
  useOnboardingSurfaceDismissAction(close);

  useEffect(() => {
    if (!ready) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "j" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.defaultPrevented) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ready, toggle]);

  const showChat = useCallback((): void => openPanel({ tab: "chat" }), [openPanel]);

  if (!hasPermission) return null;
  if (aiEnabled !== true) {
    if (!guideActive) return null;
    return (
      <ChobiLayer open={false} onEscape={close}>
        <Launcher
          mood="sleeping"
          plain={false}
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
          plain={false}
          open={open}
          side={side}
          y={y}
          mobile={mobile}
          pendingApprovals={pendingApprovals}
          peek={null}
          onToggle={toggle}
          onMove={moveLauncher}
        />
      )}
      <Panel
        open={open}
        size={size}
        tab={tab}
        tabs={TABS}
        side={side}
        y={y}
        mood={mood}
        plain={false}
        pendingApprovals={pendingApprovals}
        onClose={close}
        onSize={setSize}
        onTab={setTab}
      >
        {(option, width) => option === "chat"
          ? <ChobiChat open={open} visible={open && tab === "chat"} width={width} onShowChat={showChat} />
          : <ActivityTab active={open && tab === "activity"} />}
      </Panel>
    </ChobiLayer>
  );
}
