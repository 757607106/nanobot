import { useMemo, useState } from 'react'
import { Segmented, Empty } from 'antd'
import { Line } from '@ant-design/charts'
import type { LineConfig } from '@ant-design/charts'
import { useChartTheme } from './chartTheme'
import type { DashboardTimeSeriesPoint } from '../../types'

interface ModelCallTrendChartProps {
  data: DashboardTimeSeriesPoint[]
}

type ViewMode = 'agent' | 'model'

export default function ModelCallTrendChart({ data }: ModelCallTrendChartProps) {
  const ct = useChartTheme()
  const [view, setView] = useState<ViewMode>('agent')

  const chartData = useMemo(() => {
    const grouped = new Map<string, { bucket: string; value: number; series: string }[]>()
    for (const pt of data) {
      const seriesKey = view === 'agent' ? (pt.agentId ?? 'unknown') : (pt.model ?? 'unknown')
      const key = `${pt.bucket}|${seriesKey}`
      const existing = grouped.get(key)
      if (existing) {
        existing[0].value += pt.runCount
      } else {
        grouped.set(key, [{ bucket: pt.bucket, value: pt.runCount, series: seriesKey }])
      }
    }
    return Array.from(grouped.values())
      .map((v) => v[0])
      .sort((a, b) => a.bucket.localeCompare(b.bucket))
  }, [data, view])

  if (!data.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无调用趋势数据" />
  }

  const config: LineConfig = {
    data: chartData,
    xField: 'bucket',
    yField: 'value',
    colorField: 'series',
    smooth: true,
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
      lineWidth: 2,
    },
    interaction: { tooltip: { crosshairs: true } },
    scale: { color: { range: ct.palette10 } },
    height: 300,
    animate: { enter: { type: 'fadeIn', duration: 400 } },
  }

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Segmented
          size="small"
          options={[
            { label: '按智能体', value: 'agent' },
            { label: '按模型', value: 'model' },
          ]}
          value={view}
          onChange={(v) => setView(v as ViewMode)}
        />
      </div>
      <Line {...config} />
    </div>
  )
}
