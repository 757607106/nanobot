import { Card, Empty, Space, Tag, Timeline, Typography } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { formatDateTimeZh } from '../../locale'
import type { AgentRunSummary } from '../../types'
import { eventLabel, eventPayloadSummary } from './utils'

const { Text } = Typography

interface RunTimelineProps {
  run: AgentRunSummary
  devMode: boolean
}

export default function RunTimeline({ run, devMode }: RunTimelineProps) {
  if (!run.events?.length) {
    return (
      <Card className="page-card" variant="borderless" title="执行过程">
        <Empty description="暂无过程记录" />
      </Card>
    )
  }

  const items = run.events.map((event, index) => {
    const isLast = index === run.events!.length - 1
    const isFailed = event.eventType === 'failed'
    const isCompleted = event.eventType === 'completed'
    const payloadSummary = eventPayloadSummary(event.eventType, event.payload, devMode)

    return {
      dot: isFailed ? (
        <CloseCircleOutlined style={{ color: 'var(--ant-color-error)', fontSize: 'var(--nb-text-lg)' }} />
      ) : isCompleted ? (
        <CheckCircleOutlined style={{ color: 'var(--ant-color-success)', fontSize: 'var(--nb-text-lg)' }} />
      ) : (
        <ClockCircleOutlined style={{ color: 'var(--ant-color-primary)', fontSize: 'var(--nb-text-sm)' }} />
      ),
      color: isFailed ? 'red' : isCompleted ? 'green' : isLast ? 'blue' : 'gray',
      children: (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space wrap>
            <Text strong>{eventLabel(event.eventType, devMode)}</Text>
            {devMode && <Tag bordered={false}>{event.eventType}</Tag>}
            <Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>
              {formatDateTimeZh(event.createdAt)}
            </Text>
          </Space>
          {payloadSummary && (
            <Text
              type="secondary"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--nb-text-xs)',
                display: 'block',
                padding: '4px 8px',
                background: 'var(--nb-surface-strong)',
                borderRadius: 4,
              }}
            >
              {payloadSummary}
            </Text>
          )}
        </Space>
      ),
    }
  })

  return (
    <Card className="page-card" variant="borderless" title="执行过程">
      <div style={{ maxWidth: 800, padding: '16px 0' }}>
        <Timeline mode="left" items={items} />
      </div>
    </Card>
  )
}
