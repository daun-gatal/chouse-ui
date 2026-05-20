import { createContext, useContext, useEffect, useState } from "react"
import { rbacUserPreferencesApi } from "@/api"
import { useRbacStore } from "@/stores/rbac"
import { log } from "@/lib/log"

type Theme = "dark" | "light" | "system" | "auto"

type ResolvedTheme = "dark" | "light"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  /** The actual rendered theme after resolving `system` / `auto`. */
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: "auto",
  resolvedTheme: "dark",
  setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

/**
 * Time-of-day resolver — light from 06:00 to 17:59 local time, dark otherwise.
 * Uses the browser's local timezone via `new Date().getHours()`.
 */
function resolveAutoTheme(): ResolvedTheme {
  const hour = new Date().getHours()
  return hour >= 6 && hour < 18 ? "light" : "dark"
}

function resolveSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function isValidTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light" || value === "system" || value === "auto"
}

export function ThemeProvider({
  children,
  defaultTheme = "auto",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(storageKey)
    return isValidTheme(stored) ? stored : defaultTheme
  })
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    const stored = localStorage.getItem(storageKey)
    const t = isValidTheme(stored) ? stored : defaultTheme
    if (t === "auto") return resolveAutoTheme()
    if (t === "system") return resolveSystemTheme()
    return t
  })
  const { isAuthenticated } = useRbacStore()

  // Fetch theme from database when authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    const fetchTheme = async (): Promise<void> => {
      try {
        const preferences = await rbacUserPreferencesApi.getPreferences()
        const savedTheme = preferences.workspacePreferences?.theme as Theme | undefined

        if (isValidTheme(savedTheme)) {
          setThemeState(savedTheme)
          // Also update localStorage for fallback
          localStorage.setItem(storageKey, savedTheme)
        }
      } catch (error) {
        log.error('[ThemeProvider] Failed to fetch theme preference:', error)
        // Fallback to localStorage if API fails
        const fallbackTheme = localStorage.getItem(storageKey)
        if (isValidTheme(fallbackTheme)) setThemeState(fallbackTheme)
      }
    }

    fetchTheme().catch((error) => {
      log.error('[ThemeProvider] Error fetching theme:', error)
    })
  }, [isAuthenticated, storageKey, defaultTheme])

  // Apply theme to DOM + re-resolve `system` / `auto` modes when the
  // underlying signal changes (OS preference / clock crossing 06:00 or 18:00).
  useEffect(() => {
    const root = window.document.documentElement

    const apply = (resolved: ResolvedTheme): void => {
      root.classList.remove("light", "dark")
      root.classList.add(resolved)
      setResolvedTheme(resolved)
    }

    if (theme === "dark" || theme === "light") {
      apply(theme)
      return
    }

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)")
      apply(mq.matches ? "dark" : "light")
      const listener = (e: MediaQueryListEvent): void => apply(e.matches ? "dark" : "light")
      mq.addEventListener("change", listener)
      return () => mq.removeEventListener("change", listener)
    }

    // theme === "auto" — local-time bands. Re-check every minute so the
    // 06:00 / 18:00 boundary flips without a page reload.
    apply(resolveAutoTheme())
    const id = window.setInterval(() => apply(resolveAutoTheme()), 60_000)
    return () => window.clearInterval(id)
  }, [theme])

  const setTheme = async (newTheme: Theme): Promise<void> => {
    // Update local state immediately
    setThemeState(newTheme)
    localStorage.setItem(storageKey, newTheme)

    // Sync to database if authenticated
    if (isAuthenticated) {
      try {
        // Get current preferences and merge theme
        const currentPreferences = await rbacUserPreferencesApi.getPreferences()
        await rbacUserPreferencesApi.updatePreferences({
          workspacePreferences: {
            ...currentPreferences.workspacePreferences,
            theme: newTheme,
          },
        })
      } catch (error) {
        log.error('[ThemeProvider] Failed to sync theme preference:', error)
        // Continue anyway - theme is already set locally
      }
    }
  }

  const value = {
    theme,
    resolvedTheme,
    setTheme,
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
