import { useMemo } from 'react'
import { Empty } from 'antd'
import { Pie } from '@ant-design/charts'
import type { PieConfig } from '@ant-design/charts'
import { useChartTheme } from './chartTheme'
import type { DashboardTimeSeriesPoint } from '../../types'

interface TokenConsumptionPieChartProps {
  data: DashboardTimeSeriesPoint[]
}

export default function TokenConsumptionPieChart({ data }: TokenConsumptionPieChartProps) {
  const ct = useChartTheme()

  const chartData = useMemo(() => {
    const map = new Map<string, number>()
    for (const pt of data) {
      const key = pt.model ?? pt.agentId ?? 'unknown'
      map.set(key, (map.get(key) ?? 0) + pt.totalTokens)
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [data])

  const breakdownData = useMemo(() => {
    let prompt = 0
    let completion = 0
    let cached = 0
    for (const pt of data) {
      prompt += pt.promptTokens
      completion += pt.completionTokens
      cached += pt.cachedTokens
    }
    return [
      { name: 'Prompt', value: prompt },
      { name: 'Completion', value: completion },
      { name: 'Cached', value: cached },
    ].filter((d) => d.value > 0)
  }, [data])

  if (!chartData.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Token 消耗数据" />
  }

  const outerConfig: PieConfig = {
    data: chartData,
    angleField: 'value',
    colorField: 'name',
    radius: 0.9,
    innerRadius: 0.55,
    label: {
      text: 'name',
      position: 'outside',
      style: { fontSize: 11, fontFamily: ct.fontFamily, fill: ct.colorTextSecondary },
    },
    legend: {
      color: {
        position: 'bottom',
        layout: { justifyContent: 'center' },
        itemLabelFill: ct.colorTextBase,
      },
    },
    tooltip: {
      title: 'name',
      items: [{ field: 'value', name: 'Tokens', valueFormatter: (v: number) => v.toLocaleString() }],
    },
    scale: { color: { range: ct.palette10 } },
    height: 300,
    animate: { enter: { type: 'waveIn', duration: 500 } },
  }

  const innerConfig: PieConfig = {
    data: breakdownData,
    angleField: 'value',
    colorField: 'name',
    radius: 0.45,
    innerRadius: 0,
    label: false,
    legend: false,
    tooltip: {
      title: 'name',
      items: [{ field: 'value', name: 'Tokens', valueFormatter: (v: number) => v.toLocaleString() }],
    },
    scale: { color: { range: ['#597ef7', '#73d13d', '#ffc53d'] } },
    height: 300,
    animate: { enter: { type: 'waveIn', duration: 500 } },
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div>
        <div style={{ fontSize: 'var(--nb-text-xs)', color: ct.colorTextSecondary, marginBottom: 8, fontWeight: 600, letterSpacing: '0.04em' }}>
          按模型分布
        </div>
        <Pie {...outerConfig} />
      </div>
      <div>
        <div style={{ fontSize: 'var(--nb-text-xs)', color: ct.colorTextSecondary, marginBottom: 8, fontWeight: 600, letterSpacing: '0.04em' }}>
          Token 类型构成
        </div>
        <Pie {...innerConfig} />
      </div>
    </div>
  )
}
