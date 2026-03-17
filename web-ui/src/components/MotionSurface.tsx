import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { interactiveLift, interactiveTap, panelReveal, shellSpring, staggerChildren } from '../motionTokens'

interface MotionGroupProps {
  className?: string
  children: ReactNode
}

interface MotionPanelProps {
  className?: string
  children: ReactNode
  hover?: boolean
  standalone?: boolean
}

export function MotionGroup({ className, children }: MotionGroupProps) {
  return (
    <motion.div
      className={className}
      variants={staggerChildren}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  )
}

export function MotionPanel({ className, children, hover = true, standalone = false }: MotionPanelProps) {
  const prefersReducedMotion = useReducedMotion()

  return (
    <motion.div
      className={className ? `motion-panel ${className}` : 'motion-panel'}
      variants={panelReveal}
      initial={standalone ? 'hidden' : undefined}
      animate={standalone ? 'visible' : undefined}
      transition={shellSpring}
      whileHover={hover && !prefersReducedMotion ? interactiveLift : undefined}
      whileTap={hover && !prefersReducedMotion ? interactiveTap : undefined}
    >
      {children}
    </motion.div>
  )
}
