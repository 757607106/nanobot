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
      style={{
        position: 'relative',
        height: '100%',
        overflow: 'hidden',
        borderColor: `${toneColor}28`,
        boxShadow: 'none',
      }}
      styles={{
        body: {
          padding: '12px 16px',
        },
      }}
    >
      <div
        style={{
          position: 'absolute',
          insetInline: 0,
          top: 0,
          height: 2,
          background: toneColor,
        }}
      />

      <Flex vertical gap={6}>
        <Flex justify="space-between" align="center" gap={8} className="metric-card-head">
          <Typography.Text
            className="metric-card-label"
            type="secondary"
            style={{
              fontSize: 12,
              fontWeight: 700,
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
            fontSize: 'clamp(1.25rem, 1.6vw, 1.55rem)',
            fontWeight: 700,
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
