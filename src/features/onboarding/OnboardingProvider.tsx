import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";

import { Coachmark } from "./Coachmark";
import { GettingStartedHub } from "./GettingStartedHub";
import { getEligibleChapters } from "./registry";
import { useOnboardingStore } from "./store";

export function OnboardingProvider(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const userId = useRbacStore((state) => state.user?.id);
  const permissions = useRbacStore((state) => state.permissions);
  const roles = useRbacStore((state) => state.roles);
  const isAuthenticated = useRbacStore((state) => state.isAuthenticated);
  const activeConnectionId = useAuthStore((state) => state.activeConnectionId);
  const initialize = useOnboardingStore((state) => state.initialize);
  const reset = useOnboardingStore((state) => state.reset);
  const exitChapter = useOnboardingStore((state) => state.exitChapter);
  const setHubOpen = useOnboardingStore((state) => state.setHubOpen);
  const isHubOpen = useOnboardingStore((state) => state.isHubOpen);
  const activeChapterId = useOnboardingStore((state) => state.activeChapterId);
  const initializedForUserId = useOnboardingStore((state) => state.initializedForUserId);
  const effectivePermissions = useMemo(
    () => roles.includes("super_admin") ? Object.values(RBAC_PERMISSIONS) : permissions,
    [permissions, roles],
  );
  const chapters = useMemo(
    () => getEligibleChapters({ permissions: effectivePermissions, hasConnection: Boolean(activeConnectionId) }),
    [activeConnectionId, effectivePermissions],
  );
  const activeChapter = chapters.find((chapter) => chapter.id === activeChapterId);
  const activeChapterSignature = activeChapter?.steps.map((step) => step.id).join("|") ?? null;
  const activeEligibilityRef = useRef<{ chapterId: string; signature: string } | null>(null);
  const trackedEligibility = activeEligibilityRef.current;
  const activeEligibilityChanged = Boolean(
    activeChapterId
      && trackedEligibility?.chapterId === activeChapterId
      && trackedEligibility.signature !== activeChapterSignature,
  );

  useEffect(() => {
    if (isAuthenticated && userId) void initialize(userId);
    if (!isAuthenticated) reset();
  }, [initialize, isAuthenticated, reset, userId]);

  useEffect(() => {
    const open = (): void => setHubOpen(true);
    window.addEventListener("onboarding:open", open);
    return () => window.removeEventListener("onboarding:open", open);
  }, [setHubOpen]);

  // Nested Monitoring tabs use `guide` only as a temporary routing hint.
  // Remove it whenever no chapter owns the route so ordinary tab clicks are
  // not held on the last guided sub-view after Exit/Skip/Complete.
  useEffect(() => {
    if (activeChapterId) return;
    const params = new URLSearchParams(location.search);
    if (!params.has("guide")) return;
    params.delete("guide");
    const search = params.toString();
    navigate(`${location.pathname}${search ? `?${search}` : ""}`, { replace: true });
  }, [activeChapterId, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!isAuthenticated || !userId || initializedForUserId !== userId || !activeChapterId) {
      activeEligibilityRef.current = null;
      return;
    }
    if (!activeChapter || !activeChapterSignature) {
      activeEligibilityRef.current = null;
      exitChapter();
      return;
    }

    const previous = activeEligibilityRef.current;
    if (previous?.chapterId === activeChapterId && previous.signature !== activeChapterSignature) {
      activeEligibilityRef.current = null;
      exitChapter();
      return;
    }
    activeEligibilityRef.current = {
      chapterId: activeChapterId,
      signature: activeChapterSignature,
    };
  }, [
    activeChapter,
    activeChapterId,
    activeChapterSignature,
    exitChapter,
    initializedForUserId,
    isAuthenticated,
    userId,
  ]);

  if (!isAuthenticated || !userId || initializedForUserId !== userId) return <></>;

  return (
    <>
      {isHubOpen
        ? <GettingStartedHub chapters={chapters} />
        : activeChapter && !activeEligibilityChanged
          ? <Coachmark chapter={activeChapter} />
          : null}
    </>
  );
}
