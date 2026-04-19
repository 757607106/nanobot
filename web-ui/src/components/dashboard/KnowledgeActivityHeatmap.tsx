import { useMemo } from 'react'
import { Empty } from 'antd'
import { Column } from '@ant-design/charts'
import type { ColumnConfig } from '@ant-design/charts'
import { useChartTheme } from './chartTheme'
import type { DashboardKbActivityItem } from '../../types'

interface KnowledgeActivityHeatmapProps {
  data: DashboardKbActivityItem[]
}

export default function KnowledgeActivityHeatmap({ data }: KnowledgeActivityHeatmapProps) {
  const ct = useChartTheme()

  const chartData = useMemo(() => {
    const items: { name: string; type: string; count: number }[] = []
    for (const kb of data) {
      items.push(
        { name: kb.name || kb.kbId, type: '文件总数', count: kb.fileCount },
        { name: kb.name || kb.kbId, type: '已索引', count: kb.indexedCount },
        { name: kb.name || kb.kbId, type: '全部文档', count: kb.totalCount },
      )
    }
    return items
  }, [data])

  if (!data.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无知识库活动数据" />
  }

  const config: ColumnConfig = {
    data: chartData,
    xField: 'name',
    yField: 'count',
    colorField: 'type',
    group: true,
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
      radiusTopLeft: 4,
      radiusTopRight: 4,
      maxWidth: 28,
    },
    legend: {
      color: {
        position: 'top',
        layout: { justifyContent: 'center' },
        itemLabelFill: ct.colorTextBase,
      },
    },
    tooltip: {
      title: 'name',
      items: [{ field: 'count', name: '数量' }],
    },
    scale: { color: { range: [ct.colorPrimary, ct.colorSuccess, ct.colorWarning] } },
    height: 280,
    animate: { enter: { type: 'growInY', duration: 400 } },
  }

  return <Column {...config} />
}
