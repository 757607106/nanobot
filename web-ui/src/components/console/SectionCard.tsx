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
      className="section-card"
      loading={loading}
      variant="borderless"
    >
      <Flex vertical gap={16}>
        <Flex
          justify="space-between"
          align="flex-start"
          gap={14}
          wrap="wrap"
          className="section-card-head"
        >
          <div className="section-card-copy">
            <Typography.Title
              level={4}
              className="section-card-title"
            >
              {title}
            </Typography.Title>

            {description ? (
              <Typography.Paragraph
                className="section-card-description"
                type="secondary"
              >
                {description}
              </Typography.Paragraph>
            ) : null}
          </div>

          {action ? <div className="section-card-extra">{action}</div> : null}
        </Flex>

        <div className="section-card-body">
          {children}
        </div>
      </Flex>
    </Card>
  )
}
