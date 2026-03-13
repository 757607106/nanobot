import type { ReactNode } from 'react'
import { createContext, startTransition, useContext, useEffect, useState } from 'react'
import { ApiError, api } from './api'
import { useAuth } from './auth'
import type { SetupStatus } from './types'

interface SetupContextValue {
  status: SetupStatus | null
  loading: boolean
  error: string | null
  refresh: () => Promise<SetupStatus | null>
  applyStatus: (next: SetupStatus) => void
}

const SetupContext = createContext<SetupContextValue | null>(null)

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

async function fetchSetupStatusWithRetry(attempt = 1): Promise<SetupStatus> {
  try {
    return await api.getSetupStatus()
  } catch (error) {
    if (!(error instanceof ApiError) && attempt < 3) {
      await new Promise((resolve) => window.setTimeout(resolve, 200 * attempt))
      return fetchSetupStatusWithRetry(attempt + 1)
    }
    throw error
  }
}

export function SetupProvider({ children }: { children: ReactNode }) {
  const { status: authStatus } = useAuth()
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!authStatus?.authenticated) {
      startTransition(() => {
        setStatus(null)
        setError(null)
      })
      setLoading(false)
      return null
    }

    setLoading(true)
    try {
      const next = await fetchSetupStatusWithRetry()
      startTransition(() => {
        setStatus(next)
        setError(null)
      })
      return next
    } catch (error) {
      const nextError = getErrorMessage(error, '无法检查初始化向导状态')
      startTransition(() => {
        setStatus(null)
        setError(nextError)
      })
      throw error
    } finally {
      setLoading(false)
    }
  }

  function applyStatus(next: SetupStatus) {
    startTransition(() => {
      setStatus(next)
      setError(null)
    })
  }

  useEffect(() => {
    if (authStatus?.authenticated) {
      void refresh()
      return
    }
    startTransition(() => {
      setStatus(null)
      setError(null)
    })
    setLoading(false)
  }, [authStatus?.authenticated])

  return (
    <SetupContext.Provider
      value={{
        status,
        loading,
        error,
        refresh,
        applyStatus,
      }}
    >
      {children}
    </SetupContext.Provider>
  )
}

export function useSetup() {
  const context = useContext(SetupContext)
  if (!context) {
    throw new Error('useSetup must be used within SetupProvider')
  }
  return context
}
