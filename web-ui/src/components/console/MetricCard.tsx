import type { ReactNode } from 'react'
import { Typography } from 'antd'

type MetricTone = 'primary' | 'success' | 'warning' | 'error' | 'neutral'

interface MetricCardProps {
  label: string
  value: ReactNode
  helper?: ReactNode
  icon?: ReactNode
  tone?: MetricTone
}

export default function MetricCard({
  label,
  value,
  helper,
  icon,
  tone = 'primary',
}: MetricCardProps) {
  return (
    <div
      className="metric-card"
      data-tone={tone}
    >
      <div className="metric-card-head">
        {icon ? (
          <div className="metric-card-icon" aria-hidden="true">
            {icon}
          </div>
        ) : null}
        <Typography.Text className="metric-card-label" type="secondary">
          {label}
        </Typography.Text>
      </div>

      <div className="metric-card-value">{value}</div>

      {helper ? (
        <Typography.Text
          className="metric-card-helper"
          type="secondary"
        >
          {helper}
        </Typography.Text>
      ) : null}
    </div>
  )
}
