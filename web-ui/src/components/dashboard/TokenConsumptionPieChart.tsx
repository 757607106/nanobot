import { useMemo } from 'react'
import { Empty } from 'antd'
import { Area } from '@ant-design/charts'
import type { AreaConfig } from '@ant-design/charts'
import { useChartTheme } from './chartTheme'
import type { DashboardTimeSeriesPoint } from '../../types'

interface TokenConsumptionPieChartProps {
  data: DashboardTimeSeriesPoint[]
}

export default function TokenConsumptionPieChart({ data }: TokenConsumptionPieChartProps) {
  const ct = useChartTheme()

  const chartData = useMemo(() => {
    const grouped = new Map<string, number>()
    for (const pt of data) {
      grouped.set(pt.bucket, (grouped.get(pt.bucket) ?? 0) + pt.runCount)
    }
    return Array.from(grouped.entries())
      .map(([bucket, value]) => ({ bucket, value }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket))
  }, [data])

  if (!chartData.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无活跃度趋势数据" />
  }

  const config: AreaConfig = {
    data: chartData,
    xField: 'bucket',
    yField: 'value',
    shapeField: 'smooth',
    axis: {
      x: {
        label: {
          style: { fill: ct.colorTextSecondary, fontSize: 11, fontFamily: ct.fontFamily },
        },
        line: { style: { stroke: ct.colorBorderSecondary } },
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
      fill: 'linear-gradient(-90deg, white 0%, ' + ct.colorPrimary + ' 100%)',
    },
    height: 200,
  }

  return (
    <div style={{ height: 200 }}>
      <Area {...config} />
    </div>
  )
}
