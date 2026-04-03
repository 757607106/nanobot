import { Button, Empty, Flex, Space, Tag, Typography } from 'antd'
import SectionCard from '../../components/console/SectionCard'
import ItemCard from './ItemCard'
import { statusColor } from './types'
import type { AgentMemorySnapshot, AgentRunSummary } from '../../types'
import { formatDateTimeZh } from '../../locale'

interface OverviewPanelProps {
  agentMemory: AgentMemorySnapshot | null
  recentRuns: AgentRunSummary[]
  onViewRun: (runId: string) => void
  onViewThreadRuns: (threadId: string) => void
}

export default function OverviewPanel({
  agentMemory,
  recentRuns,
  onViewRun,
  onViewThreadRuns,
}: OverviewPanelProps) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
      }}
    >
      <SectionCard title="记忆">
        {agentMemory?.content?.trim() ? (
          <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {agentMemory.content}
          </Typography.Paragraph>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 Agent Profile Memory 为空。" />
        )}
      </SectionCard>

      <SectionCard title="执行记录">
        {recentRuns.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行记录。" />
        ) : (
          <Flex vertical gap={12}>
            {recentRuns.slice(0, 5).map((run) => (
              <ItemCard
                key={run.runId}
                title={run.label}
                tags={(
                  <Space wrap size={[8, 8]}>
                    <Tag color={statusColor(run.status)}>{run.status}</Tag>
                    <Tag>{run.kind}</Tag>
                  </Space>
                )}
                description={run.taskPreview}
                footer={(
                  <Flex vertical gap={10}>
                    <Typography.Text type="secondary">
                      {run.createdAt ? formatDateTimeZh(run.createdAt) : '未记录时间'}
                    </Typography.Text>
                    <Space wrap size={[8, 8]}>
                      <Button size="small" onClick={() => onViewRun(run.runId)}>
                        查看 Run
                      </Button>
                      {run.threadId ? (
                        <Button
                          size="small"
                          onClick={() => onViewThreadRuns(String(run.threadId))}
                        >
                          查看 Thread Runs
                        </Button>
                      ) : null}
                    </Space>
                  </Flex>
                )}
              />
            ))}
          </Flex>
        )}
      </SectionCard>
    </div>
  )
}
