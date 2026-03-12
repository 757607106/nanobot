import type { ReactNode } from 'react'
import { Space, Typography } from 'antd'

const { Title, Text } = Typography

export interface HeroStat {
  label: string
  value: ReactNode
}

interface PageHeroProps {
  eyebrow?: string
  title: string
  description: ReactNode
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
  return (
    <div className={className ? `page-hero ${className}` : 'page-hero'}>
      <div className="page-hero-copy">
        {eyebrow ? <div className="hero-eyebrow-chip">{eyebrow}</div> : null}
        <Title level={2}>{title}</Title>
        <Text type="secondary">{description}</Text>
        {badges && badges.length > 0 ? (
          <Space wrap className="page-hero-badges">
            {badges.map((badge, index) => (
              <span key={index}>{badge}</span>
            ))}
          </Space>
        ) : null}
      </div>

      {actions ? <div className="page-hero-actions">{actions}</div> : null}

      {stats && stats.length > 0 ? (
        <div className="hero-stats-grid">
          {stats.map((stat) => (
            <div className="hero-stat-tile" key={stat.label}>
              <Text type="secondary">{stat.label}</Text>
              <div className="hero-stat-value">{stat.value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
