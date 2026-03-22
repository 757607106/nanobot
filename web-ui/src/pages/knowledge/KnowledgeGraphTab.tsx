import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Descriptions, Empty, Input, InputNumber, Space, Spin, Statistic, Tag, Typography } from 'antd'
import { CloseOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import type { KnowledgeGraphData, KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphStats } from '../../types'

const { Text } = Typography

interface KnowledgeGraphTabProps {
  graphLabel: string
  graphDepth: number
  graphMaxNodes: number
  graphLoading: boolean
  graphData: KnowledgeGraphData | null
  graphStats: KnowledgeGraphStats | null
  onGraphLabelChange: (value: string) => void
  onGraphDepthChange: (value: number) => void
  onGraphMaxNodesChange: (value: number) => void
  onReload: () => void
}

const GRAPH_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#22d3ee', '#a78bfa', '#f97316', '#4ade80']

function getNodeLabel(node: KnowledgeGraphNode) {
  return String(node.title || node.properties?.name || node.id)
}

function formatNodeProperties(node: KnowledgeGraphNode) {
  return Object.entries(node.properties || {}).filter(([key]) => !['id', '_id'].includes(key))
}

function formatEdgeProperties(edge: KnowledgeGraphEdge) {
  return Object.entries(edge.properties || {}).filter(([key]) => !['source_id', 'target_id', '_id', 'truncate'].includes(key))
}

export function KnowledgeGraphTab({
  graphLabel,
  graphDepth,
  graphMaxNodes,
  graphLoading,
  graphData,
  graphStats,
  onGraphLabelChange,
  onGraphDepthChange,
  onGraphMaxNodesChange,
  onReload,
}: KnowledgeGraphTabProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const graphRef = useRef<any>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [selectedNode, setSelectedNode] = useState<KnowledgeGraphNode | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<KnowledgeGraphEdge | null>(null)
  const hasGraph = Boolean(graphData && graphData.nodes.length > 0)

  const graphPayload = useMemo(() => {
    if (!graphData) {
      return { nodes: [], edges: [] }
    }

    const degreeMap = new Map<string, number>()
    for (const node of graphData.nodes) {
      degreeMap.set(node.id, 0)
    }
    for (const edge of graphData.edges) {
      degreeMap.set(edge.source, (degreeMap.get(edge.source) || 0) + 1)
      degreeMap.set(edge.target, (degreeMap.get(edge.target) || 0) + 1)
    }

    return {
      nodes: graphData.nodes.map((node, index) => ({
        id: node.id,
        data: {
          label: getNodeLabel(node),
          degree: degreeMap.get(node.id) || 0,
          color: GRAPH_COLORS[index % GRAPH_COLORS.length],
          original: node,
        },
      })),
      edges: graphData.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: {
          label: edge.type,
          original: edge,
        },
      })),
    }
  }, [graphData])

  useEffect(() => {
    let disposed = false

    async function renderGraph() {
      if (!containerRef.current || !hasGraph) {
        if (graphRef.current) {
          graphRef.current.destroy()
          graphRef.current = null
        }
        return
      }

      const { Graph } = await import('@antv/g6')
      if (disposed || !containerRef.current) return

      const width = Math.max(containerRef.current.clientWidth, 480)
      const height = Math.max(containerRef.current.clientHeight, 420)

      if (graphRef.current) {
        graphRef.current.destroy()
        graphRef.current = null
      }

      const instance = new Graph({
        container: containerRef.current,
        width,
        height,
        autoFit: 'view',
        layout: {
          type: 'd3-force',
          preventOverlap: true,
          alphaDecay: 0.08,
          alphaMin: 0.01,
          velocityDecay: 0.45,
          force: {
            link: { distance: 120, strength: 0.8 },
            charge: { strength: -320, distanceMax: 640 },
          },
        },
        node: {
          type: 'circle',
          style: {
            size: (datum: any) => Math.min(18 + (datum.data?.degree || 0) * 4, 56),
            fill: (datum: any) => datum.data?.color || GRAPH_COLORS[0],
            stroke: '#f7f4ef',
            lineWidth: 2,
            labelText: (datum: any) => datum.data?.label || '',
            labelFill: '#25312d',
            labelWordWrap: true,
            labelMaxWidth: '280%',
            shadowColor: 'rgba(37, 49, 45, 0.18)',
            shadowBlur: 6,
          },
        },
        edge: {
          type: 'quadratic',
          style: {
            stroke: 'rgba(95, 117, 107, 0.5)',
            lineWidth: 1.4,
            endArrow: true,
            labelText: (datum: any) => datum.data?.label || '',
            labelFill: '#34413d',
            labelBackground: true,
            labelBackgroundFill: 'rgba(255, 255, 255, 0.85)',
          },
        },
        behaviors: ['drag-element', 'zoom-canvas', 'drag-canvas', 'hover-activate'],
      })

      instance.on('node:click', (event: any) => {
        const nodeId = event.target?.id
        const nodeData = nodeId ? instance.getNodeData(nodeId) : null
        setSelectedEdge(null)
        setSelectedNode((nodeData?.data?.original as KnowledgeGraphNode | undefined) || null)
      })

      instance.on('edge:click', (event: any) => {
        const edgeId = event.target?.id
        const edgeData = edgeId ? instance.getEdgeData(edgeId) : null
        setSelectedNode(null)
        setSelectedEdge((edgeData?.data?.original as KnowledgeGraphEdge | undefined) || null)
      })

      instance.on('canvas:click', () => {
        setSelectedNode(null)
        setSelectedEdge(null)
      })

      instance.setData(graphPayload)
      instance.render()
      graphRef.current = instance

      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (!entry || !graphRef.current) return
        const nextWidth = Math.max(entry.contentRect.width, 480)
        const nextHeight = Math.max(entry.contentRect.height, 420)
        graphRef.current.setSize([nextWidth, nextHeight])
        graphRef.current.fitView?.()
      })
      resizeObserverRef.current.observe(containerRef.current)
    }

    void renderGraph()

    return () => {
      disposed = true
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      if (graphRef.current) {
        graphRef.current.destroy()
        graphRef.current = null
      }
    }
  }, [graphPayload, hasGraph])

  return (
    <div className="knowledge-tab-panel">
      <div className="knowledge-graph-toolbar">
        <Input
          value={graphLabel}
          onChange={(event) => onGraphLabelChange(event.target.value || '*')}
          prefix={<SearchOutlined />}
          placeholder="搜索实体，默认 *"
        />
        <InputNumber min={1} max={5} value={graphDepth} onChange={(value) => onGraphDepthChange(Number(value || 2))} addonBefore="Depth" />
        <InputNumber min={10} max={300} value={graphMaxNodes} onChange={(value) => onGraphMaxNodesChange(Number(value || 50))} addonBefore="Nodes" />
        <Button icon={<ReloadOutlined />} loading={graphLoading} onClick={onReload}>
          刷新图谱
        </Button>
      </div>

      <div className="knowledge-stat-grid is-graph">
        <Statistic title="节点" value={graphStats?.nodeCount || graphData?.nodes.length || 0} />
        <Statistic title="边" value={graphStats?.edgeCount || graphData?.edges.length || 0} />
        <Statistic title="标签" value={graphStats?.labels.length || graphData?.labels.length || 0} />
        <Statistic title="裁剪" value={graphStats?.isTruncated ? '是' : '否'} />
      </div>

      {graphLoading ? (
        <div className="knowledge-loading-panel"><Spin /></div>
      ) : hasGraph ? (
        <div className="knowledge-graph-canvas-shell">
          <div ref={containerRef} className="knowledge-graph-canvas" />
          {selectedNode ? (
            <Card
              size="small"
              className="knowledge-graph-detail-card"
              title="节点详情"
              extra={<Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setSelectedNode(null)} />}
            >
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="名称">{getNodeLabel(selectedNode)}</Descriptions.Item>
                <Descriptions.Item label="ID">{selectedNode.id}</Descriptions.Item>
                {selectedNode.labels.length > 0 ? (
                  <Descriptions.Item label="标签">
                    <Space wrap>
                      {selectedNode.labels.map((label) => <Tag key={label}>{label}</Tag>)}
                    </Space>
                  </Descriptions.Item>
                ) : null}
                {formatNodeProperties(selectedNode).map(([key, value]) => (
                  <Descriptions.Item key={key} label={key}>
                    {String(value)}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </Card>
          ) : null}
          {selectedEdge ? (
            <Card
              size="small"
              className="knowledge-graph-detail-card"
              title="关系详情"
              extra={<Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setSelectedEdge(null)} />}
            >
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="类型">{selectedEdge.type}</Descriptions.Item>
                <Descriptions.Item label="来源">{selectedEdge.source}</Descriptions.Item>
                <Descriptions.Item label="目标">{selectedEdge.target}</Descriptions.Item>
                {formatEdgeProperties(selectedEdge).map(([key, value]) => (
                  <Descriptions.Item key={key} label={key}>
                    {String(value)}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </Card>
          ) : null}
        </div>
      ) : (
        <div className="knowledge-loading-panel">
          <Empty description="知识图谱暂时为空" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      )}

      {!graphLoading && hasGraph ? (
        <Text type="secondary">现在支持拖拽、缩放、点击节点/关系查看详情，交互形态已向 Yuxi-Know 的图谱工作台收敛。</Text>
      ) : null}
    </div>
  )
}
