export interface OnboardingStep {
  id: string;
  title: string;
  body: string;
  route: string;
  routeMatch?: "exact" | "descendants";
  target?: string;
  requiredAny?: string[];
  requiresConnection?: boolean;
}

export interface OnboardingChapter {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
  requiredAny?: string[];
  requiresConnection?: boolean;
  steps: OnboardingStep[];
}

export interface OnboardingEligibility {
  permissions: string[];
  hasConnection: boolean;
}
