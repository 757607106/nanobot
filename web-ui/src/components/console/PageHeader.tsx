import type { ReactNode } from 'react'
import { Flex, Typography, theme } from 'antd'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}

export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: PageHeaderProps) {
  const { token } = theme.useToken()

  return (
    <Flex
      justify="space-between"
      align="flex-start"
      gap={16}
      wrap="wrap"
      className="page-header-shell"
      style={{ width: '100%' }}
    >
      <Flex
        vertical
        gap={subtitle ? 6 : 2}
        className="page-header-copy"
        style={{ minWidth: 0, flex: '1 1 420px' }}
      >
        {eyebrow ? (
          <Typography.Text
            className="page-header-eyebrow"
            style={{
              color: token.colorPrimary,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            {eyebrow}
          </Typography.Text>
        ) : null}

        <Typography.Title
          level={2}
          className="page-header-title"
          style={{
            margin: 0,
            fontSize: 'clamp(1.55rem, 2vw, 1.95rem)',
            lineHeight: 1.08,
          }}
        >
          {title}
        </Typography.Title>

        {subtitle ? (
          <Typography.Paragraph
            className="page-header-subtitle"
            type="secondary"
            style={{
              margin: 0,
              maxWidth: 620,
              lineHeight: 1.55,
            }}
          >
            {subtitle}
          </Typography.Paragraph>
        ) : null}
      </Flex>

      {actions ? (
        <Flex
          className="page-header-actions"
          gap={8}
          wrap="wrap"
          align="center"
          justify="flex-end"
          style={{ paddingTop: eyebrow ? 2 : 0 }}
        >
          {actions}
        </Flex>
      ) : null}
    </Flex>
  )
}
