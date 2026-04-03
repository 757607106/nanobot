import { Empty, Flex, Space, Tag, Typography } from 'antd'
import type { SourcePreviewProps } from './types'

export default function SourcePreview({
  source,
  fallbackContent,
  emptyText,
}: SourcePreviewProps) {
  if (source) {
    return (
      <Flex vertical gap={12}>
        <Space wrap size={[8, 8]}>
          <Tag color="purple">{source.sourceType}</Tag>
          <Tag>{source.title}</Tag>
        </Space>
        <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
          {source.content}
        </Typography.Paragraph>
      </Flex>
    )
  }

  if (fallbackContent?.trim()) {
    return (
      <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
        {fallbackContent}
      </Typography.Paragraph>
    )
  }

  return <Empty image={false} className="minimal-empty" description={emptyText} />
}
