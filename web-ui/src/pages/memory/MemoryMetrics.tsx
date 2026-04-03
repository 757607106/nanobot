import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileSearchOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import MetricCard from '../../components/console/MetricCard'
import type { MemoryMetricsProps } from './types'

export default function MemoryMetrics({
  agentCount,
  pendingCount,
  appliedCount,
  recentRunsCount,
  latestRunStatus,
}: MemoryMetricsProps) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}
    >
      <MetricCard
        label="员工"
        value={agentCount}
        icon={<RobotOutlined />}
        tone="primary"
      />
      <MetricCard
        label="待审"
        value={pendingCount}
        icon={<FileSearchOutlined />}
        tone="warning"
      />
      <MetricCard
        label="已应用"
        value={appliedCount}
        icon={<CheckCircleOutlined />}
        tone="success"
      />
      <MetricCard
        label="运行"
        value={recentRunsCount}
        icon={<ClockCircleOutlined />}
        tone="neutral"
      />
    </div>
  )
}
