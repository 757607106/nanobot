import type { ReactNode } from 'react'
import { createContext, useContext, useMemo } from 'react'
import { App } from 'antd'

interface ToastContextValue {
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const { message } = App.useApp()

  const value = useMemo<ToastContextValue>(() => ({
    success: (content) => {
      void message.success({ content, duration: 3 })
    },
    error: (content) => {
      void message.error({ content, duration: 5 })
    },
    warning: (content) => {
      void message.warning({ content, duration: 4 })
    },
    info: (content) => {
      void message.info({ content, duration: 3 })
    },
  }), [message])

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}
