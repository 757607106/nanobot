import { Children, type ReactNode } from 'react'
import { Typography } from 'antd'
import { motion } from 'framer-motion'
import { staggerChildren, surfaceChild, surfaceReveal } from '../motionTokens'

const { Title, Text } = Typography

export interface HeroStat {
  label: string
  value: ReactNode
}

interface PageHeroProps {
  eyebrow?: string
  title: string
  description?: ReactNode
  stats?: HeroStat[]
  badges?: ReactNode[]
  actions?: ReactNode
  className?: string
}

export default function PageHero({
  eyebrow,
  title,
  description,
  stats,
  badges,
  actions,
  className,
}: PageHeroProps) {
  const badgeNodes = Children.toArray(badges).filter(Boolean)

  return (
    <motion.section
      className={className ? `page-hero ${className}` : 'page-hero'}
      variants={surfaceReveal}
      initial="hidden"
      animate="visible"
    >
      <motion.div className="page-hero-copy" variants={staggerChildren}>
        {eyebrow ? (
          <motion.div className="hero-eyebrow-chip" variants={surfaceChild}>
            {eyebrow}
          </motion.div>
        ) : null}
        <motion.div variants={surfaceChild}>
          <Title level={2}>{title}</Title>
        </motion.div>
        {description ? (
          <motion.div className="page-hero-description" variants={surfaceChild}>
            {typeof description === 'string' ? <Text type="secondary">{description}</Text> : description}
          </motion.div>
        ) : null}
        {badgeNodes.length > 0 ? (
          <motion.div className="page-hero-badges" variants={surfaceChild}>
            {badgeNodes.map((badge, index) => (
              <span key={index} className="page-hero-badge-slot">
                {badge}
              </span>
            ))}
          </motion.div>
        ) : null}
      </motion.div>

      {actions ? <div className="page-hero-actions">{actions}</div> : null}

      {stats && stats.length > 0 ? (
        <motion.div className="hero-stats-grid" variants={staggerChildren}>
          {stats.map((stat) => (
            <motion.div className="hero-stat-tile" key={stat.label} variants={surfaceChild}>
              <Text type="secondary">{stat.label}</Text>
              <div className="hero-stat-value">{stat.value}</div>
            </motion.div>
          ))}
        </motion.div>
      ) : null}
    </motion.section>
  )
}
