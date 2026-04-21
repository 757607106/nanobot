import { CheckCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { theme } from 'antd'
import MetricCard from '../../../components/console/MetricCard'
import type { ChannelRow } from '../ChannelsPage'

export default function ChannelMetricsGrid({ channels }: { channels: any[] }) {
  const { token } = theme.useToken()
  return (
    <div className="channels-metrics-grid">
      <MetricCard
        label="已接入"
        value={channels.filter((c) => c.configured).length}
        tone="primary"
        icon={<CheckCircleOutlined style={{ fontSize: token.fontSizeLG }} />}
      />
      <MetricCard
        label="运行中"
        value={channels.filter((c) => c.enabled).length}
        tone="success"
        icon={<CheckCircleOutlined style={{ fontSize: token.fontSizeLG }} />}
      />
      <MetricCard
        label="待补全"
        value={channels.filter((c) => c.missingFields.length > 0).length}
        tone="warning"
        icon={<WarningOutlined style={{ fontSize: token.fontSizeLG }} />}
      />
    </div>
  )
}
