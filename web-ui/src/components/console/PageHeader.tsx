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
              fontSize: 'var(--nb-text-2xs)',
              fontWeight: 'var(--nb-font-weight-title)',
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
            fontSize: 'var(--nb-title-md)',
            lineHeight: 1.15,
            fontWeight: 'var(--nb-font-weight-title)',
          }}
        >
          {title}
        </Typography.Title>

        {subtitle ? (
          <div className="page-header-subtitle">{subtitle}</div>
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
