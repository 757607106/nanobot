import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

interface DevModeContextValue {
  devMode: boolean
  setDevMode: (on: boolean) => void
}

const STORAGE_KEY = 'nanobot-dev-mode'

const DevModeContext = createContext<DevModeContextValue | null>(null)

function getStoredPreference(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return window.localStorage.getItem(STORAGE_KEY) === 'on'
}

export function DevModeProvider({ children }: { children: ReactNode }) {
  const [devMode, setDevModeState] = useState(() => getStoredPreference())

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(STORAGE_KEY, devMode ? 'on' : 'off')
  }, [devMode])

  const value = useMemo(
    () => ({
      devMode,
      setDevMode: setDevModeState,
    }),
    [devMode],
  )

  return <DevModeContext.Provider value={value}>{children}</DevModeContext.Provider>
}

export function useDevMode() {
  const context = useContext(DevModeContext)
  if (!context) {
    throw new Error('useDevMode must be used within DevModeProvider')
  }
  return context
}
