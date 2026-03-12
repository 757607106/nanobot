import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeModeContextValue {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference: (next: ThemePreference) => void
}

const STORAGE_KEY = 'nanobot-web-ui-theme'

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null)

function getStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system'
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === 'light' || raw === 'dark' || raw === 'system') {
    return raw
  }
  return 'system'
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'light'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredPreference())
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme())

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncTheme = () => {
      setSystemTheme(media.matches ? 'dark' : 'light')
    }

    syncTheme()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', syncTheme)
    } else {
      media.addListener(syncTheme)
    }

    return () => {
      if (typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', syncTheme)
      } else {
        media.removeListener(syncTheme)
      }
    }
  }, [])

  const resolvedTheme = preference === 'system' ? systemTheme : preference

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(STORAGE_KEY, preference)
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themePreference = preference
    document.documentElement.style.colorScheme = resolvedTheme
  }, [preference, resolvedTheme])

  const value = useMemo(
    () => ({
      preference,
      resolvedTheme,
      setPreference,
    }),
    [preference, resolvedTheme],
  )

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>
}

export function useThemeMode() {
  const context = useContext(ThemeModeContext)
  if (!context) {
    throw new Error('useThemeMode must be used within ThemeModeProvider')
  }
  return context
}
