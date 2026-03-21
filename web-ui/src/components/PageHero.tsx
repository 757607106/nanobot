import type { ReactNode } from 'react'
import { Typography } from 'antd'
import { motion } from 'framer-motion'
import { surfaceChild, surfaceReveal } from '../motionTokens'

const { Title } = Typography

export interface HeroStat {
  label: string
  value: ReactNode
}

interface PageHeroProps {
  eyebrow?: ReactNode
  title: string
  description?: ReactNode
  stats?: HeroStat[]
  badges?: ReactNode[]
  actions?: ReactNode
  className?: string
}

export default function PageHero({
  title,
  actions,
  className,
}: PageHeroProps) {
  return (
    <motion.section
      className={className ? `page-hero ${className}` : 'page-hero'}
      variants={surfaceReveal}
      initial="hidden"
      animate="visible"
    >
      <motion.div className="page-hero-copy" variants={surfaceChild}>
        <Title level={2}>{title}</Title>
      </motion.div>

      {actions ? <div className="page-hero-actions">{actions}</div> : null}
    </motion.section>
  )
}
