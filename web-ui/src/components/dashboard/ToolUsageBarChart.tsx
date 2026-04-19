import { useMemo } from 'react'
import { Empty } from 'antd'
import { Bar } from '@ant-design/charts'
import type { BarConfig } from '@ant-design/charts'
import { useChartTheme } from './chartTheme'
import type { DashboardToolRankingItem } from '../../types'

interface ToolUsageBarChartProps {
  data: DashboardToolRankingItem[]
}

export default function ToolUsageBarChart({ data }: ToolUsageBarChartProps) {
  const ct = useChartTheme()

  const chartData = useMemo(
    () =>
      data
        .slice(0, 10)
        .map((d) => ({ tool: d.tool, count: d.count, agents: d.agents.join(', ') }))
        .reverse(),
    [data],
  )

  if (!chartData.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无工具调用数据" />
  }

  const config: BarConfig = {
    data: chartData,
    xField: 'tool',
    yField: 'count',
    colorField: 'tool',
    label: {
      text: 'count',
      position: 'right',
      style: { fill: ct.colorTextSecondary, fontSize: 11, fontFamily: ct.fontFamily },
    },
    axis: {
      x: {
        label: {
          style: { fill: ct.colorTextBase, fontSize: 11, fontFamily: ct.fontFamily },
        },
      },
      y: {
        label: {
          style: { fill: ct.colorTextSecondary, fontSize: 11, fontFamily: ct.fontFamily },
        },
        grid: true,
        gridLineWidth: 1,
        gridStroke: ct.colorBorderSecondary,
      },
    },
    style: {
      radiusTopRight: 4,
      radiusBottomRight: 4,
      maxWidth: 20,
    },
    tooltip: {
      title: 'tool',
      items: [
        { field: 'count', name: '调用次数' },
        { field: 'agents', name: '关联智能体' },
      ],
    },
    scale: { color: { range: ct.palette10 } },
    legend: false,
    height: 300,
    animate: { enter: { type: 'growInX', duration: 400 } },
  }

  return <Bar {...config} />
}
