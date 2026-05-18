/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Editorial dark palette — zinc-based scale, tuned for layered surfaces.
        ink: {
          0: "#000000",
          50: "#0a0a0a",   // page background
          100: "#0f0f0f",  // first surface
          200: "#141414",  // raised surface
          300: "#1a1a1a",  // card
          400: "#1f1f1f",
          500: "#262626",  // border default
          600: "#2e2e2e",  // border hover
          700: "#404040",  // border emphasis
          800: "#525252",
          900: "#737373",
        },
        // Text scale
        paper: {
          DEFAULT: "#fafafa",
          muted: "#a1a1aa",
          dim: "#71717a",
          faint: "#52525b",
        },
        // ClickHouse-inspired single accent
        accent: {
          DEFAULT: "#FFCC01",
          soft: "#FFE680",
          dim: "#A88600",
        },
      },
      fontFamily: {
        sans: [
          "Geist",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "Geist Mono",
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        // Editorial display scale (clamp pairs) — capped so 2-col layouts wrap cleanly.
        "display-2xl": ["clamp(2.75rem, 5.2vw, 5rem)", { lineHeight: "1.02", letterSpacing: "-0.035em" }],
        "display-xl": ["clamp(2.25rem, 4.2vw, 3.75rem)", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
        "display-lg": ["clamp(1.875rem, 3.4vw, 2.75rem)", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
        "display-md": ["clamp(1.5rem, 2.4vw, 2rem)", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
      },
      letterSpacing: {
        "ultra-tight": "-0.04em",
      },
      spacing: {
        "section": "8rem",
        "section-sm": "5rem",
      },
      maxWidth: {
        "container": "76rem",
      },
      borderRadius: {
        "xs": "2px",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "caret": {
          "0%, 49%": { opacity: 1 },
          "50%, 100%": { opacity: 0 },
        },
      },
      animation: {
        "fade-up": "fade-up 600ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "caret": "caret 1.1s steps(1) infinite",
      },
    },
  },
  plugins: [],
}
