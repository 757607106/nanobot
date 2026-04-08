import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Input, InputNumber, Segmented, Select, Space, Spin, Statistic, Tag, Typography, theme } from 'antd'
import { AimOutlined, ReloadOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons'
import type { KnowledgeGraphData, KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphStats } from '../../types'

const { Paragraph, Text } = Typography

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

type GraphViewMode = 'core' | 'all'
type GraphLayoutMode = 'circular' | 'circlepack' | 'random' | 'noverlap' | 'force' | 'forceAtlas'

interface GraphRelationRecord {
  id: string
  sourceId: string
  targetId: string
  sourceLabel: string
  targetLabel: string
  sourceType: string
  targetType: string
  relationTitle: string
  relationSummary: string
  keywords: string[]
  weight: string
  filePath: string
}

interface SelectedNodeRelationRecord extends GraphRelationRecord {
  neighborId: string
  neighborLabel: string
  neighborType: string
}

interface GraphDisplayState {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  focusActive: boolean
}

function getGraphColors(token: ReturnType<typeof theme.useToken>['token']) {
  return {
    concept: token.colorSuccess,
    artifact: token.colorWarning,
    organization: token.colorInfo,
    person: token.purple,
    capability: token.cyan,
    data: token.colorTextSecondary,
    default: token.colorText,
  }
}

const LOW_SIGNAL_TYPES = new Set(['data', 'date', 'time', 'number', 'version'])
const LOW_SIGNAL_LABELS = ['markdown file', 'jsonl session', 'txt file', 'md file', 'docx file']
const GRAPH_LAYOUT_OPTIONS: Array<{ label: string; value: GraphLayoutMode }> = [
  { label: '圆形', value: 'circular' },
  { label: '圆形包装', value: 'circlepack' },
  { label: '随机', value: 'random' },
  { label: '不重叠', value: 'noverlap' },
  { label: '力导向', value: 'force' },
  { label: '强制圈集', value: 'forceAtlas' },
]

function normalizeText(value: unknown) {
  return String(value || '')
    .replace(/^"+|"+$/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateText(value: string, limit = 96) {
  const normalized = normalizeText(value)
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`
}

function getNodeLabel(node: KnowledgeGraphNode) {
  return normalizeText(node.title || node.properties?.entity_id || node.properties?.name || node.id)
}

function getNodeType(node: KnowledgeGraphNode) {
  return normalizeText(node.properties?.entity_type || node.labels[0] || 'entity').toLowerCase() || 'entity'
}

function getNodeTypeLabel(node: KnowledgeGraphNode) {
  const value = getNodeType(node)
  if (!value) return 'Entity'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function getNodeDescription(node: KnowledgeGraphNode) {
  return normalizeText(node.properties?.description)
}

function getNodeFilePath(node: KnowledgeGraphNode) {
  return normalizeText(node.properties?.file_path)
}

function getNodeId(node: KnowledgeGraphNode) {
  return normalizeText(node.properties?.entity_id || node.id)
}

function isDateLike(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(value)
}

function isLowSignalNode(node: KnowledgeGraphNode) {
  const label = getNodeLabel(node).toLowerCase()
  const type = getNodeType(node)
  if (!label) return true
  if (LOW_SIGNAL_TYPES.has(type)) return true
  if (LOW_SIGNAL_LABELS.includes(label)) return true
  if (isDateLike(label)) return true
  if (/^v?\d+(\.\d+){1,3}$/.test(label)) return true
  return false
}

function getEdgeKeywords(edge: KnowledgeGraphEdge) {
  return normalizeText(edge.properties?.keywords)
    .split(/[，,]/)
    .map((item) => normalizeText(item))
    .filter(Boolean)
}

function getEdgeSummary(edge: KnowledgeGraphEdge) {
  const description = normalizeText(edge.properties?.description)
  if (description) return description
  const keywords = getEdgeKeywords(edge)
  if (keywords.length > 0) return keywords.join(' / ')
  return normalizeText(edge.type || 'related')
}

function getEdgeTitle(edge: KnowledgeGraphEdge) {
  const keywords = getEdgeKeywords(edge)
  if (keywords.length > 0) return keywords[0]
  const type = normalizeText(edge.type)
  if (type && type.toLowerCase() !== 'related') return type
  return '关联'
}

function getEdgeWeight(edge: KnowledgeGraphEdge) {
  return normalizeText(edge.properties?.weight)
}

function getEdgeFilePath(edge: KnowledgeGraphEdge) {
  return normalizeText(edge.properties?.file_path)
}

function getFileName(value: string) {
  const normalized = normalizeText(value)
  if (!normalized) return ''
  return normalized.split('/').pop() || normalized
}

function getColorForType(type: string, colors: ReturnType<typeof getGraphColors>) {
  const key = type as keyof ReturnType<typeof getGraphColors>
  return colors[key] || colors.default
}

function getDisplayNodeLabel(node: KnowledgeGraphNode, showFull = false) {
  return truncateText(getNodeLabel(node), showFull ? 28 : 18)
}

function getGraphNodeSize(degree: number, isCenter: boolean, focusActive: boolean) {
  if (isCenter) return 48
  if (focusActive) return Math.min(26 + degree * 1.6, 34)
  return Math.min(18 + degree * 2.4, 34)
}

function getGraphLayoutLabel(layoutMode: GraphLayoutMode) {
  return GRAPH_LAYOUT_OPTIONS.find((option) => option.value === layoutMode)?.label || '力导向'
}

function buildGraphLayout(
  layoutMode: GraphLayoutMode,
  focusActive: boolean,
  nodeCount: number,
  width: number,
  height: number,
) {
  const circleRadius = Math.max(Math.min(width, height) * (focusActive ? 0.24 : 0.34), focusActive ? 120 : 190)
  const ringSpacing = focusActive ? 18 : 24
  const gridCount = Math.max(1, Math.ceil(Math.sqrt(nodeCount)))
  const nodeSize = (datum: any) => Number(datum?.data?.size || 26)

  switch (layoutMode) {
    case 'circular':
      return {
        type: 'circular' as const,
        ordering: 'degree' as const,
        radius: circleRadius,
        startAngle: -Math.PI / 2,
        clockwise: true,
        divisions: focusActive ? 1 : 2,
        nodeSpacing: ringSpacing,
        nodeSize,
      }
    case 'circlepack':
      return {
        type: 'concentric' as const,
        sortBy: 'degree',
        preventOverlap: true,
        nodeSize,
        nodeSpacing: ringSpacing + 4,
        equidistant: false,
        startAngle: -Math.PI / 2,
        clockwise: true,
        maxLevelDiff: 1,
        width,
        height,
      }
    case 'random':
      return {
        type: 'random' as const,
        width: Math.max(width - 64, 480),
        height: Math.max(height - 64, 420),
      }
    case 'noverlap':
      return {
        type: 'grid' as const,
        preventOverlap: true,
        nodeSize,
        preventOverlapPadding: 18,
        rows: gridCount,
        cols: Math.max(1, Math.ceil(nodeCount / gridCount)),
        sortBy: 'degree',
        condense: false,
        begin: [48, 48] as [number, number],
        width: Math.max(width - 96, 420),
        height: Math.max(height - 96, 360),
      }
    case 'forceAtlas':
      return {
        type: 'force-atlas2' as const,
        preventOverlap: true,
        nodeSize,
        kr: focusActive ? 95 : 78,
        kg: focusActive ? 10 : 7,
        ks: 0.08,
        tao: 0.12,
        mode: 'linlog' as const,
        width,
        height,
      }
    case 'force':
    default:
      return {
        type: 'd3-force' as const,
        preventOverlap: true,
        alphaDecay: 0.1,
        alphaMin: 0.01,
        velocityDecay: 0.6,
        iterations: 150,
        force: {
          center: { x: width / 2, y: height / 2, strength: 0.1 },
          charge: { strength: -400, distanceMax: 800 },
          link: { distance: 180, strength: 0.8 }
        },
        collide: { radius: 36, strength: 0.8, iterations: 3 }
      }
  }
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
  const { token } = theme.useToken()
  const graphColors = useMemo(() => getGraphColors(token), [token])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const graphRef = useRef<any>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<GraphViewMode>('core')
  const [layoutMode, setLayoutMode] = useState<GraphLayoutMode>('force')
  const hasGraph = Boolean(graphData && graphData.nodes.length > 0)

  const nodesById = useMemo(() => {
    const entries = (graphData?.nodes || []).map((node) => [node.id, node] as const)
    return new Map(entries)
  }, [graphData])

  const filteredGraphData = useMemo(() => {
    if (!graphData) {
      return {
        nodes: [] as KnowledgeGraphNode[],
        edges: [] as KnowledgeGraphEdge[],
        hiddenNodeCount: 0,
        hiddenEdgeCount: 0,
      }
    }

    if (viewMode === 'all') {
      return {
        nodes: graphData.nodes,
        edges: graphData.edges,
        hiddenNodeCount: 0,
        hiddenEdgeCount: 0,
      }
    }

    const allowedNodeIds = new Set(graphData.nodes.filter((node) => !isLowSignalNode(node)).map((node) => node.id))
    const edges = graphData.edges.filter((edge) => allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target))
    const connectedNodeIds = new Set<string>()
    for (const edge of edges) {
      connectedNodeIds.add(edge.source)
      connectedNodeIds.add(edge.target)
    }
    const nodes = graphData.nodes.filter((node) => allowedNodeIds.has(node.id) && (connectedNodeIds.size === 0 || connectedNodeIds.has(node.id)))
    return {
      nodes,
      edges,
      hiddenNodeCount: Math.max(0, graphData.nodes.length - nodes.length),
      hiddenEdgeCount: Math.max(0, graphData.edges.length - edges.length),
    }
  }, [graphData, viewMode])

  const allRelations = useMemo<GraphRelationRecord[]>(() => {
    return filteredGraphData.edges
      .map((edge) => {
        const sourceNode = nodesById.get(edge.source)
        const targetNode = nodesById.get(edge.target)
        if (!sourceNode || !targetNode) return null
        return {
          id: edge.id,
          sourceId: edge.source,
          targetId: edge.target,
          sourceLabel: getNodeLabel(sourceNode),
          targetLabel: getNodeLabel(targetNode),
          sourceType: getNodeTypeLabel(sourceNode),
          targetType: getNodeTypeLabel(targetNode),
          relationTitle: truncateText(getEdgeTitle(edge), 20),
          relationSummary: truncateText(getEdgeSummary(edge), 92),
          keywords: getEdgeKeywords(edge),
          weight: getEdgeWeight(edge),
          filePath: getEdgeFilePath(edge),
        }
      })
      .filter((item): item is GraphRelationRecord => Boolean(item))
      .sort((left, right) => (Number(right.weight || 0) + right.keywords.length) - (Number(left.weight || 0) + left.keywords.length))
  }, [filteredGraphData.edges, nodesById])

  const relationCountByNode = useMemo(() => {
    const counts = new Map<string, number>()
    for (const relation of allRelations) {
      counts.set(relation.sourceId, (counts.get(relation.sourceId) || 0) + 1)
      counts.set(relation.targetId, (counts.get(relation.targetId) || 0) + 1)
    }
    return counts
  }, [allRelations])

  const selectedNode = useMemo(
    () => filteredGraphData.nodes.find((node) => node.id === selectedNodeId) || null,
    [filteredGraphData.nodes, selectedNodeId],
  )

  const selectedRelation = useMemo(
    () => allRelations.find((relation) => relation.id === selectedEdgeId) || null,
    [allRelations, selectedEdgeId],
  )

  const focusRelations = useMemo(() => {
    if (selectedNodeId) {
      return allRelations.filter((relation) => relation.sourceId === selectedNodeId || relation.targetId === selectedNodeId)
    }
    if (selectedEdgeId && selectedRelation) {
      return [selectedRelation]
    }
    return allRelations
  }, [allRelations, selectedEdgeId, selectedNodeId, selectedRelation])

  const focusState = useMemo(() => {
    if (!selectedNodeId && !selectedEdgeId) {
      return { active: false, nodeIds: new Set<string>(), edgeIds: new Set<string>() }
    }
    const nodeIds = new Set<string>()
    const edgeIds = new Set<string>()
    for (const relation of focusRelations) {
      nodeIds.add(relation.sourceId)
      nodeIds.add(relation.targetId)
      edgeIds.add(relation.id)
    }
    if (selectedNodeId) nodeIds.add(selectedNodeId)
    return { active: true, nodeIds, edgeIds }
  }, [focusRelations, selectedEdgeId, selectedNodeId])

  const selectedNodeRelations = useMemo<SelectedNodeRelationRecord[]>(() => {
    if (!selectedNode) return []
    return focusRelations.map((relation) => ({
      ...relation,
      neighborId: relation.sourceId === selectedNode.id ? relation.targetId : relation.sourceId,
      neighborLabel: relation.sourceId === selectedNode.id ? relation.targetLabel : relation.sourceLabel,
      neighborType: relation.sourceId === selectedNode.id ? relation.targetType : relation.sourceType,
    }))
  }, [focusRelations, selectedNode])

  const relationPanelItems = useMemo<Array<GraphRelationRecord | SelectedNodeRelationRecord>>(
    () => (selectedNode ? selectedNodeRelations : focusRelations.slice(0, 6)),
    [focusRelations, selectedNode, selectedNodeRelations],
  )

  const baseGraphPayload = useMemo(() => {
    const degreeMap = new Map<string, number>()
    for (const node of filteredGraphData.nodes) {
      degreeMap.set(node.id, relationCountByNode.get(node.id) || 0)
    }

    const topDegreeNodeIds = new Set(
      [...filteredGraphData.nodes]
        .sort((left, right) => (degreeMap.get(right.id) || 0) - (degreeMap.get(left.id) || 0))
        .slice(0, 16)
        .map((node) => node.id),
    )

    return {
      nodes: filteredGraphData.nodes.map((node) => {
        const degree = degreeMap.get(node.id) || 0
        return {
          id: node.id,
          data: {
            color: getColorForType(getNodeType(node), graphColors),
            degree,
            label: truncateText(getNodeLabel(node), 36),
            isTopNode: topDegreeNodeIds.has(node.id),
            size: Math.min(18 + degree * 2.4, 48),
            isLowSignal: isLowSignalNode(node)
          },
        }
      }),
      edges: filteredGraphData.edges.map((edge) => {
        const keywords = getEdgeKeywords(edge)
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          data: {
            label: truncateText(keywords[0] || getEdgeTitle(edge), 12),
          },
        }
      }),
    }
  }, [filteredGraphData, graphColors, relationCountByNode])

  useEffect(() => {
    if (selectedNodeId && !filteredGraphData.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null)
    }
    if (selectedEdgeId && !filteredGraphData.edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null)
    }
  }, [filteredGraphData.edges, filteredGraphData.nodes, selectedEdgeId, selectedNodeId])

  useEffect(() => {
    let disposed = false

    let retryCount = 0
    const MAX_RETRIES = 5

    async function renderGraph() {
      if (!containerRef.current || baseGraphPayload.nodes.length === 0) {
        if (graphRef.current) {
          graphRef.current.destroy()
          graphRef.current = null
        }
        setRenderError(null)
        return
      }

      try {
        const { Graph } = await import('@antv/g6')
        if (disposed || !containerRef.current) return

        const width = Math.max(containerRef.current.clientWidth, 540)
        const height = Math.max(containerRef.current.clientHeight, 520)

        // Zero-dimension retry (inspired by Yuxi GraphCanvas)
        if (width <= 0 || height <= 0) {
          if (retryCount < MAX_RETRIES) {
            retryCount++
            setTimeout(() => { if (!disposed) void renderGraph() }, 200)
          }
          return
        }
        retryCount = 0

        if (graphRef.current) {
          graphRef.current.destroy()
          graphRef.current = null
        }

        const layout = buildGraphLayout(layoutMode, focusState.active, baseGraphPayload.nodes.length, width, height)

        const instance = new Graph({
          container: containerRef.current,
          width,
          height,
          data: baseGraphPayload,
          autoFit: 'view',
          layout,
          node: {
            type: 'circle',
            style: {
              size: (datum: any) => Number(datum.data?.size || 28),
              fill: (datum: any) => datum.data?.color || graphColors.default,
              stroke: '#ffffff', // Clean white border for everything
              lineWidth: 1.5,
              opacity: 0.95,
              labelText: (datum: any) => datum.data?.label || '',
              labelFill: token.colorText,
              labelFontSize: 11,
              labelWordWrap: true,
              labelMaxWidth: '260%',
              labelPosition: 'bottom',
              labelOffsetY: 5,
              shadowColor: 'rgba(0,0,0,0.06)',
              shadowBlur: 8,
            },
            state: {
              active: {
                opacity: 1,
                labelText: (datum: any) => datum.data?.label,
                labelFontSize: 13,
                labelPosition: 'bottom',
                labelOffsetY: 8,
                labelBackground: true,
                labelBackgroundFill: '#ffffff',
                labelBackgroundOpacity: 0.9,
                labelBackgroundRadius: 4,
                shadowColor: (datum: any) => datum.data?.color || graphColors.default,
                shadowBlur: 14,
              },
              inactive: {
                opacity: 0.15,
                lineWidth: 1,
                labelText: '',
              },
              selected: {
                opacity: 1,
                stroke: '#ffffff',
                lineWidth: 2,
                labelText: (datum: any) => datum.data?.label,
                labelFontSize: 14,
                labelPosition: 'bottom',
                labelOffsetY: 8,
                labelBackground: true,
                labelBackgroundFill: '#ffffff',
                labelBackgroundOpacity: 0.95,
                labelBackgroundRadius: 6,
                size: (datum: any) => Number(datum.data?.size || 28) + 4,
                shadowColor: (datum: any) => datum.data?.color || graphColors.default,
                shadowBlur: 24,
              }
            }
          },
          edge: {
            type: 'quadratic',
            style: {
              stroke: token.colorBorderSecondary,
              opacity: 0.5,
              lineWidth: 1,
              endArrow: true, // we leave this as standard antv might still resolve it
              labelText: '', 
            },
            state: {
              active: {
                opacity: 0.8,
                lineWidth: 2,
                labelText: (datum: any) => datum.data?.label,
                labelFill: token.colorTextSecondary,
                labelFontSize: 10,
                labelAutoRotate: true,
                labelBackground: true,
                labelBackgroundFill: '#ffffff',
                labelBackgroundOpacity: 0.85,
                labelBackgroundRadius: 3,
                stroke: token.colorTextSecondary,
              },
              inactive: {
                opacity: 0.08,
              },
              selected: {
                stroke: token.colorPrimary,
                lineWidth: 2.5,
                opacity: 0.9,
                labelText: (datum: any) => datum.data?.label,
                labelFill: token.colorPrimary,
                labelFontSize: 11,
                labelAutoRotate: true,
                labelBackground: true,
                labelBackgroundFill: '#ffffff',
                labelBackgroundOpacity: 0.95,
                labelBackgroundRadius: 3,
              }
            }
          },
          behaviors: ['drag-element', 'zoom-canvas', 'drag-canvas', 'hover-activate'],
        })

        instance.on('node:click', (event: any) => {
          const nodeId = event.target?.id
          setSelectedEdgeId(null)
          setSelectedNodeId(nodeId ? String(nodeId) : null)
        })

        instance.on('edge:click', (event: any) => {
          const edgeId = event.target?.id
          setSelectedEdgeId(edgeId ? String(edgeId) : null)
        })

        instance.on('canvas:click', () => {
          setSelectedNodeId(null)
          setSelectedEdgeId(null)
        })

        await instance.render()
        await instance.fitView()
        if (disposed) {
          instance.destroy()
          return
        }

        setRenderError(null)
        graphRef.current = instance

        resizeObserverRef.current?.disconnect()
        resizeObserverRef.current = new ResizeObserver((entries) => {
          const entry = entries[0]
          if (!entry || !graphRef.current) return
          const nextWidth = Math.max(entry.contentRect.width, 540)
          const nextHeight = Math.max(entry.contentRect.height, 520)
          graphRef.current.setSize(nextWidth, nextHeight)
          void graphRef.current.fitView?.()
        })
        resizeObserverRef.current.observe(containerRef.current)
      } catch (error) {
        if (graphRef.current) {
          graphRef.current.destroy()
          graphRef.current = null
        }
        if (!disposed) {
          const message = error instanceof Error ? error.message : String(error || '知识图谱渲染失败')
          setRenderError(message)
        }
      }
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
  }, [baseGraphPayload, layoutMode, token])
  // State management effect
  useEffect(() => {
    if (!graphRef.current || !hasGraph) return
    const graph = graphRef.current

    if (!focusState.active) {
       // Clear all states
       const updates: Record<string, string[]> = {}
       for (const node of baseGraphPayload.nodes) updates[node.id] = []
       for (const edge of baseGraphPayload.edges) updates[edge.id] = []
       try { graph.setElementState(updates) } catch (e) {}
       return
    }

    const updates: Record<string, string[]> = {}
    for (const node of baseGraphPayload.nodes) {
       if (node.id === selectedNodeId) {
           updates[node.id] = ['selected', 'active']
       } else if (focusState.nodeIds.has(node.id)) {
           updates[node.id] = ['active']
       } else {
           updates[node.id] = ['inactive']
       }
    }
    for (const edge of baseGraphPayload.edges) {
       if (edge.id === selectedEdgeId) {
           updates[edge.id] = ['selected', 'active']
       } else if (focusState.edgeIds.has(edge.id)) {
           updates[edge.id] = ['active']
       } else {
           updates[edge.id] = ['inactive']
       }
    }
    try {
        graph.setElementState(updates)
    } catch (e) {}
  }, [focusState, selectedNodeId, selectedEdgeId, baseGraphPayload, hasGraph])


  const selectedTypeCount = useMemo(() => {
    if (!selectedNode) return ''
    return String(selectedNodeRelations.length)
  }, [selectedNode, selectedNodeRelations.length])

  return (
    <div className="knowledge-tab-panel knowledge-graph-tab-panel">
      <div className="knowledge-graph-toolbar knowledge-graph-toolbar-compact">
        <Input
          value={graphLabel}
          onChange={(event) => onGraphLabelChange(event.target.value || '*')}
          prefix={<SearchOutlined />}
          placeholder="搜索实体"
        />
        <Space.Compact>
          <Button disabled>层级</Button>
          <InputNumber min={1} max={5} value={graphDepth} onChange={(value) => onGraphDepthChange(Number(value || 2))} />
        </Space.Compact>
        <Space.Compact>
          <Button disabled>实体数</Button>
          <InputNumber min={10} max={300} value={graphMaxNodes} onChange={(value) => onGraphMaxNodesChange(Number(value || 50))} />
        </Space.Compact>
        <Select
          value={layoutMode}
          onChange={(value) => setLayoutMode(value as GraphLayoutMode)}
          options={GRAPH_LAYOUT_OPTIONS}
          className="knowledge-graph-layout-select"
          popupMatchSelectWidth={false}
        />
        <Segmented
          value={viewMode}
          onChange={(value) => setViewMode(value as GraphViewMode)}
          options={[
            { label: '核心关系', value: 'core' },
            { label: '全部实体', value: 'all' },
          ]}
        />
        <Button icon={<ReloadOutlined />} loading={graphLoading} onClick={onReload}>
          刷新图谱
        </Button>
      </div>

      <div className="knowledge-stat-grid is-graph">
        <Statistic title="实体" value={baseGraphPayload.nodes.length || graphStats?.nodeCount || 0} />
        <Statistic title="关系" value={baseGraphPayload.edges.length || graphStats?.edgeCount || 0} />
        <Statistic title="渲染" value={focusState.active ? `${getGraphLayoutLabel(layoutMode)} · 焦点` : getGraphLayoutLabel(layoutMode)} />
        <Statistic title={focusState.active ? '邻接关系' : '隐藏噪音'} value={focusState.active ? selectedTypeCount || '0' : (viewMode === 'core' ? filteredGraphData.hiddenNodeCount : 0)} />
      </div>

      {!graphLoading && hasGraph && viewMode === 'core' && !focusState.active && (filteredGraphData.hiddenNodeCount > 0 || filteredGraphData.hiddenEdgeCount > 0) ? (
        <Alert
          type="info"
          showIcon
          className="knowledge-graph-filter-alert"
          message={`已隐藏 ${filteredGraphData.hiddenNodeCount} 个低信息实体，让图谱更聚焦核心关系。`}
        />
      ) : null}

      {graphLoading ? (
        <div className="knowledge-loading-panel"><Spin /></div>
      ) : baseGraphPayload.nodes.length > 0 ? (
        <div className="knowledge-graph-browser">
          <div className="knowledge-graph-browser-stage">
            <div className="knowledge-graph-canvas-shell knowledge-graph-browser-shell">
              {renderError ? (
                <Alert
                  type="error"
                  showIcon
                  message="知识图谱渲染失败"
                  description={renderError}
                  style={{ margin: 12 }}
                />
              ) : null}
              <div className="knowledge-graph-floating-tools">
                <Button size="small" icon={<AimOutlined />} onClick={() => void graphRef.current?.fitView?.()} />
                <Button size="small" onClick={() => {
                  setSelectedNodeId(null)
                  setSelectedEdgeId(null)
                }}>
                  清空
                </Button>
              </div>
              <div ref={containerRef} className="knowledge-graph-canvas" />
            </div>
            <div className="knowledge-graph-stage-footer">
              <Text type="secondary">
                {focusState.active
                  ? `焦点视图：${selectedNode ? getNodeLabel(selectedNode) : '当前关系'} · ${getGraphLayoutLabel(layoutMode)}`
                  : `当前渲染：${getGraphLayoutLabel(layoutMode)}。点击一个实体后，会切换到它的一跳关系视图。`}
              </Text>
              {focusState.active ? (
                <Button
                  size="small"
                  onClick={() => {
                    setSelectedNodeId(null)
                    setSelectedEdgeId(null)
                  }}
                >
                  返回全图
                </Button>
              ) : null}
            </div>
          </div>

          <aside className="knowledge-graph-browser-sidebar">
            <div className="knowledge-graph-inspector-shell">
              <div className="knowledge-graph-inspector-header">
                <div className="knowledge-graph-inspector-copy">
                  <Text strong>图谱检查器</Text>
                  <Text type="secondary">
                    {selectedNode
                      ? `当前聚焦 ${truncateText(getNodeLabel(selectedNode), 18)} 的一跳关系`
                      : selectedRelation
                        ? '已切换到关系查看模式'
                        : '点击左侧实体后，在这里查看属性和关系'}
                  </Text>
                </div>
                {selectedNode ? <Tag>{getNodeTypeLabel(selectedNode)}</Tag> : <Tag>{focusState.active ? '焦点' : '全图'}</Tag>}
              </div>

              <div className="knowledge-graph-side-panel knowledge-graph-side-panel-compact">
                {selectedNode ? (
                  <div className="knowledge-graph-properties">
                    <div className="knowledge-graph-side-list">
                      <div className="knowledge-graph-side-row"><span>名称</span><strong>{truncateText(getNodeLabel(selectedNode), 24)}</strong></div>
                      <div className="knowledge-graph-side-row"><span>类型</span><strong>{getNodeTypeLabel(selectedNode)}</strong></div>
                      <div className="knowledge-graph-side-row"><span>关系数</span><strong>{relationCountByNode.get(selectedNode.id) || 0}</strong></div>
                      {getNodeFilePath(selectedNode) ? (
                        <div className="knowledge-graph-side-row"><span>来源</span><strong>{truncateText(getFileName(getNodeFilePath(selectedNode)), 22)}</strong></div>
                      ) : null}
                    </div>
                    {getNodeDescription(selectedNode) ? (
                      <Paragraph className="knowledge-graph-property-block knowledge-graph-property-block-clamped">
                        {truncateText(getNodeDescription(selectedNode), 160)}
                      </Paragraph>
                    ) : null}
                  </div>
                ) : selectedRelation ? (
                  <div className="knowledge-graph-side-list">
                    <div className="knowledge-graph-side-row"><span>起点</span><strong>{truncateText(selectedRelation.sourceLabel, 18)}</strong></div>
                    <div className="knowledge-graph-side-row"><span>终点</span><strong>{truncateText(selectedRelation.targetLabel, 18)}</strong></div>
                    <div className="knowledge-graph-side-row"><span>关系</span><strong>{selectedRelation.relationTitle}</strong></div>
                    {selectedRelation.filePath ? (
                      <div className="knowledge-graph-side-row"><span>来源</span><strong>{truncateText(getFileName(selectedRelation.filePath), 22)}</strong></div>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <Text type="secondary" className="knowledge-graph-compact-hint">
                      默认显示核心关系。点击一个实体后，这里会自动切换成它的关系检查面板。
                    </Text>
                    <div className="knowledge-graph-chip-row">
                      <Tag>点击实体</Tag>
                      <Tag>展开关系</Tag>
                      <Tag>回到全图</Tag>
                    </div>
                  </>
                )}
              </div>

              <div className="knowledge-graph-side-panel knowledge-graph-relations-panel">
                <div className="knowledge-graph-relations-header">
                  <Text strong>{selectedNode ? '实体关系' : '核心关系'}</Text>
                  <Text type="secondary">{relationPanelItems.length} 条</Text>
                </div>
                <div className="knowledge-graph-relations-list">
                  {relationPanelItems.map((relation) => {
                    const isNodeScoped = selectedNode && 'neighborLabel' in relation
                    const leftLabel = selectedNode ? getNodeLabel(selectedNode) : relation.sourceLabel
                    const rightLabel = isNodeScoped ? relation.neighborLabel : relation.targetLabel
                    const rightType = isNodeScoped ? relation.neighborType : relation.targetType
                    const isActive = relation.id === selectedEdgeId

                    return (
                      <div key={relation.id} className={`knowledge-graph-relation-row ${isActive ? 'is-active' : ''}`}>
                        <button
                          type="button"
                          className="knowledge-graph-relation-toggle"
                          onClick={() => {
                            setSelectedEdgeId(isActive ? null : relation.id)
                            if (selectedNode) {
                              setSelectedNodeId(selectedNode.id)
                            }
                          }}
                        >
                          <div className="knowledge-graph-relation-head">
                            <strong>{truncateText(leftLabel, 14)}</strong>
                            <Tag>{relation.relationTitle}</Tag>
                            <strong>{truncateText(rightLabel, 14)}</strong>
                          </div>
                          <div className="knowledge-graph-relation-toggle-icon">
                            <Tag>{rightType}</Tag>
                            <RightOutlined className={isActive ? 'is-open' : ''} />
                          </div>
                        </button>

                        {isActive ? (
                          <div className="knowledge-graph-relation-body">
                            <Text type="secondary" className="knowledge-graph-relation-summary">
                              {relation.relationSummary}
                            </Text>
                            <div className="knowledge-graph-relation-meta">
                              {relation.filePath ? <Tag>{truncateText(getFileName(relation.filePath), 22)}</Tag> : null}
                              {relation.weight ? <Tag>{`权重 ${relation.weight}`}</Tag> : null}
                              {relation.keywords.slice(0, 3).map((keyword) => (
                                <Tag key={keyword}>{truncateText(keyword, 10)}</Tag>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="knowledge-loading-panel">
          <Empty description="知识图谱暂时为空" image={false} className="minimal-empty" />
        </div>
      )}
    </div>
  )
}
