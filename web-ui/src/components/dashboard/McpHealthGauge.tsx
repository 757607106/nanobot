import { useMemo } from 'react'
import { Flex, Tag, Typography, Empty, theme } from 'antd'
import { Gauge } from '@ant-design/charts'
import type { GaugeConfig } from '@ant-design/charts'
import { useChartTheme } from './chartTheme'
import type { DashboardMcpHealthResponse, McpServerEntry } from '../../types'

interface McpHealthGaugeProps {
  data: DashboardMcpHealthResponse | null
}

function statusColor(status: string): string {
  switch (status) {
    case 'ready':
      return 'green'
    case 'incomplete':
      return 'orange'
    default:
      return 'default'
  }
}

export default function McpHealthGauge({ data }: McpHealthGaugeProps) {
  const ct = useChartTheme()
  const { token } = theme.useToken()

  const score = data?.healthScore ?? 0
  const servers: McpServerEntry[] = data?.servers ?? []

  const gaugeColor = useMemo(() => {
    if (score >= 80) return ct.colorSuccess
    if (score >= 50) return ct.colorWarning
    return ct.colorError
  }, [score, ct])

  if (!data || servers.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无连接数据" />
  }

  const config: GaugeConfig = {
    data: { target: score / 100, total: 1, name: 'health' },
    legend: false,
    scale: {
      color: {
        range: [gaugeColor, ct.colorBorderSecondary],
      },
    },
    style: {
      textContent: () => `${score}%`,
    },
    height: 180,
  }

  return (
    <div>
      <Gauge {...config} />
      <div style={{ marginTop: 12, maxHeight: 180, overflowY: 'auto' }}>
        <Flex vertical gap={6}>
          {servers.map((s) => (
            <Flex key={s.name} justify="space-between" align="center" style={{ padding: '4px 0' }}>
              <Typography.Text style={{ fontSize: token.fontSizeSM, fontFamily: token.fontFamilyCode }}>
                {s.displayName || s.name}
              </Typography.Text>
              <Tag color={statusColor(s.status)} style={{ margin: 0 }}>
                {s.status}
              </Tag>
            </Flex>
          ))}
        </Flex>
      </div>
    </div>
  )
}
