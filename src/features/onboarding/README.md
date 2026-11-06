# onboarding

## Overview

Permission-aware in-app onboarding: a chapter/step registry filtered by RBAC and connection state, a zustand store persisting progress server-side, a Getting Started hub (incl. first-install bootstrap and password change) and a portal Coachmark.

## Interface

- `[index.ts]` - re-exports `OnboardingProvider`, `useOnboardingGuideActive`, registry constants/functions and types
- `[OnboardingProvider.tsx:OnboardingProvider]` - root mount
- `[store.ts:useOnboardingStore]`, `useOnboardingGuideActive`
- `[registry.ts:ONBOARDING_CHAPTERS]`, `getEligibleChapters`, `getEligibleSteps`, `findChapter`, `REQUIRED_ONBOARDING_SURFACES`
- `[Coachmark.tsx:Coachmark]`, `isOnboardingRouteActive`, `calculateCoachmarkPosition`
- `[GettingStartedHub.tsx:GettingStartedHub]`
- `[types.ts:OnboardingStep]`, `OnboardingChapter`, `OnboardingEligibility`

## Invariants

- Steps included only if `requiredAny` is empty or matched and connection requirements met; super_admin has all `[registry.ts:getEligibleSteps]` `[OnboardingProvider.tsx:OnboardingProvider]`
- Guide exits when the active chapter's eligibility changes `[OnboardingProvider.tsx:OnboardingProvider]`
- New password >= 12 chars with upper, lower, digit, symbol `[GettingStartedHub.tsx:PasswordSetup]`
- Saves serialized; only latest revision in the current epoch applies `[store.ts:persistPatch]`
- Initial load makes at most `INITIAL_LOAD_ATTEMPTS` = 3 attempts (2 retries, 150 ms·2^n backoff) `[store.ts:INITIAL_LOAD_ATTEMPTS]` `[store.ts:initialize]`

## Side Effects

- `rbacUserPreferencesApi.getOnboarding/updateOnboarding` `[store.ts:initialize]` `[store.ts:persistPatch]`
- `rbacAuthApi.changePassword` then logout and navigate to `/login` `[GettingStartedHub.tsx:PasswordSetup]`
- Navigation to step routes `[Coachmark.tsx:Coachmark]`; removes the `guide` query param when no chapter is active `[OnboardingProvider.tsx:OnboardingProvider]`
- `prepareSurfacesForOnboarding` from `@/lib/onboardingSurfaces` `[store.ts:startChapter]`; window `onboarding:open` listener opens the hub `[OnboardingProvider.tsx:OnboardingProvider]`; observers and focus trap listeners `[Coachmark.tsx:Coachmark]`

## Verification

- Run: `bunx vitest run src/features/onboarding` (from repo root; full suite: `bunx vitest run`)
