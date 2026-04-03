import { Button, Empty, Flex, Segmented, Space, Tag, Typography } from 'antd'
import SectionCard from '../../components/console/SectionCard'
import ItemCard from './ItemCard'
import { candidateStatusOptions, statusColor } from './types'
import type { CandidateListProps } from './types'
import type { AgentMemorySnapshot, MemorySourceDetail } from '../../types'
import { formatDateTimeZh } from '../../locale'
import SourcePreview from './SourcePreview'

interface CandidatePanelProps extends CandidateListProps {
  agentMemory: AgentMemorySnapshot | null
  selectedSource: MemorySourceDetail | null
}

export default function CandidatePanel({
  candidates,
  statusFilter,
  onStatusFilterChange,
  onApplyCandidate,
  onRejectCandidate,
  onPreviewSource,
  agentMemory,
  selectedSource,
}: CandidatePanelProps) {
  const filteredCandidates = statusFilter === 'all'
    ? candidates
    : candidates.filter((item) => item.status === statusFilter)

  return (
    <div
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
      }}
    >
      <SectionCard title="候选">
        <Flex vertical gap={16}>
          <Segmented
            block
            value={statusFilter}
            onChange={(value) => onStatusFilterChange(String(value))}
            options={candidateStatusOptions}
          />

          {filteredCandidates.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无候选记忆。" />
          ) : (
            <Flex vertical gap={12}>
              {filteredCandidates.map((candidate) => (
                <ItemCard
                  key={candidate.candidateId}
                  title={candidate.title}
                  tags={(
                    <Space wrap size={[8, 8]}>
                      <Tag color={statusColor(candidate.status)}>{candidate.status}</Tag>
                      <Tag>{candidate.agentId || 'unknown-source'}</Tag>
                      <Tag>{candidate.runId || 'no-run-id'}</Tag>
                    </Space>
                  )}
                  description={candidate.content}
                  footer={(
                    <Flex vertical gap={10}>
                      <Typography.Text type="secondary">
                        {candidate.updatedAt ? formatDateTimeZh(candidate.updatedAt) : '未记录时间'}
                      </Typography.Text>
                      <Space wrap size={[8, 8]}>
                        <Button
                          size="small"
                          onClick={() => onPreviewSource('memory_candidate', candidate.candidateId)}
                        >
                          查看全文
                        </Button>
                        {candidate.status === 'proposed' ? (
                          <Button
                            size="small"
                            type="primary"
                            onClick={() => onApplyCandidate(candidate.candidateId)}
                          >
                            应用
                          </Button>
                        ) : null}
                        {candidate.status === 'proposed' ? (
                          <Button
                            size="small"
                            danger
                            onClick={() => onRejectCandidate(candidate)}
                          >
                            忽略
                          </Button>
                        ) : null}
                      </Space>
                    </Flex>
                  )}
                />
              ))}
            </Flex>
          )}
        </Flex>
      </SectionCard>

      <SectionCard title="预览">
        <SourcePreview
          source={selectedSource}
          fallbackContent={agentMemory?.content}
          emptyText="当前员工记忆为空，点击候选或搜索结果后可查看全文。"
        />
      </SectionCard>
    </div>
  )
}
