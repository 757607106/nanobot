import type { ReactNode } from 'react'
import { Flex, Typography } from 'antd'

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
  return (
    <Flex
      justify="space-between"
      align="flex-start"
      gap={16}
      wrap="wrap"
      className="page-header-shell"
      data-eyebrow={eyebrow ? 'true' : 'false'}
    >
      <Flex
        vertical
        gap={subtitle ? 6 : 2}
        className="page-header-copy"
      >
        {eyebrow ? (
          <Typography.Text
            className="page-header-eyebrow"
          >
            {eyebrow}
          </Typography.Text>
        ) : null}

        <Typography.Title
          level={2}
          className="page-header-title"
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
        >
          {actions}
        </Flex>
      ) : null}
    </Flex>
  )
}
