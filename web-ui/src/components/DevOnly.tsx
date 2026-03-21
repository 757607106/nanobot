import type { ReactNode } from 'react'
import { useDevMode } from '../devMode'

interface DevOnlyProps {
  children: ReactNode
}

export default function DevOnly({ children }: DevOnlyProps) {
  const { devMode } = useDevMode()
  if (devMode) {
    return <>{children}</>
  }
  return null
}
