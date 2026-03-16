import type { ReactNode } from 'react'
import { useDevMode } from '../devMode'

interface DevOnlyProps {
  children: ReactNode
  fallback?: ReactNode
}

export default function DevOnly({ children, fallback }: DevOnlyProps) {
  const { devMode } = useDevMode()
  if (devMode) {
    return <>{children}</>
  }
  return fallback ? <>{fallback}</> : null
}
