import { useMemo } from "react";
import { useTheme } from "@/components/common/theme-provider";

export interface ChartColors {
  grid: string;
  tick: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipLabel: string;
  cursor: string;
}

const DARK: ChartColors = {
  grid: "#262626",
  tick: "#71717a",
  tooltipBg: "#141414",
  tooltipBorder: "#262626",
  tooltipText: "#ffffff",
  tooltipLabel: "#a1a1aa",
  cursor: "rgba(255, 255, 255, 0.03)",
};

const LIGHT: ChartColors = {
  grid: "#d4d4d8",
  tick: "#71717a",
  tooltipBg: "#ffffff",
  tooltipBorder: "#d4d4d8",
  tooltipText: "#18181b",
  tooltipLabel: "#52525b",
  cursor: "rgba(0, 0, 0, 0.04)",
};

/**
 * Theme-aware color palette for recharts components. SVG attributes don't
 * resolve CSS vars, so we pick concrete hex values here based on the
 * resolved theme from the ThemeProvider.
 */
export function useChartColors(): ChartColors {
  const { resolvedTheme } = useTheme();
  return useMemo(() => (resolvedTheme === "light" ? LIGHT : DARK), [resolvedTheme]);
}
