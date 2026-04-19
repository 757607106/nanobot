import type { ReactNode } from 'react'
import { Card, Flex, Typography } from 'antd'

interface SectionCardProps {
  title?: string
  description?: string
  action?: ReactNode
  loading?: boolean
  children?: ReactNode
}

export default function SectionCard({
  title,
  description,
  action,
  loading,
  children,
}: SectionCardProps) {
  return (
    <Card
      className={`section-card${loading ? ' is-loading' : ''}`}
      loading={loading}
      variant="borderless"
    >
      {title || description || action ? (
        <Flex
          justify="space-between"
          align="flex-start"
          gap={16}
          className="section-card-head"
          wrap="wrap"
        >
          <div className="section-card-head-main">
            {title ? (
              <Typography.Text strong className="section-card-head-title">
                {title}
              </Typography.Text>
            ) : null}
            {description ? (
              <Typography.Text type="secondary" className="section-card-head-description">
                {description}
              </Typography.Text>
            ) : null}
          </div>
          {action ? <div className="section-card-head-action">{action}</div> : null}
        </Flex>
      ) : null}
      <div className="section-card-content">{children}</div>
    </Card>
  )
}
