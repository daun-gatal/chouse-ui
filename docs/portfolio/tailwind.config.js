/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "oklch(0.145 0 0)",
        foreground: "oklch(0.985 0 0)",
      },
    },
  },
  plugins: [],
}
