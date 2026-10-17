/**
 * TanStack Query keys for dashboards (ADR 0021), shared so a save anywhere
 * refreshes every view of it.
 */

export const dashboardKeys = {
  all: ["dashboards"] as const,
  list: () => [...dashboardKeys.all, "list"] as const,
  detail: (id: string) => [...dashboardKeys.all, "detail", id] as const,
  alerts: (id: string) => [...dashboardKeys.all, "alerts", id] as const,
  templates: () => [...dashboardKeys.all, "templates"] as const,
};
