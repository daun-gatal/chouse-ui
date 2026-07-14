export { OnboardingProvider } from "./OnboardingProvider";
export {
  AUTHENTICATED_ROUTE_INVENTORY,
  NON_GUIDED_ROUTE_INVENTORY,
  ONBOARDING_CHAPTERS,
  REQUIRED_ONBOARDING_SURFACES,
  findChapter,
  getEligibleChapters,
  getEligibleSteps,
} from "./registry";
export type { OnboardingChapter, OnboardingEligibility, OnboardingStep } from "./types";
