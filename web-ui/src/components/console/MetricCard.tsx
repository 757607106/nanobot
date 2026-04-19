import type { ReactNode } from 'react'
import { Flex, Typography } from 'antd'

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
    <div className={`metric-item metric-item-${tone}`}>
      <Flex align="center" gap={8} className="metric-item-head">
        {icon ? (
          <div className="metric-item-icon">
            {icon}
          </div>
        ) : null}
        <Typography.Text
          className="metric-item-label"
          type="secondary"
        >
          {label}
        </Typography.Text>
      </Flex>

      <div className="metric-item-value">
        {value}
      </div>

      {helper ? (
        <Typography.Text
          className="metric-item-helper"
          type="secondary"
        >
          {helper}
        </Typography.Text>
      ) : null}
    </div>
  )
}
