import type { ReactNode } from 'react'
import { createContext, startTransition, useContext, useEffect, useState } from 'react'
import { App as AntdApp } from 'antd'
import { ApiError, api } from './api'
import type { AuthStatus } from './types'

const AUTH_REQUIRED_EVENT = 'nanobot:auth-required'

interface AuthContextValue {
  status: AuthStatus | null
  loading: boolean
  submitting: boolean
  error: string | null
  refresh: () => Promise<AuthStatus>
  bootstrap: (username: string, password: string) => Promise<AuthStatus>
  login: (username: string, password: string) => Promise<AuthStatus>
  logout: () => Promise<AuthStatus>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { message } = AntdApp.useApp()
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      const next = await api.getAuthStatus()
      startTransition(() => {
        setStatus(next)
        setError(null)
      })
      return next
    } catch (error) {
      const nextError = getErrorMessage(error, '无法检查登录状态')
      startTransition(() => {
        setStatus(null)
        setError(nextError)
      })
      throw error
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    function handleAuthRequired() {
      startTransition(() => {
        setStatus((previous) => ({
          initialized: previous?.initialized ?? true,
          authenticated: false,
          username: null,
        }))
        setError(null)
      })
    }

    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired)
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired)
    }
  }, [])

  async function bootstrap(username: string, password: string) {
    setSubmitting(true)
    try {
      const next = await api.bootstrapAuth(username, password)
      startTransition(() => {
        setStatus(next)
        setError(null)
      })
      message.success('管理员账号已创建')
      return next
    } catch (error) {
      const nextError = getErrorMessage(error, '管理员初始化失败')
      setError(nextError)
      throw error
    } finally {
      setSubmitting(false)
    }
  }

  async function login(username: string, password: string) {
    setSubmitting(true)
    try {
      const next = await api.login(username, password)
      startTransition(() => {
        setStatus(next)
        setError(null)
      })
      message.success('登录成功')
      return next
    } catch (error) {
      const nextError = getErrorMessage(error, '登录失败')
      setError(nextError)
      throw error
    } finally {
      setSubmitting(false)
    }
  }

  async function logout() {
    setSubmitting(true)
    try {
      const next = await api.logout()
      startTransition(() => {
        setStatus(next)
        setError(null)
      })
      message.success('已退出登录')
      return next
    } catch (error) {
      const nextError = getErrorMessage(error, '退出登录失败')
      setError(nextError)
      throw error
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        status,
        loading,
        submitting,
        error,
        refresh,
        bootstrap,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
