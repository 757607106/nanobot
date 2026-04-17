import type { ReactNode } from 'react'
import { Flex, Typography, theme } from 'antd'

type MetricTone = 'primary' | 'success' | 'warning' | 'error' | 'neutral'

interface MetricCardProps {
  label: string
  value: ReactNode
  helper?: ReactNode
  icon?: ReactNode
  tone?: MetricTone
}

function resolveToneColor(
  token: ReturnType<typeof theme.useToken>['token'],
  tone: MetricTone,
) {
  switch (tone) {
    case 'success':
      return token.colorSuccess
    case 'warning':
      return token.colorWarning
    case 'error':
      return token.colorError
    case 'neutral':
      return token.colorTextSecondary
    case 'primary':
    default:
      return token.colorPrimary
  }
}

export default function MetricCard({
  label,
  value,
  helper,
  icon,
  tone = 'primary',
}: MetricCardProps) {
  const { token } = theme.useToken()
  const toneColor = resolveToneColor(token, tone)

  return (
    <div
      className={`metric-item metric-item-${tone}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 100,
        padding: 'var(--nb-spacing-sm) 0',
      }}
    >
      <Flex align="center" gap={8} className="metric-item-head">
        {icon ? (
          <div
            style={{
              color: toneColor,
              display: 'flex',
              alignItems: 'center',
              fontSize: 'var(--nb-text-sm)',
            }}
          >
            {icon}
          </div>
        ) : null}
        <Typography.Text
          className="metric-item-label"
          type="secondary"
          style={{
            fontSize: 'var(--nb-text-xs)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {label}
        </Typography.Text>
      </Flex>

      <div
        className="metric-item-value"
        style={{
          fontSize: 'var(--nb-title-sm)',
          fontWeight: 'var(--nb-font-weight-title)',
          lineHeight: 1.1,
          color: tone === 'neutral' ? 'inherit' : toneColor,
          wordBreak: 'break-word',
          fontFamily: 'var(--nb-font-display)',
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>

      {helper ? (
        <Typography.Text
          className="metric-item-helper"
          type="secondary"
          style={{
            fontSize: 'var(--nb-text-xs)',
            marginTop: 4,
          }}
        >
          {helper}
        </Typography.Text>
      ) : null}
    </div>
  )
}
