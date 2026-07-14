import { useMemo, useState } from "react";
import { Check, ChevronRight, Circle, KeyRound, LockKeyhole, Plug, RotateCcw, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { rbacAuthApi } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRbacStore } from "@/stores";

import { useOnboardingStore } from "./store";
import type { OnboardingChapter } from "./types";

interface GettingStartedHubProps {
  chapters: OnboardingChapter[];
}

function PasswordSetup(): React.JSX.Element {
  const navigate = useNavigate();
  const logout = useRbacStore((state) => state.logout);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const valid = newPassword.length >= 12
    && /[A-Z]/.test(newPassword)
    && /[a-z]/.test(newPassword)
    && /\d/.test(newPassword)
    && /[^A-Za-z0-9]/.test(newPassword)
    && newPassword === confirmPassword;

  const submit = async (): Promise<void> => {
    if (!valid) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await rbacAuthApi.changePassword(currentPassword, newPassword);
      toast.success("Password changed. Sign in again to continue setup.");
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not change password";
      setErrorMessage(message);
      toast.error(message);
      setIsSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-xs border border-ink-500 bg-ink-200/50 p-3">
      <Input aria-label="Current password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Current password" className="rounded-xs" />
      <Input aria-label="New password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password" className="rounded-xs" />
      <Input aria-label="Confirm new password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm new password" className="rounded-xs" />
      <p className="text-[10px] leading-5 text-paper-faint">Use 12+ characters with uppercase, lowercase, number, and symbol.</p>
      {errorMessage && <p role="alert" className="text-[11px] leading-5 text-red-300">{errorMessage}</p>}
      <Button size="sm" disabled={!valid || isSaving} onClick={() => void submit()} className="w-full rounded-xs">
        <KeyRound className="mr-2 h-3.5 w-3.5" /> {isSaving ? "Changing…" : "Change password"}
      </Button>
    </div>
  );
}

export function GettingStartedHub({ chapters }: GettingStartedHubProps): React.JSX.Element {
  const navigate = useNavigate();
  const isHubOpen = useOnboardingStore((state) => state.isHubOpen);
  const setHubOpen = useOnboardingStore((state) => state.setHubOpen);
  const progress = useOnboardingStore((state) => state.progress);
  const bootstrapPending = useOnboardingStore((state) => state.bootstrapOnboardingPending);
  const requiresPasswordChange = useOnboardingStore((state) => state.requiresPasswordChange);
  const markWelcomeSeen = useOnboardingStore((state) => state.markWelcomeSeen);
  const startChapter = useOnboardingStore((state) => state.startChapter);
  const completeBootstrap = useOnboardingStore((state) => state.completeBootstrap);
  const initializedForUserId = useOnboardingStore((state) => state.initializedForUserId);
  const initialize = useOnboardingStore((state) => state.initialize);
  const isLoading = useOnboardingStore((state) => state.isLoading);
  const loadError = useOnboardingStore((state) => state.loadError);
  const persistenceError = useOnboardingStore((state) => state.persistenceError);
  const clearPersistenceError = useOnboardingStore((state) => state.clearPersistenceError);
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
  const [isCompletingBootstrap, setIsCompletingBootstrap] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const completed = useMemo(
    () => chapters.filter((chapter) => progress.completedChapterIds.includes(chapter.id)).length,
    [chapters, progress.completedChapterIds],
  );
  const percent = chapters.length === 0 ? 0 : Math.round((completed / chapters.length) * 100);

  const handleOpenChange = (open: boolean): void => {
    setHubOpen(open);
    if (!open) void markWelcomeSeen();
  };

  const finishBootstrap = async (): Promise<void> => {
    setIsCompletingBootstrap(true);
    setBootstrapError(null);
    try {
      await completeBootstrap();
      toast.success("First-install setup completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Setup is not ready to complete";
      setBootstrapError(message);
      toast.error(message);
    } finally {
      setIsCompletingBootstrap(false);
    }
  };

  return (
    <Dialog open={isHubOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        data-onboarding-hub
        onboardingSurfaceDismissible={false}
        overlayClassName="z-[1000000000]"
        className="z-[1000000000] grid h-[calc(100dvh-1rem)] max-h-[52rem] w-[calc(100vw-1rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-md border-ink-500 bg-ink-100 p-0 text-paper sm:h-[calc(100dvh-3rem)] sm:w-[calc(100vw-3rem)]"
      >
        <DialogHeader className="shrink-0 border-b border-ink-500 px-4 py-4 pr-12 sm:px-6 sm:py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xs border border-brand/40 bg-brand/10 text-brand">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[20px] tracking-tight">Getting started with CHouse</DialogTitle>
              <DialogDescription className="mt-1 text-paper-muted">
                One permission-aware guide for setup, data work, monitoring, automation, and administration.
              </DialogDescription>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-400">
              <div className="h-full bg-brand motion-safe:transition-all" style={{ width: `${percent}%` }} />
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{completed}/{chapters.length} chapters</span>
          </div>
        </DialogHeader>

        <div
          data-onboarding-region="chapter-list"
          role="region"
          aria-label="Onboarding chapters and setup"
          className="custom-scrollbar min-h-0 touch-pan-y overflow-y-auto overscroll-contain scroll-pb-8 px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] [scrollbar-gutter:stable] sm:px-6 sm:py-5 sm:pb-8"
        >
          {loadError && (
            <section role="alert" className="mb-4 rounded-md border border-red-900/60 bg-red-950/40 p-3 text-red-100">
              <p className="text-[12px] font-medium">Onboarding progress could not be loaded.</p>
              <p className="mt-1 text-[11px] leading-5 text-red-200">{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 rounded-xs"
                disabled={isLoading || !initializedForUserId}
                onClick={() => {
                  if (initializedForUserId) void initialize(initializedForUserId);
                }}
              >
                {isLoading ? "Retrying…" : "Retry loading progress"}
              </Button>
            </section>
          )}

          {persistenceError && !loadError && (
            <section role="alert" className="mb-4 rounded-md border border-amber-800/60 bg-amber-950/30 p-3 text-amber-100">
              <p className="text-[12px] font-medium">The latest onboarding change was not saved.</p>
              <p className="mt-1 text-[11px] leading-5 text-amber-200">{persistenceError}</p>
              <Button variant="ghost" size="sm" className="mt-1 h-7 rounded-xs" onClick={clearPersistenceError}>
                Dismiss
              </Button>
            </section>
          )}

          {bootstrapPending && (
            <section className="mb-5 rounded-md border border-brand/40 bg-brand/[0.04] p-4" aria-label="First-install setup">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand">Fresh installation</p>
                  <h2 className="mt-1 text-[16px] font-semibold">Secure and connect this deployment</h2>
                  <p className="mt-1 text-[12px] leading-5 text-paper-muted">The bootstrap checklist is complete after the seeded password is changed and at least one ClickHouse connection exists.</p>
                </div>
                <LockKeyhole className="h-5 w-5 shrink-0 text-brand" />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xs border border-ink-500 bg-ink-100 p-3">
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    {requiresPasswordChange ? <Circle className="h-3.5 w-3.5 text-amber-400" /> : <Check className="h-3.5 w-3.5 text-emerald-400" />}
                    Secure administrator
                  </div>
                  <p className="mt-1 text-[11px] text-paper-muted">Replace the built-in password before using production data.</p>
                  {requiresPasswordChange && (
                    <Button variant="outline" size="sm" className="mt-3 w-full rounded-xs" onClick={() => setShowPasswordSetup((value) => !value)}>
                      <KeyRound className="mr-2 h-3.5 w-3.5" /> Change password
                    </Button>
                  )}
                  {requiresPasswordChange && showPasswordSetup && <PasswordSetup />}
                </div>
                <div className="rounded-xs border border-ink-500 bg-ink-100 p-3">
                  <div className="flex items-center gap-2 text-[13px] font-medium"><Plug className="h-3.5 w-3.5 text-brand" /> Connect ClickHouse</div>
                  <p className="mt-1 text-[11px] text-paper-muted">Add and test a server, then make it active for Explorer and monitoring.</p>
                  <Button variant="outline" size="sm" className="mt-3 w-full rounded-xs" onClick={() => { setHubOpen(false); navigate("/admin/connections"); }}>
                    Open connections <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {bootstrapError && (
                <p role="alert" className="mt-3 rounded-xs border border-red-900/60 bg-red-950/40 px-3 py-2 text-[11px] leading-5 text-red-200">
                  {bootstrapError}
                </p>
              )}
              <Button className="mt-3 w-full rounded-xs" disabled={Boolean(loadError) || requiresPasswordChange || isCompletingBootstrap} onClick={() => void finishBootstrap()}>
                {isCompletingBootstrap ? "Checking readiness…" : "Complete first-install setup"}
              </Button>
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {chapters.map((chapter) => {
              const isComplete = progress.completedChapterIds.includes(chapter.id);
              const isDismissed = progress.dismissedChapterIds.includes(chapter.id);
              const isResume = progress.lastChapterId === chapter.id && !isComplete;
              const persistedStepIndex = progress.lastStepId
                ? chapter.steps.findIndex((candidate) => candidate.id === progress.lastStepId)
                : Math.min(progress.lastStepIndex, chapter.steps.length - 1);
              const resumeStepIndex = persistedStepIndex >= 0 ? persistedStepIndex : 0;
              const startStepIndex = isResume ? resumeStepIndex : 0;
              const startStepId = chapter.steps[startStepIndex]?.id;
              return (
                <article key={chapter.id} className="flex min-h-40 flex-col rounded-md border border-ink-500 bg-ink-200/30 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-[14px] font-semibold tracking-tight">{chapter.title}</h2>
                      <p className="mt-1 text-[11px] leading-5 text-paper-muted">{chapter.summary}</p>
                    </div>
                    {isComplete ? <Check className="h-4 w-4 shrink-0 text-emerald-400" /> : <Circle className="h-4 w-4 shrink-0 text-paper-faint" />}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">{chapter.steps.length} steps · {chapter.estimatedMinutes} min</span>
                    <Button
                      variant={isComplete ? "outline" : "default"}
                      size="sm"
                      className="h-8 rounded-xs"
                      disabled={Boolean(loadError)}
                      onClick={() => void startChapter(chapter.id, startStepIndex, startStepId)}
                    >
                      {isComplete || isDismissed ? <RotateCcw className="mr-1 h-3.5 w-3.5" /> : null}
                      {isResume ? "Resume" : isComplete || isDismissed ? "Restart" : "Start"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
