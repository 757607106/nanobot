import { Button, Flex, Space, Tag, Typography, theme } from 'antd'
import { formatDateTimeZh } from '../../locale'
import type { MemoryCandidate } from '../../types'

interface MemoryCandidateCardProps {
  candidate: MemoryCandidate
  onApply: () => void
  onReject: () => void
}

export default function MemoryCandidateCard({ candidate, onApply, onReject }: MemoryCandidateCardProps) {
  const { token } = theme.useToken()

  return (
    <div
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        padding: 16,
      }}
    >
      <Flex vertical gap={3}>
        <Space wrap size={[8, 8]}>
          <Typography.Text strong>{candidate.title}</Typography.Text>
          <Tag color={candidate.status === 'applied' ? 'success' : candidate.status === 'rejected' ? 'default' : 'processing'}>
            {candidate.status}
          </Tag>
        </Space>

        <Typography.Paragraph style={{ margin: 0 }}>{candidate.content}</Typography.Paragraph>

        <Typography.Text type="secondary">
          {candidate.sourceKind} · {candidate.updatedAt ? formatDateTimeZh(candidate.updatedAt) : '--'}
        </Typography.Text>

        {candidate.status === 'proposed' ? (
          <Space wrap size={[8, 8]}>
            <Button size="small" type="primary" onClick={onApply}>
              应用
            </Button>
            <Button size="small" danger onClick={onReject}>
              忽略
            </Button>
          </Space>
        ) : null}
      </Flex>
    </div>
  )
}
