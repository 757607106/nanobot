import type { ReactNode } from 'react'
import { Card, Flex, Statistic, Typography, theme } from 'antd'

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
    <Card
      className={`metric-card metric-card-${tone}`}
      variant="borderless"
      style={{
        position: 'relative',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--nb-surface-panel-bg)',
        border: '1px solid var(--nb-surface-panel-border)',
        borderRadius: 24,
        boxShadow: 'var(--nb-surface-panel-shadow)',
        backdropFilter: 'blur(32px) saturate(140%)',
        transition: 'all 220ms ease',
        cursor: 'default',
      }}
      hoverable
      styles={{
        body: {
          padding: 'var(--nb-spacing-md) var(--nb-spacing-lg)',
          position: 'static',
        },
      }}
    >
      {icon ? (
        <div style={{
          position: 'absolute',
          bottom: -20,
          right: -10,
          fontSize: 90,
          opacity: 0.06,
          color: toneColor,
          zIndex: 0,
          pointerEvents: 'none',
          transform: 'rotate(-10deg)',
          transition: 'all 300ms ease',
        }}
        className="metric-card-watermark"
        >
          {icon}
        </div>
      ) : null}
      
      <Flex vertical gap={6} style={{ position: 'relative', zIndex: 1 }}>
        <Flex justify="space-between" align="center" gap={8} className="metric-card-head">
          <Typography.Text
            className="metric-card-label"
            type="secondary"
            style={{
              fontSize: 'var(--nb-text-xs)',
              fontWeight: 'var(--nb-font-weight-title)',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            {label}
          </Typography.Text>

          {icon ? (
            <div
              style={{
                width: 28,
                height: 28,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--nb-radius-sm)',
                color: toneColor,
                background: `${toneColor}18`,
                flexShrink: 0,
              }}
            >
            {icon}
            </div>
          ) : null}
        </Flex>

        <Statistic
          className="metric-card-statistic"
          value={typeof value === 'number' || typeof value === 'string' ? value : 0}
          formatter={() => value}
          valueStyle={{
            margin: 0,
            lineHeight: 1.05,
            fontSize: 'var(--nb-scale-xl)',
            fontWeight: 'var(--nb-font-weight-title)',
            color: token.colorText,
            wordBreak: 'break-word',
          }}
        />

        {helper ? (
          <Typography.Paragraph
            className="metric-card-helper"
            type="secondary"
            style={{
              margin: 0,
              lineHeight: 1.45,
            }}
          >
            {helper}
          </Typography.Paragraph>
        ) : null}
      </Flex>
    </Card>
  )
}
