import { createContext, useContext, useEffect, useState } from "react"
import { rbacUserPreferencesApi } from "@/api"
import { useRbacStore } from "@/stores/rbac"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  // Initialize from localStorage as fallback (for non-authenticated users or first load)
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )
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
        
        if (savedTheme && (savedTheme === "dark" || savedTheme === "light" || savedTheme === "system")) {
          setThemeState(savedTheme)
          // Also update localStorage for fallback
          localStorage.setItem(storageKey, savedTheme)
        }
      } catch (error) {
        console.error('[ThemeProvider] Failed to fetch theme preference:', error)
        // Fallback to localStorage if API fails
        const fallbackTheme = (localStorage.getItem(storageKey) as Theme) || defaultTheme
        setThemeState(fallbackTheme)
      }
    }

    fetchTheme().catch((error) => {
      console.error('[ThemeProvider] Error fetching theme:', error)
    })
  }, [isAuthenticated, storageKey, defaultTheme])

  // Apply theme to DOM
  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"

      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
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
        console.error('[ThemeProvider] Failed to sync theme preference:', error)
        // Continue anyway - theme is already set locally
      }
    }
  }

  const value = {
    theme,
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
